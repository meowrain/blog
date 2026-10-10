import { createLogger, sseEvent, createSSEResponse, createDsmlFilter, stripDsml } from '../_shared';
import { getAgentEnv, modelName, chatCompletionsUrl } from '../_model';
import { clampArticleBody, estimateTokens, wrapArticleBody } from '../_article';

const logger = createLogger('learn');

type Mode = 'tutor' | 'quiz' | 'eval';
type ChatMessage = { role: 'user' | 'assistant'; content: string };

// 上下文预算：网关模型窗口足够，但要给正文、历史对话、回复留出比例，
// 否则长文一塞进去就会把回复挤没（表现为"只吐半句就断"）。
const MODEL_CONTEXT_TOKENS = 64_000;
const MAX_HISTORY_TOKENS = 8_000;
const MAX_ARTICLE_TOKENS = 24_000;
const MAX_USER_TURN_CHARS = 4_000; // 单轮用户输入上限（含前端传上来的整篇正文的兜底）

interface LearnRequestBody {
	messages?: ChatMessage[];
	slug?: string;
	title?: string;
	mode?: Mode;
	/** 文章正文的纯文本，由文章页在客户端抽取后传入（Markdown 原文或已剥离标记的文本均可） */
	article?: string;
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
		'帮助访客通过对话深入理解当前这篇文章。回复使用简体中文，使用 Markdown，篇幅克制（默认 300 字以内，出题和批改除外）。' +
		'下面会给出这篇文章的正文，请基于正文回答，讲知识点时点明它出现在文章的哪个部分（如某小节、某段）。' +
		'正文之外的知识可以补充，但要和正文区分开说。如果正文被截断（结尾有省略标记），涉及后面内容时如实说明你看不到。' +
		'不要复述整篇文章。你没有任何文件与浏览器工具。';
	return `${base}\n\n当前任务模式：${MODE_PROMPTS[mode]}`;
}

function articleLine(slug: string, title: string, mode: Mode): string {
	const where = slug
		? `用户正在阅读的文章：${title ? `《${title}》` : ''}/posts/${slug}/`
		: '用户当前没有指定文章，先问清楚想读哪一篇，再开始讲解。';
	const modeNote = mode === 'quiz' ? '本轮请出题。' : mode === 'eval' ? '本轮请批改用户刚才的答案。' : '';
	return `${where}\n${modeNote}`.trim();
}

/**
 * 组装首轮要注入的上下文块：文章信息 + 正文（按预算裁剪）。
 * 返回 null 表示没拿到正文 —— 这时要如实告诉模型"看不到正文"，
 * 不能让模型自己编（之前正是这个 bug：模型说"我看不到正文"，用户以为功能坏了）。
 */
function buildContextBlock(slug: string, title: string, mode: Mode, article: string) {
	const head = articleLine(slug, title, mode);
	const body = clampArticleBody(article, MAX_ARTICLE_TOKENS);
	if (!body) {
		return `${head}\n\n[未能获取文章正文：可能是文章页未传、或正文为空。请基于标题和通用知识作答，并明确说明你没有正文。]`;
	}
	const truncated = estimateTokens(article) > MAX_ARTICLE_TOKENS;
	const note = truncated ? '\n\n（正文过长已截断，末尾标有省略标记，后半部分你看不到。）' : '';
	const tail = truncated ? `${body}\n\n<<<省略，正文在此截断>>>` : body;
	return `${head}\n\n${wrapArticleBody(tail, title)}${note}`;
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
	const article = typeof body.article === 'string' ? body.article : '';
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

	const isFirstTurn = clean.filter((m) => m.role === 'user').length <= 1;
	const prompt = buildSystemPrompt(mode);
	// 首轮把文章上下文塞进 system，之后沿用同一段 system（模型从历史里已能看到它）
	const systemContent = isFirstTurn ? `${prompt}\n\n${buildContextBlock(slug, title, mode, article)}` : prompt;

	// 历史按预算从最新往回保留，单轮超长的用户输入也要截断
	const capped = clean.map((m) => ({
		role: m.role,
		content: m.content.length > MAX_USER_TURN_CHARS ? m.content.slice(0, MAX_USER_TURN_CHARS) : m.content,
	}));
	const kept: { role: string; content: string }[] = [];
	let used = estimateTokens(systemContent);
	for (let i = capped.length - 1; i >= 0; i--) {
		const turn = capped[i];
		const cost = estimateTokens(turn.content) + 8;
		if (kept.length && used + cost > MODEL_CONTEXT_TOKENS - MAX_HISTORY_TOKENS) break;
		used += cost;
		kept.unshift(turn);
	}
	const modelMessages = [{ role: 'system', content: systemContent }, ...kept];

	logger.log(
		'POST /learn slug=%s mode=%s conv=%s turns=%d(kept %d) article=%d chars/%d tokens',
		slug || '-',
		mode,
		conversationId,
		clean.length,
		kept.length,
		article.length,
		estimateTokens(article),
	);

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
