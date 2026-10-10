import { createLogger, sseEvent, createSSEResponse, createDsmlFilter, stripDsml } from '../_shared';
import { getAgentEnv, modelName, chatCompletionsUrl } from '../_model';

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

// 刻意不引任何三方包：直接用 fetch 打 AI Gateway 的 OpenAI 兼容接口。
// 平台的 agent 运行时会裁剪外部依赖（见构建日志 "Dependency sync ... missing=15"），
// 之前依赖 deepagents / @langchain/* 时整包在加载期崩，所有 agents/ 路由一起 500。
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
		'只针对知识点展开，不要复述整篇文章。你没有任何文件与浏览器工具，也不要把文章正文当成你读过：' +
		'正文你同样看不到，只能基于用户给的标题、以及你自己的知识来讲解，涉及文章具体细节时如实说明这是推断。';
	return `${base}\n\n当前任务模式：${MODE_PROMPTS[mode]}`;
}

function articleLine(slug: string, title: string, mode: Mode): string {
	const where = slug
		? `用户正在阅读的文章：${title ? `《${title}》` : ''}/posts/${slug}/`
		: '用户当前没有指定文章，先问清楚想读哪一篇，再开始讲解。';
	const modeNote = mode === 'quiz' ? '本轮请出题。' : mode === 'eval' ? '本轮请批改用户刚才的答案。' : '';
	return `${where}\n${modeNote}`.trim();
}

interface GatewayChunk {
	choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
	usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
}

// 逐块解析上游 SSE：每个事件形如 "data: {...}\n\n"，以 "data: [DONE]" 结束
async function* readGatewayStream(resp: Response, signal?: AbortSignal) {
	const reader = resp.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	while (true) {
		if (signal?.aborted) break;
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let idx: number;
		while ((idx = buffer.indexOf('\n')) !== -1) {
			const line = buffer.slice(0, idx).trim();
			buffer = buffer.slice(idx + 1);
			if (!line.startsWith('data:')) continue;
			const payload = line.slice(5).trim();
			if (!payload || payload === '[DONE]') continue;
			try {
				yield JSON.parse(payload) as GatewayChunk;
			} catch {
				// 上游偶发的心跳/注释行，忽略
			}
		}
	}
}

async function* eventStream(
	env: ReturnType<typeof getAgentEnv>,
	modelMessages: { role: string; content: string }[],
	signal: AbortSignal | undefined,
	collector: { text: string; usage?: Usage },
) {
	const dsml = createDsmlFilter();
	try {
		const resp = await fetch(chatCompletionsUrl(env), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${env.AI_GATEWAY_API_KEY}`,
			},
			body: JSON.stringify({
				model: modelName(env),
				messages: modelMessages,
				temperature: 0,
				stream: true,
				stream_options: { include_usage: true },
			}),
			signal,
		});

		if (!resp.ok || !resp.body) {
			const detail = await resp.text().catch(() => '');
			throw new Error(`AI Gateway ${resp.status}: ${detail.slice(0, 300)}`);
		}

		for await (const chunk of readGatewayStream(resp, signal)) {
			if (signal?.aborted) break;
			const delta = chunk.choices?.[0]?.delta?.content;
			if (delta) {
				const safe = dsml.feed(delta);
				if (safe) {
					collector.text += safe;
					yield sseEvent({ type: 'ai_response', content: safe });
				}
			}
			if (chunk.usage) {
				collector.usage = {
					input_tokens: chunk.usage.prompt_tokens ?? 0,
					output_tokens: chunk.usage.completion_tokens ?? 0,
					total_tokens: chunk.usage.total_tokens ?? 0,
				};
			}
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
			// 用户点了停止 —— 已吐出的内容照常收尾
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
	const latest = [...clean].reverse().find((m) => m.role === 'user');
	if (!latest) {
		return new Response(JSON.stringify({ error: "'messages' is required" }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}
	if (!conversationId) {
		return new Response(JSON.stringify({ error: "'makers-conversation-id' header is required" }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// 没有 checkpointer 了，历史由客户端带上来的 messages 承担：
	// 首轮把文章上下文塞进 system，后续轮次原样转发多轮对话。
	const isFirstTurn = clean.filter((m) => m.role === 'user').length <= 1;
	const systemContent = isFirstTurn ? `${buildSystemPrompt(mode)}\n\n${articleLine(slug, title, mode)}` : buildSystemPrompt(mode);
	const modelMessages = [
		{ role: 'system', content: systemContent },
		...clean.map((m) => ({ role: m.role, content: m.content })),
	];

	// 界面历史（/history 恢复用）写在 message API 上，写失败不阻塞回答
	await store
		?.appendMessage?.({ conversationId, role: 'user', content: latest.content, metadata: { slug, mode } })
		.catch((e: unknown) => logger.error('appendMessage(user) failed', (e as Error).message));

	const env = getAgentEnv(context.env);
	const collector: { text: string; usage?: Usage } = { text: '' };

	async function* run(sig?: AbortSignal) {
		try {
			yield* eventStream(env, modelMessages, sig, collector);
		} finally {
			const finalText = stripDsml(collector.text).trim();
			if (finalText) {
				await store
					?.appendMessage?.({ conversationId, role: 'assistant', content: finalText, metadata: { mode } })
					.catch((e: unknown) => logger.error('appendMessage(assistant) failed', (e as Error).message));
			}
		}
	}

	logger.log('POST /learn slug=%s mode=%s conv=%s turns=%d', slug || '-', mode, conversationId, clean.length);
	return createSSEResponse(run, request?.signal as AbortSignal | undefined);
}
