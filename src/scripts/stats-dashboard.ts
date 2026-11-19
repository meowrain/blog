/**
 * 访问统计仪表盘（/stats/）的渲染与交互。
 *
 * 数据来自同源云函数 GET /api/stats/summary?days=N（见
 * cloud-functions/api/stats/[[default]].js）。图表用纯 SVG 手绘：
 *  - 访问趋势：两条折线（访问量=蓝、访客数=橙），带十字准星 + tooltip；
 *  - 时段分布：24 根单系列柱（悬停出 tooltip）。
 * 排行类数据一律走表格 + 中性色占比条，颜色只用来标识系列，不用来表达大小。
 *
 * 由 Layout 的页面挂载表在出现 #stats-page 时调用 initStatsDashboard()，
 * 并在 Swup 换页（page:view）后重新挂载。
 */

import {
	type BarDatum,
	type BucketRow,
	type DailyPoint,
	audienceSplit,
	buildBarModel,
	buildChartModel,
	compactNumber,
	hourLabel,
	sharePercent,
	shortDate,
	toPolyline,
	weekdayLabel,
} from "../utils/stats-core";

interface TopPage {
	path: string;
	title: string;
	views: number;
	visitors: number;
	lastAt?: number;
}

interface WeekdayRow {
	weekday: number;
	views: number;
	visitors: number;
	days: number;
	avgViews: number;
}

interface Dimensions {
	referrers: BucketRow[];
	devices: BucketRow[];
	browsers: BucketRow[];
	oses: BucketRow[];
	countries: BucketRow[];
	regions: BucketRow[];
}

interface SeriesSummary {
	days: number;
	views: number;
	visitors: number;
	avgViews: number;
	avgVisitors: number;
	peak: { date: string; views: number } | null;
	viewsPerVisitor: number;
	busiestHour: number;
	busiestHourViews: number;
}

interface SummaryResponse {
	site: { views: number; visitors: number };
	today: {
		date: string;
		views: number;
		visitors: number;
		newVisitors?: number;
	};
	series: DailyPoint[];
	topPages: TopPage[];
	recentPages?: TopPage[];
	range: {
		days: number;
		views: number;
		visitors: number;
		newVisitors: number;
		daysWithData: number;
	};
	summary: SeriesSummary;
	dimensions: Dimensions;
	dimensionDays: number;
	hours: number[];
	weekdays: WeekdayRow[];
	audience: { new: number; returning: number; viewsPerVisitor: number };
	pages: { total: number; withTraffic: number };
	generatedAt: string;
}

const SUMMARY_URL = "/api/stats/summary";
const HOUR_TOOLTIP_ID = "stats-hours-tooltip";

let activeRoot: HTMLElement | null = null;
let disposers: Array<() => void> = [];
let currentDays = 30;
let currentSeries: DailyPoint[] = [];
let currentHours: number[] = [];

function el<T extends HTMLElement>(id: string): T | null {
	return document.getElementById(id) as T | null;
}

function setText(id: string, value: string): void {
	const node = document.getElementById(id);
	if (node) node.textContent = value;
}

/** 替换图表内容，并把 tooltip 层留在容器里（它是 host 的子节点，会被一并清掉）。 */
function setChartContent(
	host: HTMLElement,
	tip: HTMLElement,
	node: Node,
): void {
	host.replaceChildren(node);
	if (tip.parentElement !== host) host.appendChild(tip);
}

/**
 * 把 tooltip 锚到图表坐标点：横向夹在容器内，纵向空间不足时翻到下方。
 * 调用前必须先取消 hidden —— 隐藏状态下 offsetWidth 是 0，量不出尺寸。
 */
function placeTooltip(
	host: HTMLElement,
	tip: HTMLElement,
	pointX: number,
	pointY: number,
): void {
	const width = host.clientWidth;
	const half = tip.offsetWidth / 2 + 4;
	const left = Math.min(Math.max(pointX, half), Math.max(half, width - half));
	const above = pointY - 8 - tip.offsetHeight >= 0;
	tip.classList.toggle("is-below", !above);
	tip.style.left = `${left}px`;
	tip.style.top = `${above ? pointY - 8 : pointY + 8}px`;
}

