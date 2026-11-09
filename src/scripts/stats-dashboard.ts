/**
 * 访问统计仪表盘（/stats/）的渲染与交互。
 *
 * 数据来自同源云函数 GET /api/stats/summary?days=N（见
 * cloud-functions/api/stats/[[default]].js）。图表用纯 SVG 手绘：两条折线
 * （访问量=蓝、访客数=橙），带十字准星 + tooltip，符合 dataviz 的交互要求。
 *
 * 由 Layout 的页面挂载表在出现 #stats-page 时调用 initStatsDashboard()，
 * 并在 Swup 换页（page:view）后重新挂载。
 */

import {
	type DailyPoint,
	buildChartModel,
	compactNumber,
	toPolyline,
} from "../utils/stats-core";

interface TopPage {
	path: string;
	title: string;
	views: number;
	visitors: number;
}

interface SummaryResponse {
	site: { views: number; visitors: number };
	today: { date: string; views: number; visitors: number };
	series: DailyPoint[];
	topPages: TopPage[];
	range: { days: number; views: number; visitors: number };
	generatedAt: string;
}

const SUMMARY_URL = "/api/stats/summary";

let activeRoot: HTMLElement | null = null;
let disposers: Array<() => void> = [];
let currentDays = 30;
let currentSeries: DailyPoint[] = [];

function el<T extends HTMLElement>(id: string): T | null {
	return document.getElementById(id) as T | null;
}

function setText(id: string, value: string): void {
	const node = document.getElementById(id);
	if (node) node.textContent = value;
}

