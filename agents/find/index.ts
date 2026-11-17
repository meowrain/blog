import { estimateTokens } from '../_article';
import { runToolLoop, type HistoryMessage } from '../_agent-loop';
import { getAgentEnv } from '../_model';
import { createLogger, createSSEResponse, stripDsml } from '../_shared';
import { loadCorpus, loadNotes, siteOrigin, type NoteCorpus, type PostRecord } from './_corpus';
import { TOOLS, type ArticleCtx, type FindCtx } from './_tools';

const logger = createLogger('find');

/**
 * POST /find —— 全站右下角那个胶囊助手的后端。
 *
 * 它同时是两件事：站内找文章的 agent（文章索引当工具数据源放在服务端，模型自己决定查什么、
 * 查几次，开销跟站内文章总数无关），以及访客当前这篇文章的学习助手（讲解 / 出题 / 批改）。
 *
 * 正文只存在于浏览器里，所以文章页会把正文随请求一起递上来，服务端把它放进 ctx 交给
 * read_article 工具（见 _tools.ts）。前端不需要知道索引的存在，只管发 messages。
 */

const MODEL_CONTEXT_TOKENS = 64_000;
const MAX_HISTORY_TOKENS = 8_000;
const MAX_USER_TURN_CHARS = 2_000;
/** 前端递上来的正文长度上限（请求体保护；真正的预算裁剪在 read_article 里做） */
const MAX_ARTICLE_CHARS = 60_000;
const MAX_ARTICLE_SECTIONS = 200;
/** 带上文章时工具结果累计进上下文的字符上限要放宽 —— read_article 得装得下一篇正文 */
const MAX_TOOL_CONTEXT_CHARS_WITH_ARTICLE = 24_000;
/**
 * 不带文章时的累计上限。默认的 20k 比 read_post 单条最坏结果（约 20.2k 字符：2 万字正文
 * 加一条 hint 和元信息）还小 —— 累计预算超了会**整条丢掉**最早的结果，模型就等于什么都
 * 没读到。所以这里抬到 22k，保证一条最长的 read_post 结果能完整进上下文。
 */
const MAX_TOOL_CONTEXT_CHARS_PLAIN = 22_000;

interface FindRequestBody {
	messages?: HistoryMessage[];
	/** 本轮问题，只用于日志 */
	query?: string;
	/** —— 以下几项只有文章页会带：把访客正在读的文章递上来（正文由前端从页面 DOM 抽取） —— */
	slug?: string;
	title?: string;
	article?: string;
	sections?: { heading?: string; level?: number; text?: string }[];
}

/** 把前端递上来的文章整成工具用的 ctx；拿不到正文就没有文章上下文 */
function buildArticleCtx(body: FindRequestBody): ArticleCtx | null {
	const text = typeof body.article === 'string' ? body.article.slice(0, MAX_ARTICLE_CHARS).trim() : '';
	const sections = (Array.isArray(body.sections) ? body.sections : [])
		.slice(0, MAX_ARTICLE_SECTIONS)
		.map((section) => ({
			heading: (typeof section?.heading === 'string' ? section.heading : '').trim().slice(0, 120),
			level: Number.isFinite(section?.level) ? Number(section?.level) : 0,
			text: typeof section?.text === 'string' ? section.text.trim() : '',
		}))
		.filter((section) => section.heading && section.text);
	if (!text && !sections.length) return null;
	return {
		slug: (typeof body.slug === 'string' ? body.slug : '').trim().replace(/^\/+|\/+$/g, '').slice(0, 200),
		title: (typeof body.title === 'string' ? body.title : '').trim().slice(0, 120),
		text,
		sections,
	};
}

