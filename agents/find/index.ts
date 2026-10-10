import { createLogger, createSSEResponse, stripDsml } from '../_shared';
import { getAgentEnv } from '../_model';
import { estimateTokens } from '../_article';
import { runToolLoop, type HistoryMessage } from '../_agent-loop';
import { loadCorpus, originOf, type PostRecord } from './_corpus';
import { TOOLS, type FindCtx } from './_tools';

const logger = createLogger('find');

/**
 * POST /find —— 站内找文章的 agent。
 *
 * 和 /learn 的区别：/learn 把整篇正文塞进 system，而这个 agent 的「文章库」在服务端当工具数据源，
 * 模型自己决定查什么、查几次。好处是开销跟站内文章总数无关（只有工具挑出来的几条进上下文），
 * 加新能力也只是往 _tools.ts 里加一条。
 *
 * 前端不需要知道索引的存在，只管发 messages。
 */

const MODEL_CONTEXT_TOKENS = 64_000;
const MAX_HISTORY_TOKENS = 8_000;
const MAX_USER_TURN_CHARS = 2_000;

interface FindRequestBody {
	messages?: HistoryMessage[];
	/** 本轮问题，只用于日志 */
	query?: string;
}

function buildSystemPrompt(origin: string) {
	return [
		'你是这个个人技术博客的站内导览员，帮访客找到他想看的文章。站内以中文技术笔记为主，也有少量生活随笔。',
		'',
		'你有这些工具：',
		'- search_posts：按关键词检索站内文章，返回标题、站内链接、发布日期和摘要片段。',
		'  访客的问题里往往没有准确术语，你要自己把它翻成检索关键词，并且换几种说法多调用几次',
		'  （中文关键词、英文术语、同义词、更小粒度的词各试一遍），不要只搜一次就下结论。',
		'- list_categories：列出站内全部分类与篇数。访客没想好方向时，或几个关键词都搜不到时用它，据此给访客出选择题。',
		'- list_recent_posts：按发布时间列出最新文章。访客问「最近写了什么」这类跟时间有关、又没给主题的问题时用它，不要靠猜。',
		'',
		'规则：',
		'- 需要找文章时直接调用工具，调用之前不要输出任何文字说明；你的文字只出现在最终回答里。',
		'- 只能推荐工具返回过的文章，链接用 Markdown 站内相对路径、链接文字写文章标题，',
		'  形如 [JVM 垃圾回收算法](/posts/Java/JVM/JVM垃圾回收算法/)。绝对不要编造站内不存在的文章或链接。',
		'- 每次给 2~4 篇，每篇一句话说明为什么合适（讲的是什么、适合什么阶段），不要复述文章内容。',
		'- 工具结果里带 published 发布日期，推荐时顺手带上，访客好判断新旧。',
		'- 确实找不到时，直说站内暂时没有这个方向的文章，并追问偏好（主题方向、难度、想解决什么问题），',
		'  或者用 list_categories 给几个方向让访客挑。',
		'- 用简体中文回答，使用 Markdown，篇幅克制。',
		'',
		`当前时间：${new Date().toISOString().slice(0, 10)}。站内共有一个文章索引，站内地址是 ${origin}。`,
	].join('\n');
}

function jsonResponse(status: number, payload: Record<string, unknown>) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

export async function onRequest(context: any) {
	const { request, conversation_id: conversationId, store, env: rawEnv } = context;

	const body = (request?.body ?? {}) as FindRequestBody;
	const clean = (Array.isArray(body.messages) ? body.messages : []).filter(
		(m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.trim(),
	);
	const latest = [...clean].reverse().find((m) => m.role === 'user');
	if (!latest) {
		return jsonResponse(400, { error: "'messages' is required" });
	}
	if (!conversationId) {
		return jsonResponse(400, { error: "'makers-conversation-id' header is required" });
	}

	// 索引从本站静态文件拉，源站按请求头推；拿不到就直接告知，别让模型去猜文章
	let origin = '';
	try {
		origin = originOf(request?.headers);
	} catch (e) {
		logger.error('origin unavailable', (e as Error).message);
		return jsonResponse(500, { error: 'cannot determine site origin' });
	}

	// 历史按预算从最新往回保留，单轮超长的输入也截断
	const capped = clean.map((m) => ({
		role: m.role,
		content: m.content.length > MAX_USER_TURN_CHARS ? m.content.slice(0, MAX_USER_TURN_CHARS) : m.content,
	}));
	const system = buildSystemPrompt(origin);
	const kept: HistoryMessage[] = [];
	let used = estimateTokens(system);
	for (let i = capped.length - 1; i >= 0; i--) {
		const turn = capped[i];
		const cost = estimateTokens(turn.content) + 8;
		if (kept.length && used + cost > MODEL_CONTEXT_TOKENS - MAX_HISTORY_TOKENS) break;
		used += cost;
		kept.unshift(turn);
	}

	logger.log(
		'POST /find conv=%s origin=%s turns=%d(kept %d) latest=%s',
		conversationId,
		origin,
		clean.length,
		kept.length,
		String(body.query ?? latest.content).slice(0, 80),
	);

	await store
		?.appendMessage?.({ conversationId, role: 'user', content: latest.content })
		.catch((e: unknown) => logger.error('appendMessage(user) failed', (e as Error).message));

	const agentEnv = getAgentEnv(rawEnv);
	const collector = { text: '' };
	const ctx: FindCtx = {
		origin,
		loadPosts: (): Promise<PostRecord[]> => loadCorpus(origin),
		seen: new Set<string>(),
	};

	async function* run(signal?: AbortSignal) {
		try {
			yield* runToolLoop({
				env: agentEnv,
				system,
				history: kept,
				tools: TOOLS,
				ctx,
				signal,
				collector,
				logger,
			});
		} finally {
			const finalText = stripDsml(collector.text).trim();
			if (finalText) {
				await store
					?.appendMessage?.({ conversationId, role: 'assistant', content: finalText })
					.catch((e: unknown) => logger.error('appendMessage(assistant) failed', (e as Error).message));
			}
		}
	}

	return createSSEResponse(run, request?.signal as AbortSignal | undefined);
}
