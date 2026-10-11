import type { ToolDef, ToolResult } from '../_agent-loop';
import type { PostRecord } from '../find/_corpus';
import { searchPosts } from '../find/_tools';
import { tavilyExtract, tavilySearch, type TavilyTimeRange, type TavilyTopic } from '../_tavily';

/**
 * `/chat` 的工具注册表 —— 聊天页的三只手：联网搜（Tavily）、抓某个网页的正文、翻站内文章。
 *
 * 站内那只直接复用 /find 里已经调好的检索实现（切词、idf 加权、摘要切片都在那边），
 * 这里只把 ChatCtx 适配成它要的形状，不维护第二份打分逻辑。
 */

const DEFAULT_WEB_RESULTS = 5;
const MAX_WEB_RESULTS = 8;
/** 摘要再长也只是一条结果，卡住单条长度，免得一屏结果吃掉整个上下文 */
const SNIPPET_CHARS = 600;
/** 抓回来的正文先截断再交给模型：一页动辄几十 K，全塞进去会挤掉对话本身 */
const MAX_PAGE_CHARS = 20_000;
/** 正文结果回灌模型时的上限（默认 4k 装不下网页正文） */
const PAGE_RESULT_CHARS = 12_000;

const TIME_RANGES = new Set<TavilyTimeRange>(['day', 'week', 'month', 'year']);

export interface ChatCtx {
	/** Tavily API key；没配就是空串，工具会如实告诉模型「联网不可用」 */
	tavilyKey: string;
	origin: string;
	loadPosts: () => Promise<PostRecord[]>;
	/** 本次请求里已经给过的文章（复用 search_posts 的去重） */
	seen: Set<string>;
	signal?: AbortSignal;
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

const NO_KEY = JSON.stringify({
	error: '服务端没有配置 TAVILY_API_KEY，联网搜索暂时不可用。基于你自己的知识回答，并如实告诉用户你没联网核实。',
});

async function webSearch(args: Record<string, unknown>, ctx: unknown): Promise<ToolResult> {
	const state = ctx as ChatCtx;
	const query = typeof args.query === 'string' ? args.query.trim() : '';
	if (!query) {
		return { summary: '缺少 query 参数', content: JSON.stringify({ error: 'query 不能为空' }) };
	}
	if (!state.tavilyKey) return { summary: '联网未配置', content: NO_KEY };

	const limitRaw = Number(args.max_results);
	const maxResults =
		Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.trunc(limitRaw), MAX_WEB_RESULTS) : DEFAULT_WEB_RESULTS;
	const topic: TavilyTopic = args.topic === 'news' ? 'news' : 'general';
	const timeRange = TIME_RANGES.has(args.time_range as TavilyTimeRange) ? (args.time_range as TavilyTimeRange) : undefined;
	const includeDomains = (Array.isArray(args.include_domains) ? args.include_domains : [])
		.filter((d): d is string => typeof d === 'string' && !!d.trim())
		.slice(0, 5)
		.map((d) => d.trim());

	const { results } = await tavilySearch({
		apiKey: state.tavilyKey,
		query,
		maxResults,
		topic,
		timeRange,
		includeDomains,
		signal: state.signal,
	});

	if (!results.length) {
		return {
			summary: `联网搜「${query}」没有结果`,
			content: JSON.stringify({
				query,
				count: 0,
				hint: '这条没搜到。换个更短或更具体的说法（或换成英文、换时间范围）再搜一次；两三次都搜不到就如实说明，不要编。',
			}),
		};
	}

	return {
		summary: `联网搜「${query}」命中 ${results.length} 条`,
		content: JSON.stringify({
			query,
			count: results.length,
			results: results.map((r) => ({
				title: r.title,
				url: r.url,
				snippet: r.content.slice(0, SNIPPET_CHARS),
				...(r.published ? { published: r.published } : {}),
			})),
			hint: '这些只是摘要。需要原文里的数据、代码或完整段落时，用 read_page 抓其中某条的 url。',
		}),
	};
}

