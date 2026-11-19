/**
 * 自建访问统计 —— EdgeOne Makers Cloud Function（Node.js 运行时）
 *
 * 路由由文件路径决定，本文件是 catch-all，对应 `/api/stats/*`：
 *
 *   POST /api/stats/collect        采集一次页面访问（前端用 sendBeacon 发）
 *        body: { p: pathname, r?: referrer, t?: title, i?: 1 表示站内跳转 }
 *   GET  /api/stats/page?path=...  取单篇文章的 { views, visitors }（公开，供文章头/侧栏用）
 *   GET  /api/stats/summary?days=30 仪表盘聚合数据（配了 STATS_TOKEN 才需要鉴权）
 *
 * 存储：@edgeone/pages-blob（平台无数据库，Blob 就是库）。键位约定：
 *   pages/<sha1(path)>.json         单篇文章累计 views/visitors/title
 *   pv/<sha1(path)>/<vid>.json      该文去重访客标记（决定 visitors 是否 +1）
 *   site.json                       全站累计
 *   sv/<vid>.json                   全站去重访客标记
 *   daily/<YYYY-MM-DD>.json         每日 views/visitors + 维度分布（图表/表格数据源）
 *       额外字段：refs/devices/browsers/oses/countries/regions（{ 名称: 访问量 }）、
 *       hours（长度 24 的数组）、audience（{ new, returning }）、newVisitors。
 *       维度是按「访问量」计数的，同一人多次访问会计多次；旧文档没有这些字段时
 *       前端会显示「该维度从上线后开始采集」。
 *   dv/<day>/<vid>.json             每日去重访客标记
 *   throttle/<sha1(path|vid)>.json  同一访客 30 分钟内同页只算一次，防刷新灌水
 *
 * 访客识别：优先读 `_nbv` cookie（本函数首次采集时下发，HttpOnly），
 * 没有则用 sha1(salt + clientIp + ua) 兜底。cookie 更准，hash 兜底可跨 cookie 清除。
 */

import { getStore } from "@edgeone/pages-blob";
// 云函数独立打包，内部模块只能放 cloud-functions 根目录再相对引用。
import {
	classifyBrowser,
	classifyDevice,
	classifyOS,
	classifyReferrer,
	geoInfo,
	incBucket,
	incHour,
	mergeBuckets,
	mergeHours,
	summarizeSeries,
	weekdayBreakdown,
} from "../../_stats-dimensions.js";

const STORE_NAME = "blog-stats";
const THROTTLE_MS = 30 * 60 * 1000; // 同人同页 30 分钟只计一次
const DEFAULT_SALT = "meowrain-blog-stats-v1";

// 静态资源后缀：这些请求不计入访问（图片/CSS/JS 等）。
const STATIC_EXT =
	/\.(?:js|mjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|json|xml|txt|webmanifest)$/i;

// 需要统计的路径过滤：只统计“页面”，跳过接口与静态文件。
function normalizePath(raw) {
	if (typeof raw !== "string" || raw.length === 0) return null;
	let p = raw.split("?")[0].split("#")[0];
	if (!p.startsWith("/")) {
		try {
			p = new URL(p).pathname;
		} catch {
			p = `/${p}`;
		}
	}
	if (p.startsWith("/api/") || p === "/api") return null;
	if (p.startsWith("/_astro/")) return null;
	if (STATIC_EXT.test(p)) return null;
	// 归一化：去掉末尾多余斜杠之外的什么都不改（保留 /posts/x/ 这种 trailing slash）
	if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1) + "/";
	return p;
}

function sha1Hex(input) {
	return crypto.subtle
		.digest("SHA-1", new TextEncoder().encode(input))
		.then((buf) =>
			Array.from(new Uint8Array(buf))
				.map((b) => b.toString(16).padStart(2, "0"))
				.join(""),
		);
}

// 用固定时区算 YYYY-MM-DD，避免服务器 UTC 与站长本地日期错开。
function dayKey(date = new Date()) {
	const fmt = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
	return fmt.format(date); // en-CA => YYYY-MM-DD
}

