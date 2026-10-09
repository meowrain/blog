/**
 * 图床同源代理 —— EdgeOne Pages Function
 *
 * 路由由文件路径决定：本文件对应 `/api/i/*`。
 *
 *   GET /api/i/2025/07/19/xxx.webp
 *     ->  GET https://cnb.cool/meowyyds/img-bed/-/git/raw/main/public/api/i/2025/07/19/xxx.webp
 *
 * 与 blog.meowrain.cn 上 EdgeOne 控制台的「未命名规则」等价：
 *   - 回源 https://cnb.cool:443（Host 天然就是 cnb.cool）
 *   - URL 重写 ^/api/i/(.*)$ -> /meowyyds/img-bed/-/git/raw/main/public/api/i/$1
 *   - 响应头增加 Cross-Origin-Resource-Policy: cross-origin
 *   - 响应头设置 Access-Control-Allow-Origin: *
 *
 * cnb.cool 原始响应带 `Cross-Origin-Resource-Policy: same-origin` 和
 * `Access-Control-Allow-Origin: https://docs.cnb.cool`，直接透传会导致
 * 跨站 <img> 被浏览器拦掉，所以这两个头必须覆写而不是透传。
 */

const API_PREFIX = "/api/i/";
const UPSTREAM_ORIGIN = "https://cnb.cool";
const UPSTREAM_PATH_PREFIX = "/meowyyds/img-bed/-/git/raw/main/public/api/i/";
const TIMEOUT_MS = 15000;

// 覆写的响应头（对应 EO 规则里的两条「修改 HTTP 节点响应头」）。
const OVERRIDDEN_HEADERS = {
	"Cross-Origin-Resource-Policy": "cross-origin",
	"Access-Control-Allow-Origin": "*",
};

// 从上游响应中透传的头。默认带上 Etag / Last-Modified，
// 浏览器与边缘节点能据此做缓存协商。
const PASSTHROUGH_HEADERS = [
	"content-type",
	"content-disposition",
	"cache-control",
	"etag",
	"last-modified",
];

// 上游不带 Cache-Control 时给一个兜底值，git raw 按 main 分支取图，
// 内容可能随 push 变化，所以只敢缓存一小时。
const FALLBACK_CACHE_CONTROL = "public, max-age=3600";

export async function onRequest(context) {
	const { request } = context;

	if (request.method !== "GET" && request.method !== "HEAD") {
		return new Response("Method Not Allowed", {
			status: 405,
			headers: { Allow: "GET, HEAD", ...OVERRIDDEN_HEADERS },
		});
	}

	const url = new URL(request.url);

	// 等价于规则里的正则替换 ^/api/i/(.*)$ -> .../public/api/i/$1。
	// 直接从 pathname 截取而不是用 context.params，保留原始百分号编码。
	const rest = url.pathname.slice(API_PREFIX.length - 1).replace(/^\//, "");
	if (!rest || rest.split("/").some((seg) => seg === ".." || seg === ".")) {
		return new Response("Not Found", { status: 404, ...OVERRIDDEN_HEADERS });
	}

	const upstreamUrl =
		UPSTREAM_ORIGIN + UPSTREAM_PATH_PREFIX + rest + (url.search || "");

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const upstream = await fetch(upstreamUrl, {
			method: request.method,
			// 不带 Origin / Referer / Cookie，只声明预期内容类型。
			headers: { Accept: "*/*" },
			signal: controller.signal,
		});

		const headers = new Headers();
		for (const name of PASSTHROUGH_HEADERS) {
			const value = upstream.headers.get(name);
			if (value) {
				headers.set(name, value);
			}
		}
		if (!headers.has("cache-control")) {
			headers.set("Cache-Control", FALLBACK_CACHE_CONTROL);
		}
		for (const [name, value] of Object.entries(OVERRIDDEN_HEADERS)) {
			headers.set(name, value);
		}

		// 流式透传响应体，图片不整个读进内存；上游 404 等状态原样带回。
		return new Response(upstream.body, {
			status: upstream.status,
			headers,
		});
	} catch (error) {
		const aborted = error?.name === "AbortError";
		return new Response(aborted ? "Upstream Timeout" : "Bad Gateway", {
			status: aborted ? 504 : 502,
			...OVERRIDDEN_HEADERS,
		});
	} finally {
		clearTimeout(timer);
	}
}
