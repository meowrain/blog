/**
 * 自建访问统计的前端 SDK（同源于 /api/stats/*，见 cloud-functions/api/stats/[[default]].js）。
 *
 * 职责：
 *   1. collectPageview()：每次页面视图上报一次（sendBeacon，失败静默）。
 *   2. loadPageViews(path)：取单篇文章 views/visitors，填充 [data-page-views]/[data-page-visitors]。
 *   3. loadSiteStats()：取全站 views/visitors，填充 #site-views / #site-visitors。
 *
 * Swup 换页后由 Layout 里的 mounted 钩子再次调用 collectPageview()，并把数据重新
 * 填进新渲染出来的 DOM（内联脚本不会随 Swup 重跑，所以统计统一收在这里）。
 */

import { statsConfig } from "../config";

const COLLECT_URL = "/api/stats/collect";
const PAGE_URL = "/api/stats/page";

/** 上报一次页面访问。path 默认用当前 location。 */
export function collectPageview(overrides?: {
	path?: string;
	title?: string;
}): void {
	if (typeof window === "undefined") return;
	if (!statsConfig.enable) return;
	const payload = JSON.stringify({
		p: overrides?.path || location.pathname,
		t: overrides?.title || document.title,
		r: document.referrer || "",
	});
	// 优先 sendBeacon（切页/关页也能发出）；不支持时退回 keepalive fetch。
	if (navigator.sendBeacon) {
		const blob = new Blob([payload], { type: "application/json" });
		navigator.sendBeacon(COLLECT_URL, blob);
		return;
	}
	void fetch(COLLECT_URL, {
		method: "POST",
		body: payload,
		headers: { "content-type": "application/json" },
		keepalive: true,
	}).catch(() => {});
}

/** 读取单篇文章统计，填充页面上的占位元素。失败保持原样（-）。 */
export async function loadPageViews(slugOrPath: string): Promise<void> {
	if (typeof document === "undefined") return;
	if (!statsConfig.enable) return;
	const path = slugOrPath.startsWith("/")
		? slugOrPath
		: `/posts/${slugOrPath}/`;
	const key = slugOrPath; // data-* 用的是 slug（与 PostMeta 一致）
	let views = "-";
	let visitors = "-";
	try {
		const res = await fetch(`${PAGE_URL}?path=${encodeURIComponent(path)}`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();
		views = `${data.views || 0} 次`;
		visitors = `${data.visitors || 0} 人`;
	} catch (error) {
		console.error("Error fetching page views:", error);
	}
	const esc = (value: string) => value.replace(/["\\]/g, (m) => `\\${m}`);
	for (const el of document.querySelectorAll(
		`[data-page-views="${esc(key)}"]`,
	)) {
		el.textContent = views;
	}
	for (const el of document.querySelectorAll(
		`[data-page-visitors="${esc(key)}"]`,
	)) {
		el.textContent = visitors;
	}
}

/** 读取全站统计，填充侧栏 Profile。 */
export async function loadSiteStats(): Promise<void> {
	if (typeof document === "undefined") return;
	if (!statsConfig.enable) return;
	const viewsEl = document.getElementById("site-views");
	const visitorsEl = document.getElementById("site-visitors");
	if (!viewsEl && !visitorsEl) return;
	try {
		const res = await fetch(`${PAGE_URL.replace("/page", "/site")}`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();
		if (viewsEl) viewsEl.textContent = String(data.views || 0);
		if (visitorsEl) visitorsEl.textContent = String(data.visitors || 0);
	} catch (error) {
		console.error("获取全站统计失败:", error);
	}
}

/**
 * 挂载所有统计：上报当前页 + 回填页内所有 [data-page-*] + 回填全站。
 * Layout 在首次加载和 Swup 的 page:view 时各调一次。
 */
export function mountStats(): void {
	if (typeof document === "undefined") return;
	collectPageview();
	for (const el of document.querySelectorAll<HTMLElement>(
		"[data-page-views]",
	)) {
		const slug = el.getAttribute("data-page-views");
		if (slug) void loadPageViews(slug);
	}
	void loadSiteStats();
}