function hostOf(url) {
	try {
		return new URL(url).hostname;
	} catch {
		return "";
	}
}

function getCookie(request, name) {
	const header = request.headers.get("Cookie") || "";
	for (const part of header.split(";")) {
		const [k, ...rest] = part.trim().split("=");
		if (k === name) return rest.join("=");
	}
	return null;
}

async function resolveVisitor(request, context) {
	const existing = getCookie(request, "_nbv");
	if (existing && /^[a-f0-9]{16,64}$/i.test(existing)) {
		return { vid: existing.toLowerCase(), setCookie: false };
	}
	const salt = context.env?.STATS_SALT || DEFAULT_SALT;
	const ip = context.clientIp || "0.0.0.0";
	const ua = request.headers.get("user-agent") || "";
	const vid = await sha1Hex(`${salt}|${ip}|${ua}`);
	return { vid, setCookie: true };
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
			...extraHeaders,
		},
	});
}

// ─── 采集 ──────────────────────────────────────────────────────────

async function handleCollect(request, context) {
	const store = getStore({ name: STORE_NAME, consistency: "strong" });

	let body;
	try {
		const raw = await request.text();
		body = JSON.parse(raw);
	} catch {
		return jsonResponse({ error: "请求体不是合法 JSON" }, 400);
	}

	const path = normalizePath(body?.p);
	if (!path) return jsonResponse({ ok: true, skipped: true });

	const title = typeof body?.t === "string" ? body.t.slice(0, 200) : "";
	const { vid, setCookie } = await resolveVisitor(request, context);
	// 节流：同一访客同页 30 分钟内只计一次，挡掉刷新 / 多点几下。
	const throttleKey = `throttle/${await sha1Hex(`${path}|${vid}`)}.json`;
	const last = await store.get(throttleKey, { type: "json" });
	if (
		last &&
		typeof last.ts === "number" &&
		Date.now() - last.ts < THROTTLE_MS
	) {
		return jsonResponse(
			{ ok: true, throttled: true },
			200,
			cookieHeader(setCookie, vid, request),
		);
	}
	await store.setJSON(throttleKey, { ts: Date.now() });

	const pathId = await sha1Hex(path);
	const day = dayKey();

	// 1) 单篇累计
	const pageKey = `pages/${pathId}.json`;
	const page = (await store.get(pageKey, { type: "json" })) || {
		path,
		title,
		views: 0,
		visitors: 0,
	};
	page.views += 1;
	if (title) page.title = title;
	page.lastAt = Date.now();
	const pvKey = `pv/${pathId}/${vid}.json`;
	if (!(await store.get(pvKey))) {
		await store.set(pvKey, "1");
		page.visitors += 1;
	}
	await store.setJSON(pageKey, page);

	// 2) 全站累计
	const site = (await store.get("site.json", { type: "json" })) || {
		views: 0,
		visitors: 0,
	};
	site.views += 1;
	site.lastAt = Date.now();
	const svKey = `sv/${vid}.json`;
	// 全站第一次出现即「新访客」，后面用它统计新老比例。
	const isNewVisitor = !(await store.get(svKey));
	if (isNewVisitor) {
		await store.set(svKey, "1");
		site.visitors += 1;
	}
	await store.setJSON("site.json", site);

	// 3) 每日累计 + 维度分布
	const dailyKey = `daily/${day}.json`;
	const daily = (await store.get(dailyKey, { type: "json" })) || {
		date: day,
		views: 0,
		visitors: 0,
	};
	daily.views += 1;
	const dvKey = `dv/${day}/${vid}.json`;
	if (!(await store.get(dvKey))) {
		await store.set(dvKey, "1");
		daily.visitors += 1;
	}
	if (isNewVisitor) daily.newVisitors = (daily.newVisitors || 0) + 1;

	// 维度都按「访问量」计数；数据缺失（如拿不到 geo）直接跳过，不落「未知」。
	const ua = request.headers.get("user-agent") || "";
	const selfHost = hostOf(request.url);
	incBucket(
		daily,
		"refs",
		classifyReferrer(body?.r, body?.i === 1 || body?.i === true, selfHost),
	);
	incBucket(daily, "devices", classifyDevice(ua));
	incBucket(daily, "browsers", classifyBrowser(ua));
	incBucket(daily, "oses", classifyOS(ua));
	const { country, region } = geoInfo(context);
	incBucket(daily, "countries", country);
	incBucket(daily, "regions", region);
	incHour(daily);
	await store.setJSON(dailyKey, daily);

	return jsonResponse({ ok: true }, 200, cookieHeader(setCookie, vid, request));
}

