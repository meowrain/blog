/**
 * Komari 监控同源代理 —— EdgeOne Pages Function
 *
 * 路由由文件路径决定：本文件对应 `/api/komari/*`，页面只用 `/api/komari/rpc2`。
 *
 *   POST /api/komari/rpc2  ->  POST https://status.acetaffy.mom/api/rpc2
 *
 * 之所以要代理：Komari 上游会校验 Origin，浏览器带着站点的 Origin 直连会被
 * 403 拒掉（同源自访与不带 Origin 的请求才放行），所以 /monitor/ 页面无法
 * 直接从浏览器请求面板。服务端转发时不设 Origin 即可正常取数。
 *
 * 这里不是通用 JSON-RPC 代理：只接受 POST、只放行下面这份只读方法白名单、
 * 不转发 Cookie / Authorization，因此访问者拿不到面板账号的登录态，也无法
 * 借这台函数调用写入类方法。
 */

const API_PREFIX = "/api/komari/";
const UPSTREAM = "https://status.acetaffy.mom/api/rpc2";
const TIMEOUT_MS = 10000;
const MAX_BODY_BYTES = 8192;

// 只读方法白名单。新增前先确认它不会返回凭据类字段。
const ALLOWED_METHODS = new Set([
	"common:getVersion",
	"common:getNodes",
	"common:getNodesLatestStatus",
	"common:getRecords",
	"public:queryMetrics",
	"public:getPingMetricStats",
	"public:getPublicPingTasks",
]);

const JSON_HEADERS = {
	"content-type": "application/json; charset=utf-8",
	// 监控数据要实时，任何缓存都会让页面显示过期数值。
	"cache-control": "no-store",
};

function jsonResponse(body, status, headers = JSON_HEADERS) {
	return new Response(JSON.stringify(body), { status, headers });
}

// 上游用 JSON-RPC 错误对象回话，代理侧的拒绝也保持同样形状，前端只需看 error 一个分支。
function rpcError(message, code = -32000, status = 400, id = null) {
	return jsonResponse({ jsonrpc: "2.0", id, error: { code, message } }, status);
}

export async function onRequest(context) {
	const { request } = context;

	if (request.method !== "POST") {
		return rpcError("仅支持 POST 请求", -32600, 405);
	}

	const url = new URL(request.url);
	const rpcPath = url.pathname.slice(API_PREFIX.length).replace(/\/+$/, "");
	if (rpcPath !== "rpc2") {
		return rpcError("不支持的代理路径", -32601, 404);
	}

	let body;
	try {
		const raw = await request.text();
		if (raw.length > MAX_BODY_BYTES) {
			return rpcError("请求体过大", -32602, 413);
		}
		body = JSON.parse(raw);
	} catch {
		return rpcError("请求体不是合法 JSON", -32700);
	}

	// 只接受单条请求，批量数组会让白名单校验被绕过一半。
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return rpcError("仅支持单条 JSON-RPC 请求", -32600);
	}

	const method = body.method;
	// 回显 id 前先归一化，避免把任意类型原样写回响应。
	const id = Number.isInteger(body.id) ? body.id : 1;

	if (typeof method !== "string" || !ALLOWED_METHODS.has(method)) {
		return rpcError("方法不在只读白名单内", -32601, 403, id);
	}

	const params = body.params;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const upstream = await fetch(UPSTREAM, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			// 丢掉 Cookie / Authorization，也不带 Origin，
			// 否则上游的同源校验会直接 403。
			body: JSON.stringify({
				jsonrpc: "2.0",
				id,
				method,
				params: params && typeof params === "object" ? params : {},
			}),
			signal: controller.signal,
		});

		const text = await upstream.text();
		if (!upstream.ok) {
			return rpcError(
				`上游响应异常 (HTTP ${upstream.status})`,
				-32000,
				502,
				id,
			);
		}

		return new Response(text, { status: 200, headers: JSON_HEADERS });
	} catch (error) {
		const aborted = error?.name === "AbortError";
		return rpcError(
			aborted ? "上游请求超时" : "代理请求失败",
			-32000,
			aborted ? 504 : 502,
			id,
		);
	} finally {
		clearTimeout(timer);
	}
}
