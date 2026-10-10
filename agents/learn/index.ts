import { createDeepAgent } from 'deepagents';
import { tool } from '@langchain/core/tools';
import { createLogger, sseEvent, createSSEResponse, createDsmlFilter, stripDsml } from '../_shared';
import { getAgentEnv, createModel } from '../_model';

const logger = createLogger('learn');

type Mode = 'tutor' | 'quiz' | 'eval';
type ChatMessage = { role: 'user' | 'assistant'; content: string };

interface LearnRequestBody {
	messages?: ChatMessage[];
	slug?: string;
	title?: string;
	mode?: Mode;
}

interface Usage {
	input_tokens?: number;
	output_tokens?: number;
	total_tokens?: number;
}

interface TurnCollector {
	text: string;
	usage?: Usage;
}

// 一篇文章 = 一个 conversation_id = 一个 langgraph thread，所以界面历史可以按文章恢复。
const MODES: readonly Mode[] = ['tutor', 'quiz', 'eval'];

const MODE_PROMPTS: Record<Mode, string> = {
	tutor: '你是一位耐心的学习导师。围绕用户当前正在阅读的这篇博文，用循序渐进的方式讲解其中的知识点，举浅显的例子，主动指出易混淆的概念，并在讲解中穿插小问题来检验用户是否真的理解。',
	quiz: '你是一位出题老师。围绕用户当前正在阅读的这篇博文，出一套 5 道题的测验（3 道选择题 + 2 道简答题），先一次性给出全部题目，等用户作答后再逐题批改并给出解析。',
	eval: '你是一位严格的阅卷老师。用户会回答之前测验里的题目，请逐题判断对错、给出正确答案与解析，最后按 0~100 分打分，并指出薄弱知识点和下一步该复习什么。',
};

function buildSystemPrompt(mode: Mode): string {
	const base =
		'你是博文学习助手，运行在用户的个人技术博客（Fuwari 静态博客，技术类文章为主）内，' +
		'帮助访客通过对话深入理解博客文章。回复使用简体中文，使用 Markdown，篇幅克制（默认 300 字以内，出题和批改除外）。' +
		'只针对知识点展开，不要复述整篇文章。你没有任何文件与浏览器工具，也不要声称自己读过文章内容之外的东西：' +
		'文章正文你同样看不到，只能基于用户提供的 slug、标题以及你自己的知识来讲解，涉及文章具体细节时如实说明这是推断。';
	return `${base}\n\n当前任务模式：${MODE_PROMPTS[mode]}`;
}

// ── agent 实例缓存 ───────────────────────────────────────────────────────
// createDeepAgent 每次都会重新编译一张图，热路径上不该每请求一次就建一次。
// 但 checkpointer / store 是平台按 context.store 注入的对象，换进程就换实例，
// 所以缓存键必须带上它们的身份（用 WeakMap 编号，不污染被编号对象）。
const agentCache = new Map<string, any>();
const adapterIds = new WeakMap<object, number>();
let adapterSeq = 0;

function adapterId(obj: unknown): string {
	if (!obj || typeof obj !== 'object') return 'none';
	let id = adapterIds.get(obj as object);
	if (id === undefined) {
		id = ++adapterSeq;
		adapterIds.set(obj as object, id);
	}
	return String(id);
}

function getAgent(opts: {
	model: any;
	mode: Mode;
	toolCount: number;
	tools: any[];
	checkpointer: any;
	lgStore: any;
}) {
	const key = `${opts.mode}|${opts.toolCount}|${adapterId(opts.checkpointer)}|${adapterId(opts.lgStore)}`;
	const hit = agentCache.get(key);
	if (hit) return hit;

	const agent = createDeepAgent({
		model: opts.model,
		systemPrompt: buildSystemPrompt(opts.mode),
		tools: opts.tools,
		// ⭐ 会话记忆交给平台适配器（agents/ 端点才有这两个属性）
		checkpointer: opts.checkpointer,
		store: opts.lgStore,
	});
	agentCache.set(key, agent);
	// 兜住长驻进程里的无界增长：适配器身份换新即整批作废，留不下几个的开销
	if (agentCache.size > 24) agentCache.clear();
	return agent;
}

// 平台工具集：只有配了 WSA_API_KEY 才挂 web_search。
// deepagents 必须走 toLangChainTools 注入 LangChain 的 tool 工厂，
// 直接 all() 拿到的是鸭子类型对象，过不了 instanceof 检查。
function resolveTools(context: any, contextEnv: Record<string, string | undefined> | undefined): any[] {
	if (!contextEnv?.WSA_API_KEY?.trim()) return [];
	try {
		const built = context?.tools?.toLangChainTools?.(tool, ['web_search']);
		return Array.isArray(built) ? built : [];
	} catch (e) {
		logger.error('toLangChainTools failed, continuing without tools', (e as Error).message);
		return [];
	}
}

function articleLine(slug: string, title: string, mode: Mode): string {
	const where = slug
		? `用户正在阅读的文章：${title ? `《${title}》` : ''}/posts/${slug}/（本轮起这次对话就围绕它）`
		: '用户当前没有指定文章，先问清楚想读哪一篇，再开始讲解。';
	const modeNote =
		mode === 'quiz'
			? '本轮请出题。'
			: mode === 'eval'
				? '本轮请批改用户刚才的答案。'
				: '';
	return `${where}\n${modeNote}`.trim();
}