function cookieHeader(setCookie, vid, request) {
	if (!setCookie) return {};
	// 一年有效期，HttpOnly + SameSite=Lax；这是访客标识，不是凭据。
	// HTTPS 请求才加 Secure（本地 http 调试时不加，否则浏览器不保存）。
	const maxAge = 365 * 24 * 3600;
	const secure = isHttps(request) ? "; Secure" : "";
	return {
		"set-cookie": `_nbv=${vid}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`,
	};
}

function isHttps(request) {
	const proto = request.headers.get("x-forwarded-proto");
	if (proto) return proto.split(",")[0].trim() === "https";
	try {
		return new URL(request.url).protocol === "https:";
	} catch {
		return false;
	}
}

// ─── 单篇查询（公开） ──────────────────────────────────────────────

async function handlePage(request) {
	const url = new URL(request.url);
	const path = normalizePath(url.searchParams.get("path"));
	if (!path) return jsonResponse({ views: 0, visitors: 0 });
	const store = getStore({ name: STORE_NAME, consistency: "strong" });
	const pathId = await sha1Hex(path);
	const doc = await store.get(`pages/${pathId}.json`, { type: "json" });
	return jsonResponse({
		path,
		views: doc?.views ?? 0,
		visitors: doc?.visitors ?? 0,
	});
}

// ─── 全站累计（公开，供侧栏 Profile 用） ───────────────────────────

async function handleSite() {
	const store = getStore({ name: STORE_NAME, consistency: "strong" });
	const site = (await store.get("site.json", { type: "json" })) || {
		views: 0,
		visitors: 0,
	};
	return jsonResponse({ views: site.views ?? 0, visitors: site.visitors ?? 0 });
}

// ─── 仪表盘聚合（配了 STATS_TOKEN 才鉴权） ─────────────────────────

function checkAuth(request, context) {
	const token = context.env?.STATS_TOKEN;
	if (!token) return true; // 未配置则不设防（自建自用）
	const url = new URL(request.url);
	const given =
		url.searchParams.get("token") || request.headers.get("x-stats-token");
	return given === token;
}

