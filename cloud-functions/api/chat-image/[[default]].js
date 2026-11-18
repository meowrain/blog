/**
 * 聊天页图片上传代理 —— EdgeOne Makers Cloud Function（Node.js 运行时）
 *
 * 路由由文件路径决定，本文件是 catch-all，对应 `/api/chat-image/*`：
 *
 *   POST /api/chat-image/upload   multipart，字段名 `image` → { ok, url, name }
 *
 * 为什么要这一层（而不是像后台那样让浏览器直连图床）：
 * 后台 backend/src/admin/public/app.js 里是**硬编码 token 直传**，那是管理员页面；
 * 聊天页任何访客都能打开，token 一进前端就等于公开。所以 token 只留在
 * `context.env.IMAGE_BED_TOKEN`，由这层转发。
 *
 * 限流用 Blob 记数：`chat-upload/<sha1(ip)>`，每小时 10 次。
 * 这是防刷用的粗粒度闸门，不是配额系统；Blob 挂了就放行（宁可漏拦，也别让正常用户传不了图）。
 */

import { getStore } from "@edgeone/pages-blob";

const STORE_NAME = "blog-stats";
const RATE_PREFIX = "chat-upload/";
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000;

const MAX_BYTES = 5 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 15_000;
const DEFAULT_ENDPOINT = "https://img-edgeone.acetaffy.mom/api/index.php";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...JSON_HEADERS, "cache-control": "no-store" },
	});
}

/** 只认图片 magic bytes，扩展名和 Content-Type 都是客户端说了算的，不能作为依据 */
function sniffImageType(bytes) {
	if (bytes.length < 12) return "";
	const b = bytes;
	if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
	if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
	const ascii = (start, end) => String.fromCharCode(...b.subarray(start, end));
	if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
	// SVG 是可执行的（能带 script），heic 各端解码不一，都不收
	return "";
}

const EXT_BY_TYPE = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
};

function clientIp(request) {
	const headers = request.headers;
	return (
		headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
		headers.get("eo-client-ip") ||
		headers.get("x-real-ip") ||
		"unknown"
	);
}

async function sha1Hex(input) {
	const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
	return Array.from(new Uint8Array(buf))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * 记一次上传并判断是否超限。返回 { allowed, remaining }。
 * Blob 出错时放行 —— 限流是防刷，不是业务规则。
 */
async function takeRateSlot(ip) {
	try {
		const store = getStore({ name: STORE_NAME, consistency: "strong" });
		const key = `${RATE_PREFIX}${await sha1Hex(ip)}`;
		const now = Date.now();
		const raw = await store.get(key, { type: "json" }).catch(() => null);
		const hits = Array.isArray(raw?.hits) ? raw.hits.filter((t) => now - Number(t) < RATE_WINDOW_MS) : [];
		if (hits.length >= RATE_LIMIT) {
			return { allowed: false, remaining: 0 };
		}
		hits.push(now);
		await store.setJSON(key, { hits }).catch(() => {});
		return { allowed: true, remaining: RATE_LIMIT - hits.length };
	} catch {
		return { allowed: true, remaining: -1 };
	}
}

async function handleUpload(request, env) {
	const token = typeof env?.IMAGE_BED_TOKEN === "string" ? env.IMAGE_BED_TOKEN.trim() : "";
	const endpoint =
		typeof env?.IMAGE_BED_ENDPOINT === "string" && env.IMAGE_BED_ENDPOINT.trim()
			? env.IMAGE_BED_ENDPOINT.trim()
			: DEFAULT_ENDPOINT;
	if (!token) {
		return json({ error: "图片上传未配置" }, 503);
	}

	let form;
	try {
		form = await request.formData();
	} catch {
		return json({ error: "请求体不是 multipart/form-data" }, 400);
	}

	const file = form.get("image");
	if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
		return json({ error: "缺少 image 字段" }, 400);
	}
	if (file.size > MAX_BYTES) {
		return json({ error: "图片超过 5MB" }, 413);
	}

	const bytes = new Uint8Array(await file.arrayBuffer());
	const type = sniffImageType(bytes);
	if (!type) {
		return json({ error: "只支持 png / jpeg / webp / gif 图片" }, 415);
	}

	const gate = await takeRateSlot(clientIp(request));
	if (!gate.allowed) {
		return json({ error: "上传太频繁了，休息一会儿再试" }, 429);
	}

	const upstream = new FormData();
	upstream.append("image", new Blob([bytes], { type }), `chat-${Date.now()}.${EXT_BY_TYPE[type]}`);
	upstream.append("token", token);

	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), UPLOAD_TIMEOUT_MS);
	let resp;
	try {
		resp = await fetch(endpoint, { method: "POST", body: upstream, signal: ctl.signal });
	} catch {
		return json({ error: "图床连接失败，请稍后重试" }, 502);
	} finally {
		clearTimeout(timer);
	}

	// 图床失败时也常常回 200，只能看响应体里有没有 url
	const data = await resp.json().catch(() => null);
	const url = typeof data?.url === "string" ? data.url.trim() : "";
	if (!url) {
		return json({ error: data?.message || `图床返回异常（HTTP ${resp.status}）` }, 502);
	}
	if (!/^https?:\/\//i.test(url)) {
		return json({ error: "图床返回的地址不合法" }, 502);
	}

	return json({
		ok: true,
		url,
		name: typeof data?.srcName === "string" ? data.srcName : "",
		remaining: gate.remaining,
	});
}

export async function onRequest(context) {
	const { request, env } = context;
	const method = request.method.toUpperCase();
	if (method === "OPTIONS") {
		return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
	}
	if (method !== "POST") {
		return json({ error: "仅支持 POST" }, 405);
	}

	const url = new URL(request.url);
	const action = url.pathname.split("/").filter(Boolean).pop() ?? "";
	if (action === "upload") return handleUpload(request, env);
	return json({ error: "未知的接口动作" }, 404);
}
