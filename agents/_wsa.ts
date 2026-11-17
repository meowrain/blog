import { createLogger } from './_shared';

const logger = createLogger('wsa');

/**
 * 腾讯云元宝搜索（Web Search API / WSA）客户端。
 *
 * 只做一件事：把一个查询词变成一组带摘要的网页结果。抓正文的能力该接口不提供，
 * 所以 read_page 这个工具已经下线（之前靠 Tavily 的 /extract 撑着）。
 *
 * ## 为什么走 TC3 签名而不是 Bearer
 *
 * 这个接口有两条鉴权路子：
 * 1. `api.wsa.cloud.tencent.com` + `Authorization: Bearer <服务 API KEY>` —— 平台内置的
 *    `context.tools.web_search` 用的就是这条，但那个 key 只能在腾讯云控制台单独创建；
 * 2. `wsa.tencentcloudapi.com` + `TC3-HMAC-SHA256` 签名 —— 用账号的 SecretId/SecretKey，
 *    和腾讯云其它云 API 一致。
 *
 * 这里选 2：凭据是云账号已有的，不用再申请一套。代价是要手写签名，见 sign()。
 *
 * ## 为什么用 WebCrypto 而不是 node:crypto
 *
 * agent bundle 对外部依赖极敏感（见 _model.ts 顶部）。`crypto.subtle` 是全局可用的
 * WebCrypto，cloud-functions 里已经在用（api/stats 的 sha1），不引任何包。
 */

const HOST = 'wsa.tencentcloudapi.com';
/** 域名前缀，参与签名路径 Date/service/tc3_request */
const SERVICE = 'wsa';
const ACTION = 'SearchPro';
const VERSION = '2025-05-08';
const CONTENT_TYPE = 'application/json; charset=utf-8';

/** 卡住比报错更糟：超时至少能让模型换个说法重试 */
const TIMEOUT_MS = 20_000;
/** 单条摘要截断长度（passage / content 两段，content 通常更长） */
const SNIPPET_CHARS = 600;

/** 官方错误码 → 给模型/日志看的中文说明 */
const ERROR_HINTS: Record<string, string> = {
	'AuthFailure.SecretIdNotFound': 'SecretId 不存在，检查 WSA_SECRET_ID 是否填错或已被删除',
	'AuthFailure.SignatureFailure': '请求签名校验失败，检查 WSA_SECRET_KEY 是否正确',
	'AuthFailure.SignatureExpire': '签名已过期，通常是服务器时间偏差超过 5 分钟',
	'AuthFailure.UnauthorizedOperation': '该密钥没有调用元宝搜索的权限，检查子账号策略',
	UnauthorizedOperation: '未授权：检查密钥权限，或确认已开通元宝搜索服务',
	ResourceNotFound: '账号未开通元宝搜索服务，需要主账号在腾讯云控制台开通',
	ResourceUnavailable: '搜索服务不可用（账号可能欠费）',
	RequestLimitExceeded: '触发频率限制，稍后重试',
	InvalidParameter: '请求参数不合法',
	InternalError: '服务端内部错误，稍后重试',
};

export type WsaMode = 0 | 1 | 2;
export type WsaIndustry = 'gov' | 'news' | 'acad' | 'finance';

export interface WsaSearchResult {
	title: string;
	url: string;
	/** 标准摘要，一定返回 */
	passage: string;
	/** 动态摘要，极速版不返回；通常比 passage 长一点 */
	content: string;
	site: string;
	/** 原始格式如 "2026/07/24 04:18:22"，不做改写 */
	date: string;
	/** 相关性 0~1，极速版不返回 */
	score?: number;
}

export interface WsaSearchParams {
	secretId: string;
	secretKey: string;
	query: string;
	/** 本地截断到几条（接口 Cnt 只认 10/20/30/40/50，这里按 10 拿再切） */
	maxResults?: number;
	/** 限定单个域名，如 "zhihu.com" */
	site?: string;
	/** 0 公开网页 / 1 优质权威垂直信源 / 2 混合，默认 0 */
	mode?: WsaMode;
	/** 垂直领域，极速版不支持 */
	industry?: WsaIndustry;
	/** 时间范围：d1~d30 / m1~m12 / y1~y5 / 单日 / 区间 */
	freshness?: string;
	signal?: AbortSignal;
}

export interface WsaSearchResponse {
	results: WsaSearchResult[];
	/** lite / standard / flagship —— 不同版本返回字段不一样 */
	version: string;
	requestId: string;
}

/* ── TC3-HMAC-SHA256 签名（腾讯云签名方法 v3） ── */

function toHex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