async function handleSummary(request, context) {
	if (!checkAuth(request, context)) {
		return jsonResponse({ error: "unauthorized" }, 401);
	}
	const store = getStore({ name: STORE_NAME, consistency: "strong" });
	const url = new URL(request.url);
	const days = Math.min(
		Math.max(Number(url.searchParams.get("days")) || 30, 7),
		90,
	);

	const site = (await store.get("site.json", { type: "json" })) || {
		views: 0,
		visitors: 0,
	};

	// 每日序列：读全部 daily/*，按日期正序取最后 N 天（缺日期补 0）。
	const { blobs } = await store.list({ prefix: "daily/" });
	const dailyDocs = await Promise.all(
		blobs.map((b) => store.get(b.key, { type: "json" })),
	);
	const byDate = new Map();
	for (const d of dailyDocs) {
		if (d && d.date) byDate.set(d.date, d);
	}
	const series = [];
	const rangeDocs = [];
	const today = new Date();
	for (let i = days - 1; i >= 0; i -= 1) {
		const d = new Date(today);
		d.setDate(d.getDate() - i);
		const key = dayKey(d);
		const hit = byDate.get(key);
		if (hit) rangeDocs.push(hit);
		series.push({
			date: key,
			views: hit?.views ?? 0,
			visitors: hit?.visitors ?? 0,
			newVisitors: hit?.newVisitors ?? 0,
		});
	}
	const todayStat = series[series.length - 1] || {
		date: dayKey(),
		views: 0,
		visitors: 0,
		newVisitors: 0,
	};

	// 页面表：读所有 pages/*，按 views 降序；完整列表用来算「有访问的页面数」。
	const pageList = await store.list({ prefix: "pages/" });
	const pageDocs = await Promise.all(
		pageList.blobs.map((b) => store.get(b.key, { type: "json" })),
	);
	const rankedPages = pageDocs
		.filter((d) => d && d.path)
		.sort((a, b) => (b.views || 0) - (a.views || 0))
		.map((d) => ({
			path: d.path,
			title: d.title || d.path,
			views: d.views || 0,
			visitors: d.visitors || 0,
			lastAt: d.lastAt || 0,
		}));
	const topPages = rankedPages.slice(0, 12);
	// 最近活跃单独排一份：按最后访问时间，而不是访问量。
	const recentPages = [...rankedPages]
		.filter((p) => p.lastAt > 0)
		.sort((a, b) => b.lastAt - a.lastAt)
		.slice(0, 12);

	// 维度分布：多天合并后按访问量排序，尾巴并入「其他」。
	const dimensions = {
		referrers: mergeBuckets(rangeDocs, "refs"),
		devices: mergeBuckets(rangeDocs, "devices"),
		browsers: mergeBuckets(rangeDocs, "browsers"),
		oses: mergeBuckets(rangeDocs, "oses"),
		countries: mergeBuckets(rangeDocs, "countries"),
		regions: mergeBuckets(rangeDocs, "regions"),
	};
	// 覆盖多少天真正有维度数据，前端据此提示「从上线后开始采集」。
	const dimensionDays = rangeDocs.filter(
		(d) => d.refs || d.devices || d.browsers || d.oses || d.countries,
	).length;

	const hours = mergeHours(rangeDocs);
	const weekdays = weekdayBreakdown(series);
	const newVisitors = rangeDocs.reduce((n, d) => n + (d.newVisitors || 0), 0);
	const returningVisitors = Math.max(
		0,
		series.reduce((n, d) => n + d.visitors, 0) - newVisitors,
	);
	const rangeViews = series.reduce((n, d) => n + d.views, 0);
	const rangeVisitors = series.reduce((n, d) => n + d.visitors, 0);

	return jsonResponse({
		site,
		today: todayStat,
		series,
		topPages,
		recentPages,
		range: {
			days,
			views: rangeViews,
			visitors: rangeVisitors,
			newVisitors,
			daysWithData: rangeDocs.length,
		},
		summary: summarizeSeries(series, hours),
		dimensions,
		dimensionDays,
		hours,
		weekdays,
		audience: {
			new: newVisitors,
			returning: returningVisitors,
			// 访问深度：人均看了几个页面。
			viewsPerVisitor:
				rangeVisitors > 0
					? Math.round((rangeViews / rangeVisitors) * 100) / 100
					: 0,
		},
		pages: {
			total: rankedPages.length,
			withTraffic: rankedPages.filter((p) => p.views > 0).length,
		},
		generatedAt: new Date().toISOString(),
	});
}

// ─── 路由 ─────────────────────────────────────────────────────────

const PREFIX = "/api/stats/";

export async function onRequest(context) {
	const { request } = context;
	const url = new URL(request.url);
	const sub = url.pathname.slice(PREFIX.length).replace(/\/+$/, "");

	try {
		if (sub === "collect") {
			if (request.method !== "POST") {
				return jsonResponse({ error: "仅支持 POST" }, 405);
			}
			return await handleCollect(request, context);
		}
		if (sub === "page") {
			return await handlePage(request);
		}
		if (sub === "site") {
			return await handleSite();
		}
		if (sub === "summary") {
			return await handleSummary(request, context);
		}
		return jsonResponse({ error: "不支持的路径" }, 404);
	} catch (error) {
		console.error("[stats] 处理失败:", error);
		return jsonResponse(
			{ error: error instanceof Error ? error.message : "统计服务异常" },
			502,
		);
	}
}
