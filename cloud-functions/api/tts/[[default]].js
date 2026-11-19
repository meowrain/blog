/**
 * 电台串词语音合成 —— EdgeOne Makers Cloud Function（Node.js 运行时）
 *
 * 路由由文件路径决定，本文件是 catch-all，对应 `/api/tts/*`：
 *
 *   POST /api/tts/say   body: { text, voice?, rate?, pitch? } → audio/mpeg
 *
 * 为什么不继续用浏览器的 `speechSynthesis`：音色完全取决于访客系统，Linux
 * 和不少安卓上只有一个机械音。这里统一换成 Edge 朗读同款的神经语音（默认
 * 晓晓），合成逻辑在 `cloud-functions/_edge-tts.js`。
 *
 * 前端拿到 404 / 非 200 就回落浏览器语音 —— 这条链路是加分项，不该成为
 * 「点了播放没反应」的原因。
 *
 * 限流：Blob 计数 `tts/<sha1(ip)>`，每小时 20 次。串词一次只合一次（同一次
 * 收听里队列里每首一条），正常访客远到不了上限；这个闸门是防止被拿去刷。
 */

import { getStore } from "@edgeone/pages-blob";
import {
	MAX_TEXT_CHARS,
	cleanText,
	synthesize,
} from "../../_edge-tts.js";

const STORE_NAME = "blog-stats";
const RATE_PREFIX = "tts/";
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000;

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...JSON_HEADERS, "cache-control": "no-store" },
	});
}

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
 * 记一次合成并判断是否超限。Blob 出错时放行 —— 限流是防刷，不是业务规则。
 */
async function takeRateSlot(ip) {
	try {
		const store = getStore({ name: STORE_NAME, consistency: "strong" });
		const key = `${RATE_PREFIX}${await sha1Hex(ip)}`;
		const now = Date.now();
		const raw = await store.get(key, { type: "json" }).catch(() => null);
		const hits = Array.isArray(raw?.hits)
			? raw.hits.filter((t) => now - Number(t) < RATE_WINDOW_MS)
			: [];
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

async function handleSay(request) {
	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: "请求体不是 JSON" }, 400);
	}

	const text = cleanText(body?.text);
	if (!text) return json({ error: "缺少要朗读的文字" }, 400);
	if (Array.from(String(body?.text ?? "")).length > MAX_TEXT_CHARS) {
		return json({ error: `串词最多 ${MAX_TEXT_CHARS} 字` }, 400);
	}

	const gate = await takeRateSlot(clientIp(request));
	if (!gate.allowed) {
		return json({ error: "合成太频繁了，稍后再试" }, 429);
	}

	let audio;
	try {
		audio = await synthesize(text, {
			voice: body?.voice,
			rate: body?.rate,
			pitch: body?.pitch,
		});
	} catch (error) {
		// 上层（微软）失效时打日志而不是把错误细节抖给前端；前端会回落浏览器语音
		console.warn("[tts] 合成失败", error instanceof Error ? error.message : error);
		return json({ error: "语音合成暂时不可用" }, 502);
	}

	return new Response(audio, {
		status: 200,
		headers: {
			"content-type": "audio/mpeg",
			"content-length": String(audio.length),
			// 同一段串词重复播放可以直接命中边缘缓存；音频不随 Cookie 变化
			"cache-control": "public, max-age=86400",
		},
	});
}

export async function onRequest(context) {
	const { request } = context;
	const method = request.method.toUpperCase();
	if (method === "OPTIONS") {
		return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
	}
	if (method !== "POST") return json({ error: "仅支持 POST" }, 405);

	const url = new URL(request.url);
	const action = url.pathname.split("/").filter(Boolean).pop() ?? "";
	if (action === "say") return handleSay(request);
	return json({ error: "未知的接口动作" }, 404);
}
