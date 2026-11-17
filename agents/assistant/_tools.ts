import type { ToolDef, ToolResult } from '../_agent-loop';
import type { PostRecord } from '../find/_corpus';
import { SEARCH_TOOL } from '../find/_tools';
import { wsaSearch, type WsaIndustry } from '../_wsa';

/**
 * `/assistant` 的工具注册表 —— 聊天页的两只手：联网搜（腾讯云元宝搜索）、翻站内文章。
 *
 * 元宝搜索只给标题 + 摘要，不提供抓正文的接口，所以这里没有 read_page：
 * 模型要细节时只能如实说「只看到摘要」，或换关键词再搜一次。之前的 Tavily 版本
 * 靠 /extract 撑着 read_page，换成元宝后该工具下线（见 agents/_wsa.ts 顶部说明）。
 *
 * 站内那只直接复用 /find 的工具定义（切词、idf 加权、摘要切片、三种模式都在那边），
 * 两个 agent 共用同一个 `search`：站内只有一套检索能力，不该各玩各的。
 */

const DEFAULT_WEB_RESULTS = 5;
const MAX_WEB_RESULTS = 8;
/** 摘要再长也只是一条结果，卡住单条长度，免得一屏结果吃掉整个上下文 */
const SNIPPET_CHARS = 600;

const INDUSTRIES = new Set<WsaIndustry>(['gov', 'news', 'acad', 'finance']);

/** 工具层的粗粒度时间范围 → 元宝的 Freshness 语法（dN/mN/yN） */
const FRESHNESS: Record<string, string> = {
	day: 'd1',
	week: 'd7',
	month: 'm1',
	year: 'y1',
};

export interface ChatCtx {
	/** 腾讯云 API 密钥；两者都非空才启用联网，否则工具如实告诉模型「联网不可用」 */
	wsaSecretId: string;
	wsaSecretKey: string;
	origin: string;
	loadPosts: () => Promise<PostRecord[]>;
	/** 本次请求里已经给过的文章（复用 search 的去重） */
	seen: Set<string>;
	signal?: AbortSignal;
}

const NO_KEY = JSON.stringify({
	error:
		'服务端没有配置 WSA_SECRET_ID / WSA_SECRET_KEY，联网搜索暂时不可用。' +
		'基于你自己的知识回答，并如实告诉用户你没联网核实。',
});

async function webSearch(args: Record<string, unknown>, ctx: unknown): Promise<ToolResult> {
	const state = ctx as ChatCtx;
	const query = typeof args.query === 'string' ? args.query.trim() : '';
	if (!query) {
		return { summary: '缺少 query 参数', content: JSON.stringify({ error: 'query 不能为空' }) };
	}
	if (!state.wsaSecretId || !state.wsaSecretKey) return { summary: '联网未配置', content: NO_KEY };

	const limitRaw = Number(args.max_results);
	const maxResults =
		Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.trunc(limitRaw), MAX_WEB_RESULTS) : DEFAULT_WEB_RESULTS;
	const industry = INDUSTRIES.has(args.industry as WsaIndustry) ? (args.industry as WsaIndustry) : undefined;
	const freshness = typeof args.time_range === 'string' ? FRESHNESS[args.time_range] : undefined;
	const site = typeof args.site === 'string' && args.site.trim() ? args.site.trim() : undefined;

	let results: Awaited<ReturnType<typeof wsaSearch>>['results'];
	let version: string;
	try {
		({ results, version } = await wsaSearch({
			secretId: state.wsaSecretId,
			secretKey: state.wsaSecretKey,
			query,
			maxResults,
			site,
			industry,
			freshness,
			signal: state.signal,
		}));
	} catch (e) {
		// 密钥错、没开通、超时、限流都落到这里。转成工具结果而不是抛异常：
		// 模型能读到 error 和 hint，知道该换说法还是该如实告诉访客联网坏了。
		const message = (e as Error).message || String(e);
		return {
			summary: `联网搜索失败：${message.slice(0, 80)}`,
			content: JSON.stringify({
				query,
				error: message,
				hint:
					'这次联网搜索没成功。若是密钥/开通问题，重复调用也没用，直接如实告诉访客联网暂时不可用，' +
					'用你自己的知识回答并说明没联网核实；若是超时或限流，可以换个关键词再试一次。',
			}),
		};
	}

	if (!results.length) {
		return {
			summary: `联网搜「${query}」没有结果`,
			content: JSON.stringify({
				query,
				count: 0,
				hint: '这条没搜到。换个更短或更具体的说法（或换成英文、放宽时间范围）再搜一次；两三次都搜不到就如实说明，不要编。',
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
				snippet: (r.content || r.passage).slice(0, SNIPPET_CHARS),
				...(r.site ? { site: r.site } : {}),
				...(r.date ? { published: r.date } : {}),
			})),
			// 摘要就是元宝能给的全部；没有 read_page 了，别让模型假装读过原文
			hint:
				'这些是搜索结果摘要，不是原文全文。回答时只说摘要能支撑的部分；' +
				'需要更多细节就换个关键词再搜，并在回答里如实说明你没有读到页面全文。',
			...(version ? { version } : {}),
		}),
	};
}

export const TOOLS: ToolDef[] = [
	{
		name: 'web_search',
		description:
			'联网搜索（腾讯云元宝搜索）。涉及事实、时效、最新消息的问题，以及你不确定、可能过时的知识，都先搜再答，不要凭记忆编。' +
			'返回每条结果的标题、完整 url、来源站点、发布时间和摘要片段；回答里引用来源时用 Markdown 链接指到 url。' +
			'只能拿到摘要，没有抓取网页全文的能力；摘要不够时换关键词再搜，别把摘要里的只言片语讲成确定细节。',
		parameters: {
			type: 'object',
			properties: {
				query: { type: 'string', description: '搜索关键词，用用户问题里最核心的那几个词，不要写成一句话' },
				max_results: { type: 'integer', description: `返回条数，默认 ${DEFAULT_WEB_RESULTS}，最多 ${MAX_WEB_RESULTS}` },
				site: { type: 'string', description: '只在这个域名里搜（如 "zhihu.com"），只能给一个；不确定就别传' },
				industry: {
					type: 'string',
					enum: ['gov', 'news', 'acad', 'finance'],
					description: '限定垂直领域：gov 政务 / news 新闻 / acad 学术 / finance 财经；不确定就别传',
				},
				time_range: {
					type: 'string',
					enum: ['day', 'week', 'month', 'year'],
					description: '只要最近这段时间的内容时传（分别对应 1 天 / 7 天 / 1 个月 / 1 年）',
				},
			},
			required: ['query'],
		},
		run: webSearch,
	},
	// 站内检索与 /find 用的是同一份定义（含 categories / recent 两个模式）。
	// 访客问「你写过关于 XX 的吗」这类站内问题时用它 —— 站内的事不要用 web_search 去搜。
	SEARCH_TOOL,
];