function formatTime(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "–";
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 时间戳 → `MM-DD HH:mm`；0/非法值显示「–」。 */
function formatTimestamp(ts?: number): string {
	if (!ts || !Number.isFinite(ts)) return "–";
	return formatTime(new Date(ts).toISOString());
}

function pageHref(path: string): string {
	return path.endsWith("/") ? path : `${path}/`;
}

function createEmptyRow(
	colSpan: number,
	text = "暂无数据",
): HTMLTableRowElement {
	const tr = document.createElement("tr");
	const td = document.createElement("td");
	td.colSpan = colSpan;
	td.className = "stats-table-empty";
	td.textContent = text;
	tr.appendChild(td);
	return tr;
}

/** 表格里的迷你占比条：中性色填充，长度表达占比，数值另有列。 */
function shareTrack(percent: number): HTMLElement {
	const track = document.createElement("div");
	track.className = "stats-bar-track";
	const fill = document.createElement("div");
	fill.className = "stats-bar-fill";
	fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
	track.appendChild(fill);
	return track;
}

function renderPanelTable(
	tbodyId: string,
	rows: BucketRow[],
	emptyText = "暂无数据（该维度从上线后开始采集）",
): void {
	const tbody = el<HTMLTableSectionElement>(tbodyId);
	if (!tbody) return;
	tbody.replaceChildren();
	if (rows.length === 0) {
		tbody.appendChild(createEmptyRow(4, emptyText));
		return;
	}
	const total = rows.reduce((n, r) => n + r.value, 0);
	for (const row of rows) {
		const tr = document.createElement("tr");
		const name = document.createElement("td");
		name.className = "stats-name";
		name.textContent = row.name;
		name.title = row.name;
		const value = document.createElement("td");
		value.className = "stats-num";
		value.textContent = compactNumber(row.value);
		const pct = document.createElement("td");
		pct.className = "stats-num";
		pct.textContent = `${sharePercent(row.value, total)}%`;
		const share = document.createElement("td");
		share.className = "stats-share";
		share.appendChild(shareTrack(sharePercent(row.value, total)));
		tr.append(name, value, pct, share);
		tbody.appendChild(tr);
	}
}

function renderTopPages(pages: TopPage[]): void {
	const tbody = el<HTMLTableSectionElement>("stats-top-pages");
	if (!tbody) return;
	tbody.replaceChildren();
	if (pages.length === 0) {
		tbody.appendChild(createEmptyRow(4));
		return;
	}
	pages.slice(0, 12).forEach((p, i) => {
		const tr = document.createElement("tr");
		const index = document.createElement("td");
		index.textContent = String(i + 1);
		const titleCell = document.createElement("td");
		titleCell.className = "stats-title";
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

function renderRecentPages(pages: TopPage[]): void {
	const tbody = el<HTMLTableSectionElement>("stats-recent-pages");
	if (!tbody) return;
	tbody.replaceChildren();
	// 服务端已按 lastAt 排好序；这里只兜底过滤 + 截断，避免重复排序逻辑。
	const recent = pages.filter((p) => p.lastAt && p.lastAt > 0).slice(0, 12);
	if (recent.length === 0) {
		tbody.appendChild(createEmptyRow(3));
		return;
	}
	for (const p of recent) {
		const tr = document.createElement("tr");
		const titleCell = document.createElement("td");
		titleCell.className = "stats-title";
		const link = document.createElement("a");
		link.href = pageHref(p.path);
		link.textContent = p.title || p.path;
		link.title = p.path;
		titleCell.appendChild(link);
		const views = document.createElement("td");
		views.className = "stats-num";
		views.textContent = compactNumber(p.views);
		const last = document.createElement("td");
		last.className = "stats-num";
		last.textContent = formatTimestamp(p.lastAt);
		tr.append(titleCell, views, last);
		tbody.appendChild(tr);
	}
}

function renderWeekdays(rows: WeekdayRow[]): void {
	const tbody = el<HTMLTableSectionElement>("stats-weekdays");
	if (!tbody) return;
	tbody.replaceChildren();
	if (rows.length === 0) {
		tbody.appendChild(createEmptyRow(5));
		return;
	}
	const total = rows.reduce((n, r) => n + r.views, 0);
	for (const row of rows) {
		const tr = document.createElement("tr");
		const name = document.createElement("td");
		name.textContent = weekdayLabel(row.weekday);
		const views = document.createElement("td");
		views.className = "stats-num";
		views.textContent = compactNumber(row.views);
		const visitors = document.createElement("td");
		visitors.className = "stats-num";
		visitors.textContent = compactNumber(row.visitors);
		const avg = document.createElement("td");
		avg.className = "stats-num";
		avg.textContent = String(row.avgViews);
		const share = document.createElement("td");
		share.className = "stats-share";
		share.appendChild(shareTrack(sharePercent(row.views, total)));
		tr.append(name, views, visitors, avg, share);
		tbody.appendChild(tr);
	}
}

function renderAudience(audience: SummaryResponse["audience"]): void {
	const { newPercent, returningPercent } = audienceSplit(
		audience.new,
		audience.returning,
	);
	setText("audience-new", compactNumber(audience.new));
	setText("audience-new-pct", `${newPercent}%`);
	setText("audience-returning", compactNumber(audience.returning));
	setText("audience-returning-pct", `${returningPercent}%`);
	setText("audience-total", compactNumber(audience.new + audience.returning));
	setText("audience-depth", String(audience.viewsPerVisitor || 0));

	const newSeg = el<HTMLElement>("stats-audience-new");
	const retSeg = el<HTMLElement>("stats-audience-returning");
	if (newSeg) newSeg.style.width = `${newPercent}%`;
	if (retSeg) retSeg.style.width = `${returningPercent}%`;
}

function renderTiles(data: SummaryResponse): void {
	setText("stats-hero", compactNumber(data.today.views));
	setText("stats-hero-visitors", compactNumber(data.today.visitors));
	setText("tile-range-views", compactNumber(data.range.views));
	setText("tile-range-visitors", compactNumber(data.range.visitors));
	setText("tile-avg-views", String(data.summary.avgViews));
	setText("tile-avg-visitors", String(data.summary.avgVisitors));
	setText("tile-depth", String(data.audience.viewsPerVisitor || 0));
	setText(
		"tile-busiest-hour",
		data.summary.busiestHour >= 0 ? hourLabel(data.summary.busiestHour) : "–",
	);
	setText("tile-site-views", compactNumber(data.site.views));
	setText("tile-site-visitors", compactNumber(data.site.visitors));
	setText("tile-pages", compactNumber(data.pages.withTraffic));
	setText(
		"tile-peak",
		data.summary.peak
			? `${compactNumber(data.summary.peak.views)} · ${shortDate(data.summary.peak.date)}`
			: "–",
	);
	setText(
		"tile-days-with-data",
		`${data.range.daysWithData}/${data.range.days}`,
	);
	setText("tile-updated", formatTime(data.generatedAt));

	const note = el<HTMLElement>("stats-dimension-note");
	if (note) {
		note.textContent =
			data.dimensionDays > 0
				? `维度数据覆盖 ${data.dimensionDays}/${data.range.days} 天，更早的访问不含此项`
				: "该维度从上线后开始采集，当前区间还没有数据";
	}
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
		setChartContent(host, tip, empty);
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

	setChartContent(host, tip, svg);

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

		// 先显示再量尺寸：隐藏状态下 offsetWidth/Height 都是 0，夹紧算不出来
		tip.hidden = false;
		tip.replaceChildren(...rows);

		const rect = host.getBoundingClientRect();
		const scale = model.width > 0 ? rect.width / model.width : 1;
		placeTooltip(
			host,
			tip,
			p.x * scale,
			Math.min(p.yViews, p.yVisitors) * scale,
		);
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

/**
 * 画时段分布柱状图（单系列）：柱子顶部 4px 圆角、底部贴基线，
 * 悬停时该柱减淡高亮并出 tooltip（含占比）。
 */
function renderHourChart(
	hours: number[],
	host: HTMLElement,
	tip: HTMLElement,
): void {
	const css = getComputedStyle(host);
	const colorBar = css.getPropertyValue("--viz-views").trim() || "#2a78d6";
	const colorGrid =
		css.getPropertyValue("--viz-grid").trim() || "rgba(0,0,0,0.08)";
	const colorAxis =
		css.getPropertyValue("--viz-axis-text").trim() || "rgba(0,0,0,0.45)";

	const width = Math.max(300, Math.floor(host.clientWidth || 640));
	const height = 190;
	const values = Array.from({ length: 24 }, (_, i) =>
		Number.isFinite(hours?.[i]) ? hours[i] : 0,
	);
	const peak = values.reduce((m, v) => Math.max(m, v), 0);
	if (peak === 0) {
		const empty = document.createElement("p");
		empty.className = "stats-empty";
		empty.textContent = "暂无数据（时段分布从上线后开始采集）";
		setChartContent(host, tip, empty);
		return;
	}

	const model = buildBarModel(values, {
		width,
		height,
		labelFor: hourLabel,
		// 24 根柱子在窄屏只每几小时标一次
		maxXLabels: width < 520 ? 5 : 9,
		gap: 2,
	});

	const ns = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(ns, "svg");
	svg.setAttribute("viewBox", `0 0 ${model.width} ${model.height}`);
	svg.setAttribute("role", "img");
	svg.setAttribute("aria-label", "按小时的访问量分布柱状图");

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
		label.setAttribute("x", String(model.plotLeft - 6));
		label.setAttribute("y", String(tick.y + 3));
		label.setAttribute("text-anchor", "end");
		label.setAttribute("font-size", "10");
		label.setAttribute("fill", colorAxis);
		label.textContent = tick.label;
		svg.appendChild(label);
	}

	for (const xl of model.xLabels) {
		const label = document.createElementNS(ns, "text");
		label.setAttribute("x", String(xl.x));
		label.setAttribute("y", String(model.plotBottom + 15));
		label.setAttribute("text-anchor", "middle");
		label.setAttribute("font-size", "10");
		label.setAttribute("fill", colorAxis);
		label.textContent = xl.label;
		svg.appendChild(label);
	}

	const bars = model.bars.map((bar: BarDatum) => {
		const rect = document.createElementNS(ns, "rect");
		rect.setAttribute("x", String(bar.x));
		rect.setAttribute("y", String(bar.y));
		rect.setAttribute("width", String(bar.width));
		rect.setAttribute("height", String(Math.max(0, bar.height)));
		// 柱子顶部 4px 圆角，底部贴基线保持方角
		rect.setAttribute("rx", String(Math.min(4, bar.width / 2)));
		rect.setAttribute("fill", colorBar);
		svg.appendChild(rect);
		return rect;
	});

	// 悬停热区：每个小时占一整列，比柱子本身大，方便命中
	const slot =
		model.bars.length > 0
			? (model.plotRight - model.plotLeft) / model.bars.length
			: 0;
	const hitAreas = model.bars.map((bar) => {
		const rect = document.createElementNS(ns, "rect");
		rect.setAttribute("x", String(bar.x - 1));
		rect.setAttribute("y", String(model.plotTop));
		rect.setAttribute("width", String(slot));
		rect.setAttribute("height", String(model.plotBottom - model.plotTop));
		rect.setAttribute("fill", "transparent");
		rect.setAttribute("style", "cursor: pointer");
		svg.appendChild(rect);
		return rect;
	});

	setChartContent(host, tip, svg);

	const total = values.reduce((n, v) => n + v, 0);
	const HOVER_OPACITY = "0.7";
	const hide = () => {
		for (const b of bars) b.setAttribute("opacity", "1");
		tip.hidden = true;
	};
	const showAt = (index: number) => {
		const bar = model.bars[index];
		if (!bar) return;
		bars.forEach((b, i) =>
			b.setAttribute("opacity", i === index ? HOVER_OPACITY : "1"),
		);

		const head = document.createElement("div");
		head.style.cssText = "font-weight:600;margin-bottom:2px;";
		head.textContent = `${hourLabel(index)} – ${hourLabel(index + 1)}`;
		const body = document.createElement("div");
		body.textContent = `访问量 ${compactNumber(bar.value)}（${sharePercent(bar.value, total)}%）`;
		// 先显示再量尺寸，placeTooltip 才能拿到真实宽高做边界夹紧
		tip.hidden = false;
		tip.replaceChildren(head, body);

		const rect = host.getBoundingClientRect();
		const scale = model.width > 0 ? rect.width / model.width : 1;
		placeTooltip(host, tip, (bar.x + bar.width / 2) * scale, bar.y * scale);
	};

	hitAreas.forEach((rect, index) => {
		rect.addEventListener("pointerenter", () => showAt(index));
		rect.addEventListener("pointerdown", () => showAt(index));
		rect.addEventListener("pointerleave", hide);
	});
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

		renderTiles(data);

		const chart = el<HTMLElement>("stats-chart");
		const tip = el<HTMLElement>("stats-tooltip");
		currentSeries = data.series;
		currentHours = data.hours || [];
		if (chart && tip) renderChart(data.series, chart, tip);

		const hoursHost = el<HTMLElement>("stats-hours");
		const hoursTip = el<HTMLElement>(HOUR_TOOLTIP_ID);
		if (hoursHost && hoursTip)
			renderHourChart(currentHours, hoursHost, hoursTip);

		renderWeekdays(data.weekdays || []);
		renderAudience(data.audience);
		renderPanelTable("stats-dim-referrers", data.dimensions?.referrers || []);
		renderPanelTable("stats-dim-devices", data.dimensions?.devices || []);
		renderPanelTable("stats-dim-browsers", data.dimensions?.browsers || []);
		renderPanelTable("stats-dim-oses", data.dimensions?.oses || []);
		renderPanelTable("stats-dim-countries", data.dimensions?.countries || []);
		renderPanelTable("stats-dim-regions", data.dimensions?.regions || []);
		renderTopPages(data.topPages);
		renderRecentPages(data.recentPages || data.topPages);
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
	const repaint = () => {
		const chart = el<HTMLElement>("stats-chart");
		const tip = el<HTMLElement>("stats-tooltip");
		if (chart && tip && currentSeries.length > 0) {
			renderChart(currentSeries, chart, tip);
		}
		const hoursHost = el<HTMLElement>("stats-hours");
		const hoursTip = el<HTMLElement>(HOUR_TOOLTIP_ID);
		if (hoursHost && hoursTip) {
			renderHourChart(currentHours, hoursHost, hoursTip);
		}
	};

	window.addEventListener("resize", repaint);
	disposers.push(() => window.removeEventListener("resize", repaint));

	// 明暗切换时重画：SVG 的 stroke / fill 是绘制那一刻从 CSS 变量读出来写死在
	// 节点属性上的，只改 :root.dark 下的变量不会回头更新已有节点，坐标轴文字会
	// 一直停在浅色灰上。明暗开关挂在 <html> 的 class 上（data-theme 存的是
	// expressive-code 的主题名，与明暗无关），所以盯 class 属性即可。
	const themeObserver = new MutationObserver(() => {
		const tip = el<HTMLElement>("stats-tooltip");
		if (tip) tip.hidden = true;
		const hoursTip = el<HTMLElement>(HOUR_TOOLTIP_ID);
		if (hoursTip) hoursTip.hidden = true;
		repaint();
	});
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["class"],
	});
	disposers.push(() => themeObserver.disconnect());

	void load(currentDays);
}

function dispose(): void {
	for (const fn of disposers) fn();
	disposers = [];
	currentSeries = [];
	currentHours = [];
}