async function readPage(args: Record<string, unknown>, ctx: unknown): Promise<ToolResult> {
	const state = ctx as ChatCtx;
	const url = typeof args.url === 'string' ? args.url.trim() : '';
	if (!/^https?:\/\//i.test(url)) {
		return { summary: 'url 不合法', content: JSON.stringify({ error: 'url 必须是 http(s) 开头的完整地址' }) };
	}
	if (!state.tavilyKey) return { summary: '联网未配置', content: NO_KEY };

	const pages = await tavilyExtract({ apiKey: state.tavilyKey, urls: [url], signal: state.signal });
	const page = pages[0];
	if (!page) {
		return {
			summary: `抓不到 ${hostOf(url)} 的正文`,
			content: JSON.stringify({
				url,
				error: '这个地址没抓到正文（可能是动态渲染、要登录，或站点不让抓）。换一条来源，或只用搜索摘要回答。',
			}),
		};
	}

	const text = page.content.trim();
	const clipped = text.slice(0, MAX_PAGE_CHARS);
	return {
		summary: `读了 ${hostOf(page.url)} 的正文`,
		content: JSON.stringify({
			url: page.url,
			chars: text.length,
			truncated: clipped.length < text.length,
			text: clipped,
		}),
	};
}

async function searchSite(args: Record<string, unknown>, ctx: unknown): Promise<ToolResult> {
	const state = ctx as ChatCtx;
	// search_posts 只用到 loadPosts / seen，article 传 null 即可（那是文章页的上下文）
	return searchPosts(args, { origin: state.origin, loadPosts: state.loadPosts, seen: state.seen, article: null });
}

export const TOOLS: ToolDef[] = [
	{
		name: 'web_search',
		description:
			'联网搜索（Tavily）。涉及事实、时效、最新消息的问题，以及你不确定、可能过时的知识，都先搜再答，不要凭记忆编。' +
			'返回每条结果的标题、完整 url 和摘要片段；回答里引用来源时用 Markdown 链接指到 url。' +
			'摘要不够用时，用 read_page 抓具体那条的正文。',
		parameters: {
			type: 'object',
			properties: {
				query: { type: 'string', description: '搜索关键词，用用户问题里最核心的那几个词，不要写成一句话' },
				max_results: { type: 'integer', description: `返回条数，默认 ${DEFAULT_WEB_RESULTS}，最多 ${MAX_WEB_RESULTS}` },
				topic: { type: 'string', enum: ['general', 'news'], description: '查新闻/最近动态用 news，其余用 general' },
				time_range: { type: 'string', enum: ['day', 'week', 'month', 'year'], description: '只要最近这段时间的内容时传，按需使用' },
				include_domains: {
					type: 'array',
					items: { type: 'string' },
					description: '限定只在这些域名里搜（如 ["github.com"]），最多 5 个；不确定就别传',
				},
			},
			required: ['query'],
		},
		run: webSearch,
	},
	{
		name: 'read_page',
		description:
			'把一个完整 url 的网页正文抓回来（纯文本）。搜索结果只给摘要，需要原文里的数据、代码、完整段落时用它。' +
			'一次抓一个 url；抓不到会如实报错，别对同一个地址反复重试，换来源。',
		parameters: {
			type: 'object',
			properties: {
				url: { type: 'string', description: '要抓的页面完整地址，http(s) 开头' },
			},
			required: ['url'],
		},
		maxResultChars: PAGE_RESULT_CHARS,
		run: readPage,
	},
	{
		name: 'search_posts',
		description:
			'在博主博客的站内索引里按关键词找文章，返回标题、站内链接、发布日期和摘要片段。' +
			'用户问「你写过关于 XX 的吗」「站里有没有讲 YY 的」这类问题时用它 —— 站内的事不要用 web_search 去搜。' +
			'换几种说法多调用几次（中文关键词、英文术语、同义词），返回 count 为 0 说明这次没搜到，换个词再试。',
		parameters: {
			type: 'object',
			properties: {
				query: { type: 'string', description: '检索关键词，比如「JVM 垃圾回收」「Redis 持久化」' },
				limit: { type: 'integer', description: '返回条数，默认 5，最多 8' },
			},
			required: ['query'],
		},
		run: searchSite,
	},
];