async function* eventStream(
	agent: any,
	turnContent: string,
	conversationId: string,
	signal: AbortSignal | undefined,
	collector: TurnCollector,
) {
	const dsml = createDsmlFilter();
	try {
		const stream = await agent.stream(
			{ messages: [{ role: 'user', content: turnContent }] },
			{
				streamMode: 'messages',
				signal,
				recursionLimit: 30,
				configurable: { thread_id: conversationId },
			},
		);
		for await (const chunk of stream) {
			if (signal?.aborted) break;
			const [msg] = chunk;
			if (msg.tool_call_chunks?.length) {
				for (const tc of msg.tool_call_chunks) {
					if (tc.name) yield sseEvent({ type: 'tool_call', name: tc.name });
				}
			} else if (msg.type === 'tool') {
				yield sseEvent({ type: 'tool_result', name: msg.name, content: msg.text?.slice(0, 500) ?? '' });
			} else if (msg.text) {
				// 模型往正文里漏的 DeepSeek 工具调用标记不会到用户屏幕上
				const safe = dsml.feed(msg.text);
				if (safe) {
					collector.text += safe;
					yield sseEvent({ type: 'ai_response', content: safe });
				}
			}
			if (msg.usage_metadata) collector.usage = msg.usage_metadata as Usage;
		}
		const tail = dsml.flush();
		if (tail) {
			collector.text += tail;
			yield sseEvent({ type: 'ai_response', content: tail });
		}
		if (dsml.hits) logger.log(`stripped ${dsml.hits} DSML marker(s) from outgoing text`);
	} catch (e) {
		const err = e as Error;
		if (err.name === 'AbortError' || signal?.aborted) {
			// 用户点了停止 —— 已经吐出的内容照常收尾，不报错
		} else if (/MemoryCorrupt/i.test(`${err.name} ${err.message}`)) {
			// checkpoint 落盘数据坏了：让用户开新会话，而不是在坏状态上继续跑
			yield sseEvent({
				type: 'error_message',
				content: '这段对话的历史状态读不出来，点「新对话」重新开始即可',
				code: 'AGENT_STATE_CORRUPT',
			});
		} else {
			yield sseEvent({ type: 'error_message', content: err.message });
		}
	}
	if (collector.usage) {
		yield sseEvent({
			type: 'usage',
			input_tokens: collector.usage.input_tokens ?? 0,
			output_tokens: collector.usage.output_tokens ?? 0,
			total_tokens: collector.usage.total_tokens ?? 0,
		});
	}
	yield 'data: [DONE]\n\n';
}

export async function onRequest(context: any) {
	const { request, conversation_id: conversationId, store } = context;

	const body = (request?.body ?? {}) as LearnRequestBody;
	const slug = (typeof body.slug === 'string' ? body.slug : '').trim().replace(/^\/+|\/+$/g, '').slice(0, 200);
	const title = (typeof body.title === 'string' ? body.title : '').trim().slice(0, 120);
	const mode: Mode = MODES.includes(body.mode as Mode) ? (body.mode as Mode) : 'tutor';

	const clean = (Array.isArray(body.messages) ? body.messages : []).filter(
		(m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.trim(),
	);
	// checkpointer 已经持有这个 thread 的历史，整段重放会让提示词每轮把自己抄一遍，
	// 所以只转发最新一条 user 消息；数组本身只用来判断是不是首轮。
	const latest = [...clean].reverse().find((m) => m.role === 'user');
	if (!latest) {
		return new Response(JSON.stringify({ error: "'messages' is required" }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}
	// 没有 conversation_id 就没有 sticky routing，thread_id 会退化成所有人共用的
	// 'undefined'，串会话是迟早的事 —— 宁可当场拒绝。
	if (!conversationId) {
		return new Response(JSON.stringify({ error: "'makers-conversation-id' header is required" }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const env = getAgentEnv(context.env);
	const model = createModel(env);
	const tools = resolveTools(context, context.env);
	const agent = getAgent({
		model,
		mode,
		tools,
		toolCount: tools.length,
		checkpointer: store?.langgraphCheckpointer,
		lgStore: store?.langgraphStore,
	});

	const isFirstTurn = clean.filter((m) => m.role === 'user').length <= 1;
	const turnContent = isFirstTurn
		? `${articleLine(slug, title, mode)}\n\n${latest.content}`
		: latest.content;

	// 界面历史（/history 恢复用）写在 message API 上，和 checkpointer 各管各的：
	// 前者给人看，后者给模型记。写失败不阻塞回答。
	await store
		?.appendMessage?.({ conversationId, role: 'user', content: latest.content, metadata: { slug, mode } })
		.catch((e: unknown) => logger.error('appendMessage(user) failed', (e as Error).message));

	const collector: TurnCollector = { text: '' };

	async function* run(sig?: AbortSignal) {
		try {
			yield* eventStream(agent, turnContent, conversationId, sig, collector);
		} finally {
			// 停止 / 断流时已吐出的部分也要留下，否则下一轮恢复历史会缺一截
			const finalText = stripDsml(collector.text).trim();
			if (finalText) {
				await store
					?.appendMessage?.({ conversationId, role: 'assistant', content: finalText, metadata: { mode } })
					.catch((e: unknown) => logger.error('appendMessage(assistant) failed', (e as Error).message));
			}
		}
	}

	logger.log('POST /learn slug=%s mode=%s conv=%s tools=%d first=%s', slug || '-', mode, conversationId, tools.length, isFirstTurn);
	return createSSEResponse(run, request?.signal as AbortSignal | undefined);
}
