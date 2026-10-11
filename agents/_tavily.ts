import { createLogger } from './_shared';

const logger = createLogger('tavily');

/**
 * Tavily 检索客户端 —— 联网搜索走 /search，抓某个 URL 的正文走 /extract。
 *
 * 平台自带的 context.tools.web_search 背后是腾讯云 WSA（要单独开通、另配 WSA_API_KEY），
 * 这里改用 Tavily：只认 TAVILY_API_KEY，返回里自带摘要片段和（news 主题的）发布时间。
 * 和别的 agent 模块一样不引三方包，直接 fetch —— agent bundle 对额外依赖很脆。
 */

const API_BASE = 'https://api.tavily.com';
/** 上游超时：卡住比报错更糟，超时至少能让模型换个关键词重试 */
const TIMEOUT_MS = 20_000;

export type TavilyTopic = 'general' | 'news';
export type TavilyTimeRange = 'day' | 'week' | 'month' | 'year';

export interface TavilySearchResult {
	title: string;
	url: string;
	/** Tavily 给的相关性摘要，不是全文（要全文用 tavilyExtract） */
	content: string;
	score: number;
	/** 只有 topic=news 才有 */
	published?: string;
}

export interface TavilySearchParams {
	apiKey: string;
	query: string;
	maxResults?: number;
	topic?: TavilyTopic;
	timeRange?: TavilyTimeRange;
	/** 只在这些域名里搜 */
	includeDomains?: string[];
	signal?: AbortSignal;
}

export interface TavilySearchResponse {
	answer: string;
	results: TavilySearchResult[];
}

export interface TavilyExtractResult {
	url: string;
	content: string;
}

/**
 * 统一出口：把「用户点了停止」的外部 signal 和我们自己的超时合成一个 signal。
 * 超时要单独报错，不能混进 abort 里被上层当成「用户主动停的」静默吞掉。
 */
async function tavilyFetch(
	path: string,
	apiKey: string,
	payload: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, TIMEOUT_MS);
	const onAbort = () => controller.abort();
	if (signal) {
		if (signal.aborted) onAbort();
		else signal.addEventListener('abort', onAbort, { once: true });
	}

	try {
		const resp = await fetch(`${API_BASE}${path}`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
			body: JSON.stringify(payload),
			signal: controller.signal,
		});
		const text = await resp.text();
		if (!resp.ok) {
			logger.error('POST %s HTTP %d: %s', path, resp.status, text.slice(0, 300));
			throw new Error(`Tavily ${path} 返回 HTTP ${resp.status}：${text.slice(0, 200)}`);
		}
		try {
			return JSON.parse(text) as Record<string, unknown>;
		} catch {
			throw new Error(`Tavily ${path} 返回的不是 JSON`);
		}
	} catch (e) {
		if (timedOut) throw new Error(`Tavily ${path} 超时（${TIMEOUT_MS / 1000}s）`);
		throw e;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
	}
}

export async function tavilySearch(params: TavilySearchParams): Promise<TavilySearchResponse> {
	const data = await tavilyFetch(
		'/search',
		params.apiKey,
		{
			query: params.query,
			max_results: params.maxResults ?? 5,
			search_depth: 'basic',
			topic: params.topic ?? 'general',
			// 摘要由我们自己组织给模型看，不要 Tavily 的 answer，省一次不确定性
			include_answer: false,
			...(params.includeDomains?.length ? { include_domains: params.includeDomains } : {}),
			...(params.timeRange ? { time_range: params.timeRange } : {}),
		},
		params.signal,
	);

	const raw = Array.isArray(data.results) ? (data.results as Record<string, unknown>[]) : [];
	const results: TavilySearchResult[] = raw
		.map((r) => ({
			title: String(r?.title ?? '').trim(),
			url: String(r?.url ?? '').trim(),
			content: String(r?.content ?? '').trim(),
			score: Number(r?.score ?? 0),
			...(r?.published_date ? { published: String(r.published_date) } : {}),
		}))
		.filter((r) => r.url);

	logger.log('search q=%s results=%d', params.query, results.length);
	return { answer: typeof data.answer === 'string' ? data.answer : '', results };
}

export async function tavilyExtract(params: {
	apiKey: string;
	urls: string[];
	signal?: AbortSignal;
}): Promise<TavilyExtractResult[]> {
	const data = await tavilyFetch('/extract', params.apiKey, { urls: params.urls }, params.signal);
	const raw = Array.isArray(data.results) ? (data.results as Record<string, unknown>[]) : [];
	const results = raw
		.map((r) => ({ url: String(r?.url ?? '').trim(), content: String(r?.raw_content ?? '') }))
		.filter((r) => r.url && r.content.trim());

	if (!results.length) {
		const failed = Array.isArray(data.failed_results) ? data.failed_results.length : 0;
		logger.error('extract 没拿到正文 urls=%d failed=%d', params.urls.length, failed);
	}
	return results;
}