function formatTime(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "–";
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pageHref(path: string): string {
	return path.endsWith("/") ? path : `${path}/`;
}

function renderTopPages(pages: TopPage[]): void {
	const tbody = el<HTMLTableSectionElement>("stats-top-pages");
	if (!tbody) return;
	tbody.replaceChildren();
	if (pages.length === 0) {
		const tr = document.createElement("tr");
		const td = document.createElement("td");
		td.colSpan = 4;
		td.className = "stats-table-empty";
		td.textContent = "暂无数据";
		tr.appendChild(td);
		tbody.appendChild(tr);
		return;
	}
	pages.forEach((p, i) => {
		const tr = document.createElement("tr");
		const index = document.createElement("td");
		index.textContent = String(i + 1);
		const titleCell = document.createElement("td");
		const link = document.createElement("a");
		link.href = pageHref(p.path);
		link.textContent = p.title || p.path;
		link.title = p.path;
		titleCell.appendChild(link);
		const views = document.createElement("td");
		views.className = "stats-num";
		views.textContent = compactNumber(p.views);
		const visitors = document.createElement("td");
		visitors.className = "stats-num";
		visitors.textContent = compactNumber(p.visitors);
		tr.append(index, titleCell, views, visitors);
		tbody.appendChild(tr);
	});
}

/**
 * 画折线图：SVG 手绘两条线 + 网格 + 轴 + 悬停层。
 * 用容器实际像素宽度，保证窄屏也不溢出。
 */
function renderChart(
	series: DailyPoint[],
	host: HTMLElement,
	tip: HTMLElement,
): void {
	const css = getComputedStyle(host);
	const colorViews = css.getPropertyValue("--viz-views").trim() || "#2a78d6";
	const colorVisitors =
		css.getPropertyValue("--viz-visitors").trim() || "#eb6834";
	const colorGrid =
		css.getPropertyValue("--viz-grid").trim() || "rgba(0,0,0,0.08)";
	const colorAxis =
		css.getPropertyValue("--viz-axis-text").trim() || "rgba(0,0,0,0.45)";
	const colorSurface =
		css.getPropertyValue("--viz-surface").trim() || "#ffffff";

	const width = Math.max(320, Math.floor(host.clientWidth || 720));
	const height = 260;

	if (series.length === 0) {
		const empty = document.createElement("p");
		empty.className = "stats-empty";
		empty.textContent = "暂无数据";
		host.replaceChildren(empty);
		return;
	}

	const model = buildChartModel(series, {
		width,
		height,
		maxXLabels: width < 520 ? 4 : 6,
	});

	const ns = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(ns, "svg");
	svg.setAttribute("viewBox", `0 0 ${model.width} ${model.height}`);
	svg.setAttribute("role", "img");
	svg.setAttribute("aria-label", "访问量与访客数按日趋势折线图");

	// 网格线 + y 轴刻度
	for (const tick of model.yTicks) {
		const line = document.createElementNS(ns, "line");
		line.setAttribute("x1", String(model.plotLeft));
		line.setAttribute("x2", String(model.plotRight));
		line.setAttribute("y1", String(tick.y));
		line.setAttribute("y2", String(tick.y));
		line.setAttribute("stroke", colorGrid);
		line.setAttribute("stroke-width", "1");
		svg.appendChild(line);

		const label = document.createElementNS(ns, "text");
		label.setAttribute("x", String(model.plotLeft - 8));
		label.setAttribute("y", String(tick.y + 3));
		label.setAttribute("text-anchor", "end");
		label.setAttribute("font-size", "10");
		label.setAttribute("fill", colorAxis);
		label.textContent = tick.label;
		svg.appendChild(label);
	}

	// x 轴日期标签
	for (const xl of model.xLabels) {
		const label = document.createElementNS(ns, "text");
		label.setAttribute("x", String(xl.x));
		label.setAttribute("y", String(model.plotBottom + 16));
		label.setAttribute("text-anchor", "middle");
		label.setAttribute("font-size", "10");
		label.setAttribute("fill", colorAxis);
		label.textContent = xl.label;
		svg.appendChild(label);
	}

	// 两条折线（2px、圆角接头），先画访客再画访问，保证蓝在上层
	const drawLine = (key: "yViews" | "yVisitors", color: string) => {
		const path = document.createElementNS(ns, "path");
		path.setAttribute("d", toPolyline(model.points, key));
		path.setAttribute("fill", "none");
		path.setAttribute("stroke", color);
		path.setAttribute("stroke-width", "2");
		path.setAttribute("stroke-linejoin", "round");
		path.setAttribute("stroke-linecap", "round");
		svg.appendChild(path);
	};
	drawLine("yVisitors", colorVisitors);
	drawLine("yViews", colorViews);

	// 末端圆点（r=4 即 8px 直径，带 2px 背景色描边）
	const last = model.points[model.points.length - 1];
	if (last) {
		const dot = (y: number, color: string) => {
			const c = document.createElementNS(ns, "circle");
			c.setAttribute("cx", String(last.x));
			c.setAttribute("cy", String(y));
			c.setAttribute("r", "4");
			c.setAttribute("fill", color);
			c.setAttribute("stroke", colorSurface);
			c.setAttribute("stroke-width", "2");
			svg.appendChild(c);
		};
		dot(last.yVisitors, colorVisitors);
		dot(last.yViews, colorViews);
	}

	// 悬停层：十字准星 + tooltip
	const overlay = document.createElementNS(ns, "rect");
	overlay.setAttribute("x", String(model.plotLeft));
	overlay.setAttribute("y", String(model.plotTop));
	overlay.setAttribute("width", String(model.plotRight - model.plotLeft));
	overlay.setAttribute("height", String(model.plotBottom - model.plotTop));
	overlay.setAttribute("fill", "transparent");
	overlay.setAttribute("style", "cursor: crosshair");
	svg.appendChild(overlay);

	const crossX = document.createElementNS(ns, "line");
	crossX.setAttribute("y1", String(model.plotTop));
	crossX.setAttribute("y2", String(model.plotBottom));
	crossX.setAttribute("stroke", colorAxis);
	crossX.setAttribute("stroke-width", "1");
	crossX.setAttribute("stroke-dasharray", "3 3");
	crossX.setAttribute("visibility", "hidden");
	svg.appendChild(crossX);

	host.replaceChildren(svg);

	const showAt = (index: number) => {
		const p = model.points[index];
		if (!p) return;
		crossX.setAttribute("x1", String(p.x));
		crossX.setAttribute("x2", String(p.x));
		crossX.setAttribute("visibility", "visible");

		const head = document.createElement("div");
		head.style.cssText = "font-weight:600;margin-bottom:2px;";
		head.textContent = p.date;
		const rows: Node[] = [head];
		const row = (color: string, label: string, value: number) => {
			const wrap = document.createElement("div");
			wrap.className = "stats-tooltip-row";
			const dot = document.createElement("span");
			dot.className = "stats-tooltip-dot";
			dot.style.background = color;
			const txt = document.createElement("span");
			txt.textContent = `${label} ${compactNumber(value)}`;
			wrap.append(dot, txt);
			rows.push(wrap);
		};
		row(colorViews, "访问量", p.views);
		row(colorVisitors, "访客数", p.visitors);
		tip.replaceChildren(...rows);

		const rect = host.getBoundingClientRect();
		const scale = model.width > 0 ? rect.width / model.width : 1;
		tip.hidden = false;
		tip.style.left = `${p.x * scale}px`;
		tip.style.top = `${Math.min(p.yViews, p.yVisitors) * scale - 8}px`;
	};

	const hide = () => {
		crossX.setAttribute("visibility", "hidden");
		tip.hidden = true;
	};

	const onMove = (ev: Event) => {
		const e = ev as PointerEvent;
		const rect = svg.getBoundingClientRect();
		const scale = model.width > 0 ? model.width / rect.width : 1;
		const xInSvg = (e.clientX - rect.left) * scale;
		let best = 0;
		let bestDist = Number.POSITIVE_INFINITY;
		for (const p of model.points) {
			const d = Math.abs(p.x - xInSvg);
			if (d < bestDist) {
				bestDist = d;
				best = p.index;
			}
		}
		showAt(best);
	};

	overlay.addEventListener("pointermove", onMove);
	overlay.addEventListener("pointerleave", hide);
	overlay.addEventListener("pointerdown", onMove);
}

async function load(days: number): Promise<void> {
	const root = activeRoot;
	if (!root) return;
	const errorEl = el<HTMLElement>("stats-error");
	errorEl?.classList.add("hidden");

	try {
		const res = await fetch(`${SUMMARY_URL}?days=${days}`, {
			headers: { accept: "application/json" },
		});
		if (res.status === 401) {
			setText("stats-hero", "—");
			if (errorEl) {
				errorEl.textContent =
					"统计接口需要鉴权：请在 URL 上追加 ?token=<STATS_TOKEN>，或联系站长。";
				errorEl.classList.remove("hidden");
			}
			return;
		}
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = (await res.json()) as SummaryResponse;

		setText("stats-hero", compactNumber(data.today.views));
		setText("stats-hero-visitors", compactNumber(data.today.visitors));
		setText("tile-range-views", compactNumber(data.range.views));
		setText("tile-range-visitors", compactNumber(data.range.visitors));
		setText("tile-site-views", compactNumber(data.site.views));
		setText("tile-site-visitors", compactNumber(data.site.visitors));
		setText("tile-pages", compactNumber(data.topPages.length));
		setText("tile-updated", formatTime(data.generatedAt));

		const chart = el<HTMLElement>("stats-chart");
		const tip = el<HTMLElement>("stats-tooltip");
		currentSeries = data.series;
		if (chart && tip) renderChart(data.series, chart, tip);

		renderTopPages(data.topPages);
	} catch (error) {
		console.error("[stats] 加载仪表盘失败:", error);
		if (errorEl) {
			errorEl.textContent = "统计数据加载失败，请稍后重试。";
			errorEl.classList.remove("hidden");
		}
	}
}

function bindRangeButtons(): void {
	const buttons = Array.from(
		document.querySelectorAll<HTMLButtonElement>(".stats-range-btn"),
	);
	const handler = (ev: Event) => {
		const btn = ev.currentTarget as HTMLButtonElement;
		const days = Number(btn.dataset.range) || 30;
		if (days === currentDays) return;
		currentDays = days;
		for (const b of buttons) b.classList.toggle("is-active", b === btn);
		void load(days);
	};
	for (const b of buttons) b.addEventListener("click", handler);
	disposers.push(() => {
		for (const b of buttons) b.removeEventListener("click", handler);
	});
}

/** 挂载 /stats/ 仪表盘。重复调用会先清理上一轮的监听。 */
export function initStatsDashboard(): void {
	const root = document.getElementById("stats-page");
	if (!root) return;
	if (root.dataset.statsEnabled !== "true") return;
	if (activeRoot === root && disposers.length > 0) return;

	dispose();
	activeRoot = root;
	currentDays = 30;

	bindRangeButtons();

	// 切回窄屏/宽屏时重画一次，避免 x 轴标签挤在一起
	const onResize = () => {
		const chart = el<HTMLElement>("stats-chart");
		const tip = el<HTMLElement>("stats-tooltip");
		if (chart && tip && currentSeries.length > 0) {
			renderChart(currentSeries, chart, tip);
		}
	};
	window.addEventListener("resize", onResize);
	disposers.push(() => window.removeEventListener("resize", onResize));

	void load(currentDays);
}

function dispose(): void {
	for (const fn of disposers) fn();
	disposers = [];
	currentSeries = [];
}