function buildSystemPrompt(origin: string, article: ArticleCtx | null) {
	return [
		'你是这个个人技术博客的站内助手（页面右下角那个胶囊），能帮访客做两件事：',
		'在站内找文章，以及当他正在阅读的这篇文章的学习助手。站内以中文技术笔记为主，也有少量生活随笔。',
		'',
		'找文章用 search 工具，三个模式：',
		'- search({query})：按关键词检索站内文章，返回标题、站内链接、发布日期和摘要片段。',
		'  访客的问题里往往没有准确术语，你要自己把它翻成检索关键词，并且换几种说法多调用几次',
		'  （中文关键词、英文术语、同义词、更小粒度的词各试一遍），不要只搜一次就下结论。',
		'- search({mode:"categories"})：列出站内全部分类与篇数。访客没想好方向时，或几个关键词都搜不到时用它，据此给访客出选择题。',
		'- search({mode:"recent"})：按发布时间列出最新文章。访客问「最近写了什么」这类跟时间有关、又没给主题的问题时用它，不要靠猜。',
		'',
		'访客问起博主本人（最近在干嘛、最近心情怎么样、去过哪、有什么新鲜事）时，用 read_notes：',
		'- read_notes：读博主的碎碎念（/notes/ 时间线），返回日期、标题、摘要、心情、地点、标签和站内链接。',
		'  这类问题不要去 search 文章 —— 答案不在文章里。可以用 limit / tag / mood / location / since 收窄。',
		'  ⚠️ 封存中的时间胶囊（unlockAt 未到）不会出现在结果里，你只拿到 sealedCount 这个数字。',
		'  只能告诉访客「有 N 条还在封存中，到时间才解锁」，绝不能猜测、编造或从别处拼凑它们的内容。',
		'',
		'系列（成套连载）用这两个工具：',
		'- list_series：列出站内所有系列和各自篇数。访客问「都有哪些系列」「有没有成套的笔记」时用它。',
		'- read_series({name})：读某个系列的完整章节表，按 /series/ 页面的顺序给出每章序号和链接。',
		'  访客问「JUC 该从哪篇读起」「这个系列有几章」时用它。系列是有顺序的连载，',
		'  推荐时按章节顺序讲（先第 1 章再往后），并把序号和站内链接一起给出；',
		'  系列名先用 list_series 查准，命中多个候选时从候选里挑，不要自己猜。',
		'',
		'读正文有两个工具，按「访客在不在看这篇」选：',
		'- read_article：读访客当前正在阅读的这篇文章的正文。',
		'  只要回答涉及这篇的内容，就必须先调用它，基于正文回答；不要凭标题猜文章讲了什么。',
		'  正文过长时结果会被截断并附带 outline（小节标题），用 read_article({section}) 按小节把剩下的读回来。',
		'- read_post：读**任意**一篇文章的正文，靠 url 定位，访客没在看它也能读。',
		'  search 只给标题和 220 字摘要，要讲清某一篇的具体内容（尤其摘要没覆盖到的后半部分）时，用 read_post({url}) 把正文读回来。',
		'  结果 truncated 为 true 时按 hint 里的 group 续读；实在读不完就在回答里说明「只读了前面部分」，不要假装读全了。',
		'  访客正在看的那篇优先用 read_article：更快，而且带前端切好的小节。',
		'',
		'访客在文章页时会说三种话，按他的说法自己判断该做什么：',
		'- 讲解：循序渐进讲透正文里的知识点，举浅显的例子，点出容易混淆的地方；',
		'  讲每个知识点时说明它出现在文章的哪一节，并在讲解中穿插小问题检验他是否真懂了。',
		'- 出题：出一套 5 道题（3 道选择题 + 2 道简答题），先一次性给出全部题目，等他作答后再逐题批改。',
		'- 批改：他提交答案后，逐题判断对错、给出正确答案与解析，最后按 0~100 分打分并指出薄弱知识点。',
		'',
		'规则：',
		'- 需要调用工具时直接调用，调用之前不要输出任何文字说明；你的文字只出现在最终回答里。',
		'- 只能推荐工具返回过的文章，链接用 Markdown 站内相对路径、链接文字写文章标题，',
		'  形如 [JVM 垃圾回收算法](/posts/Java/JVM/JVM垃圾回收算法/)。绝对不要编造站内不存在的文章或链接。',
		'- 推荐文章时每次给 2~4 篇，每篇一句话说明为什么合适（讲的是什么、适合什么阶段），不要复述文章内容。',
		'- 工具结果里带 published 发布日期，推荐时顺手带上，访客好判断新旧。',
		'- 正文之外补充的知识要和正文区分开说；正文被截断时，涉及后面的内容要如实说明，或先按小节补读。',
		'- 确实找不到文章时，直说站内暂时没有这个方向的文章，并追问偏好（主题方向、难度、想解决什么问题），',
		'  或者用 search({mode:"categories"}) 给几个方向让访客挑。',
		'- 用简体中文回答，使用 Markdown，篇幅克制（讲解、出题、批改除外）。',
		'',
		article
			? '访客现在正在阅读：《' + (article.title || '当前文章') + '》' + (article.slug ? '/posts/' + article.slug + '/' : '') + '。'
			: '访客现在不在文章页，先不要谈某篇文章的具体内容。',
		'当前时间：' + new Date().toISOString().slice(0, 10) + '。站内地址是 ' + origin + '。',
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

	// 索引从本站静态文件拉，源站取固定配置（请求头里的 host 是平台内部域名，见 _corpus.ts）
	const origin = siteOrigin(rawEnv);
	const article = buildArticleCtx(body);

	// 历史按预算从最新往回保留，单轮超长的输入也截断
	const capped = clean.map((m) => ({
		role: m.role,
		content: m.content.length > MAX_USER_TURN_CHARS ? m.content.slice(0, MAX_USER_TURN_CHARS) : m.content,
	}));
	const system = buildSystemPrompt(origin, article);
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
		'POST /find conv=%s origin=%s article=%s sections=%d/%dchars turns=%d(kept %d) latest=%s',
		conversationId,
		origin,
		article ? article.slug || '-' : 'none',
		article?.sections.length ?? 0,
		article?.text.length ?? 0,
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
		loadNotes: (): Promise<NoteCorpus> => loadNotes(origin),
		seen: new Set<string>(),
		article,
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
				maxToolContextChars: article ? MAX_TOOL_CONTEXT_CHARS_WITH_ARTICLE : MAX_TOOL_CONTEXT_CHARS_PLAIN,
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