async function sha256Hex(text: string): Promise<string> {
	return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
	const imported = await crypto.subtle.importKey(
		'raw',
		key as BufferSource,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	return crypto.subtle.sign('HMAC', imported, new TextEncoder().encode(message));
}

interface SignedRequest {
	authorization: string;
	timestamp: number;
}

/**
 * 拼 Authorization 头。四步走：
 * 1. 规范请求串（方法/POST、路径 `/`、空 query、规范头、签名头、payload 哈希）
 * 2. 待签名字符串（算法、时间戳、凭证范围、规范请求串哈希）
 * 3. 派生签名密钥（TC3+SecretKey → date → service → tc3_request 逐层 HMAC）
 * 4. 拼 Credential / SignedHeaders / Signature
 *
 * ⚠️ 日期必须取 `X-TC-Timestamp` 对应的 **UTC** 日期，不是本地日期 —— 这是最常见的踩坑点。
 */
async function sign(payload: string, secretId: string, secretKey: string): Promise<SignedRequest> {
	const timestamp = Math.floor(Date.now() / 1000);
	const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

	// content-type 与 host 是必签字段；x-tc-action 一并签进去（官方示例的做法）
	const canonicalHeaders = `content-type:${CONTENT_TYPE}\nhost:${HOST}\nx-tc-action:${ACTION.toLowerCase()}\n`;
	const signedHeaders = 'content-type;host;x-tc-action';
	const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, await sha256Hex(payload)].join('\n');

	const scope = `${date}/${SERVICE}/tc3_request`;
	const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), scope, await sha256Hex(canonicalRequest)].join('\n');

	const kDate = await hmacSha256(new TextEncoder().encode(`TC3${secretKey}`), date);
	const kService = await hmacSha256(kDate, SERVICE);
	const kSigning = await hmacSha256(kService, 'tc3_request');
	const signature = toHex(await hmacSha256(kSigning, stringToSign));

	return {
		timestamp,
		authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
	};
}

/** 把「用户点了停止」和内部超时合成一个 signal，两者要能区分开（超时不该被当成主动停止） */
async function post(
	payload: Record<string, unknown>,
	secretId: string,
	secretKey: string,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	const body = JSON.stringify(payload);
	const { authorization, timestamp } = await sign(body, secretId, secretKey);

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
		const resp = await fetch(`https://${HOST}`, {
			method: 'POST',
			headers: {
				Authorization: authorization,
				'Content-Type': CONTENT_TYPE,
				'X-TC-Action': ACTION,
				'X-TC-Timestamp': String(timestamp),
				'X-TC-Version': VERSION,
			},
			body,
			signal: controller.signal,
		});
		const text = await resp.text();

		// 接口用 HTTP 200 包业务错误，所以不能只看 status
		let data: Record<string, unknown>;
		try {
			data = JSON.parse(text) as Record<string, unknown>;
		} catch {
			throw new Error(`元宝搜索返回的不是 JSON（HTTP ${resp.status}）：${text.slice(0, 200)}`);
		}

		const root = data?.Response && typeof data.Response === 'object' ? (data.Response as Record<string, unknown>) : data;
		const error = root?.Error as { Code?: string; Message?: string } | undefined;
		if (error?.Code) {
			const hint = ERROR_HINTS[error.Code] ?? '搜索请求失败';
			logger.error('SearchPro %s: %s', error.Code, String(error.Message ?? '').slice(0, 200));
			throw new Error(`元宝搜索失败：${hint}（${error.Code}${error.Message ? `：${error.Message}` : ''}）`);
		}
		if (!resp.ok) {
			throw new Error(`元宝搜索返回 HTTP ${resp.status}：${text.slice(0, 200)}`);
		}
		return root;
	} catch (e) {
		if (timedOut) throw new Error(`元宝搜索超时（${TIMEOUT_MS / 1000}s）`);
		throw e;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
	}
}

/**
 * `Pages` 里每个元素是一段 JSON **字符串**（实测确认），要再 parse 一次。
 * 解析失败的条目直接跳过 —— 一条脏数据不该让整次搜索失败。
 */
function parsePages(raw: unknown): Record<string, unknown>[] {
	if (!Array.isArray(raw)) return [];
	const pages: Record<string, unknown>[] = [];
	for (const entry of raw) {
		let parsed: unknown = entry;
		if (typeof entry === 'string') {
			try {
				parsed = JSON.parse(entry);
			} catch {
				continue;
			}
		}
		if (parsed && typeof parsed === 'object') pages.push(parsed as Record<string, unknown>);
	}
	return pages;
}

export async function wsaSearch(params: WsaSearchParams): Promise<WsaSearchResponse> {
	const body: Record<string, unknown> = { Query: params.query };
	if (params.site?.trim()) body.Site = params.site.trim();
	if (params.mode !== undefined) body.Mode = params.mode;
	if (params.industry) body.Industry = params.industry;
	if (params.freshness) body.Freshness = params.freshness;

	const root = await post(body, params.secretId, params.secretKey, params.signal);
	const max = params.maxResults && params.maxResults > 0 ? params.maxResults : 5;

	const seen = new Set<string>();
	const results: WsaSearchResult[] = [];
	for (const page of parsePages(root.Pages)) {
		const url = String(page.url ?? '').trim();
		if (!url || seen.has(url)) continue;
		seen.add(url);

		const content = String(page.content ?? '').trim();
		const passage = String(page.passage ?? '').trim();
		const score = Number(page.score);

		results.push({
			title: String(page.title ?? '').trim() || url,
			url,
			passage: passage.slice(0, SNIPPET_CHARS),
			content: content.slice(0, SNIPPET_CHARS),
			site: String(page.site ?? '').trim(),
			date: String(page.date ?? '').trim(),
			...(Number.isFinite(score) ? { score } : {}),
		});
		if (results.length >= max) break;
	}

	const version = String(root.Version ?? '');
	const requestId = String(root.RequestId ?? '');
	logger.log('search q=%s version=%s results=%d', params.query, version || '-', results.length);
	return { results, version, requestId };
}
