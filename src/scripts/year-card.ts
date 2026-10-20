/**
 * 年度报告分享卡：复用 image-share.ts 的 canvas 工具，把一年的数据画成一张竖版图。
 *
 * 数据由页面在构建期算好、塞进 #year-card-data 里的 JSON；这里只负责排版和导出。
 */

import {
	accentColor,
	canvasToFile,
	cardFont,
	downloadBlob,
	roundRectPath,
	shareFile,
	showToast,
	wrapCardText,
} from "./image-share";

const CARD_WIDTH = 1080;
const CARD_PADDING = 72;
const CARD_INNER = CARD_WIDTH - CARD_PADDING * 2;
const STAT_TILE_HEIGHT = 132;
const STAT_GAP = 20;
const CHART_HEIGHT = 168;
const CHART_GAP = 10;
const PILL_HEIGHT = 46;
const PILL_GAP = 12;
const HIGHLIGHT_LABEL_WIDTH = 170;
const HIGHLIGHT_LINE_HEIGHT = 40;

export interface YearCardPayload {
	year: number;
	summary: string;
	stats: { label: string; value: string }[];
	months: number[];
	topTags: string[];
	longest: { title: string; meta: string } | null;
	busiestDay: { label: string; count: number } | null;
	firstDay: string | null;
	lastDay: string | null;
	peakHour: number;
	peakSlot: string;
	comparison: string | null;
}

interface Pill {
	name: string;
	width: number;
}

interface HighlightRow {
	label: string;
	lines: string[];
	top: number;
}

interface CardLayout {
	summaryLines: string[];
	summaryTop: number;
	statsTop: number;
	monthsTop: number;
	chartTop: number;
	tagsTop: number;
	pills: Pill[][];
	pillsTop: number;
	highlightsTop: number;
	rows: HighlightRow[];
	comparisonTop: number | null;
	footerY: number;
	height: number;
}

function siteInfo(root: HTMLElement) {
	return {
		title: root.dataset.siteTitle?.trim() || document.title,
		url: root.dataset.siteUrl?.trim() || window.location.host,
	};
}

function readPayload(root: HTMLElement): YearCardPayload | null {
	const source = root.querySelector<HTMLScriptElement>("#year-card-data");
	if (!source?.textContent) return null;
	try {
		return JSON.parse(source.textContent) as YearCardPayload;
	} catch (error) {
		console.warn("年度分享卡数据解析失败", error);
		return null;
	}
}

/** 单行截断，用来兜住过长的标签 */
function ellipsize(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
) {
	if (ctx.measureText(text).width <= maxWidth) return text;
	let result = text;
	while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) {
		result = result.slice(0, -1);
	}
	return `${result}…`;
}

/** 数值够短但字号大，先缩字号再截断，比直接加省略号好看 */
function fitText(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
	size: number,
	weight: number,
	minSize = 24,
) {
	let current = size;
	ctx.font = cardFont(current, weight);
	while (current > minSize && ctx.measureText(text).width > maxWidth) {
		current -= 2;
		ctx.font = cardFont(current, weight);
	}
	return ellipsize(ctx, text, maxWidth);
}

function highlightContent(data: YearCardPayload) {
	const rows: { label: string; content: string }[] = [];
	if (data.longest) {
		rows.push({
			label: "最长的一篇",
			content: `${data.longest.title} · ${data.longest.meta}`,
		});
	}
	// 只发过一篇时「最猛的一天」和首篇是同一天，单独占一行反而别扭
	if (data.busiestDay && data.busiestDay.count > 1) {
		rows.push({
			label: "最猛的一天",
			content: `${data.busiestDay.label} 一口气发了 ${data.busiestDay.count} 篇`,
		});
	}
	rows.push({
		label: "最常动笔",
		content: `${data.peakSlot}，${data.peakHour} 点`,
	});
	if (data.firstDay) {
		rows.push({
			label: "写了多久",
			content: data.lastDay
				? `从 ${data.firstDay} 写到 ${data.lastDay}`
				: `${data.firstDay} 这天落笔`,
		});
	}
	return rows;
}

/** 先把所有会变高的东西量出来，再一把定 canvas 高度，避免画一半重排 */
function layoutCard(
	ctx: CanvasRenderingContext2D,
	data: YearCardPayload,
): CardLayout {
	const top = 88;

	ctx.font = cardFont(34, 500);
	const summaryLines = wrapCardText(ctx, data.summary, CARD_INNER, 3);
	const summaryTop = top + 190;
	const statsTop = summaryTop + summaryLines.length * 50 + 44;

	const monthsTop = statsTop + STAT_TILE_HEIGHT * 2 + STAT_GAP + 56;
	const chartTop = monthsTop + 48;

	ctx.font = cardFont(22, 500);
	const pills: Pill[][] = [];
	let pillRow: Pill[] = [];
	let rowWidth = 0;
	for (const tag of data.topTags) {
		const name = ellipsize(ctx, tag, CARD_INNER - 44);
		const width = Math.min(CARD_INNER, ctx.measureText(name).width + 44);
		if (pillRow.length > 0 && rowWidth + width > CARD_INNER) {
			pills.push(pillRow);
			pillRow = [];
			rowWidth = 0;
		}
		pillRow.push({ name, width });
		rowWidth += width + PILL_GAP;
	}
	if (pillRow.length > 0) pills.push(pillRow);

	const tagsTop = chartTop + CHART_HEIGHT + 30 + 48;
	const pillsTop = tagsTop + 50;
	const pillsBottom = pillsTop + Math.max(1, pills.length) * (PILL_HEIGHT + 12);
	const highlightsTop = pillsBottom + 40;

	ctx.font = cardFont(28, 600);
	const rows: HighlightRow[] = [];
	let cursor = highlightsTop + 50;
	for (const item of highlightContent(data)) {
		const lines = wrapCardText(
			ctx,
			item.content,
			CARD_INNER - HIGHLIGHT_LABEL_WIDTH,
			2,
		);
		rows.push({ label: item.label, lines, top: cursor });
		cursor += Math.max(44, lines.length * HIGHLIGHT_LINE_HEIGHT) + 20;
	}

	let comparisonTop: number | null = null;
	if (data.comparison) {
		comparisonTop = cursor + 12;
		cursor = comparisonTop + 60;
	}

	const footerY = cursor + 48;
	return {
		summaryLines,
		summaryTop,
		statsTop,
		monthsTop,
		chartTop,
		tagsTop,
		pills,
		pillsTop,
		highlightsTop,
		rows,
		comparisonTop,
		footerY,
		height: footerY + 100,
	};
}

function drawBackground(
	ctx: CanvasRenderingContext2D,
	height: number,
	accent: string,
) {
	const background = ctx.createLinearGradient(0, 0, CARD_WIDTH, height);
	background.addColorStop(0, "#17171a");
	background.addColorStop(1, "#08080a");
	ctx.fillStyle = background;
	ctx.fillRect(0, 0, CARD_WIDTH, height);

	const glow = ctx.createRadialGradient(
		CARD_WIDTH * 0.16,
		-80,
		0,
		CARD_WIDTH * 0.16,
		-80,
		CARD_WIDTH * 0.95,
	);
	glow.addColorStop(0, accent);
	glow.addColorStop(1, "rgba(0, 0, 0, 0)");
	ctx.save();
	ctx.globalAlpha = 0.24;
	ctx.fillStyle = glow;
	ctx.fillRect(0, 0, CARD_WIDTH, height);
	ctx.restore();
}

function drawHeader(
	ctx: CanvasRenderingContext2D,
	data: YearCardPayload,
	site: { title: string; url: string },
	accent: string,
) {
	const top = 88;
	const gradient = ctx.createLinearGradient(
		CARD_PADDING,
		top,
		CARD_PADDING + 520,
		top + 170,
	);
	gradient.addColorStop(0, "rgba(255, 255, 255, 0.98)");
	gradient.addColorStop(1, accent);

	ctx.textAlign = "left";
	ctx.textBaseline = "top";
	ctx.font = cardFont(168, 800);
	ctx.fillStyle = gradient;
	ctx.fillText(String(data.year), CARD_PADDING, top - 16);

	ctx.textAlign = "right";
	ctx.font = cardFont(26, 600);
	ctx.fillStyle = "rgba(255, 255, 255, 0.58)";
	ctx.fillText(site.title, CARD_WIDTH - CARD_PADDING, top + 6);
	ctx.font = cardFont(30, 500);
	ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
	ctx.fillText("年度报告", CARD_WIDTH - CARD_PADDING, top + 48);
	ctx.textAlign = "left";
}

function drawSummary(ctx: CanvasRenderingContext2D, layout: CardLayout) {
	ctx.textAlign = "left";
	ctx.textBaseline = "top";
	ctx.font = cardFont(34, 500);
	ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
	layout.summaryLines.forEach((line, index) => {
		ctx.fillText(line, CARD_PADDING, layout.summaryTop + index * 50);
	});
}

function drawStats(
	ctx: CanvasRenderingContext2D,
	layout: CardLayout,
	data: YearCardPayload,
	accent: string,
) {
	const columns = 3;
	const tileWidth = (CARD_INNER - STAT_GAP * (columns - 1)) / columns;

	data.stats.forEach((stat, index) => {
		const column = index % columns;
		const row = Math.floor(index / columns);
		const x = CARD_PADDING + column * (tileWidth + STAT_GAP);
		const y = layout.statsTop + row * (STAT_TILE_HEIGHT + STAT_GAP);

		ctx.fillStyle = "rgba(255, 255, 255, 0.055)";
		roundRectPath(ctx, x, y, tileWidth, STAT_TILE_HEIGHT, 24);
		ctx.fill();

		ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
		ctx.lineWidth = 2;
		ctx.stroke();

		ctx.textAlign = "left";
		ctx.textBaseline = "top";
		const value = fitText(ctx, stat.value, tileWidth - 52, 46, 700);
		ctx.fillStyle = index === 0 ? accent : "rgba(255, 255, 255, 0.95)";
		ctx.fillText(value, x + 26, y + 24);

		ctx.font = cardFont(22, 400);
		ctx.fillStyle = "rgba(255, 255, 255, 0.42)";
		ctx.fillText(stat.label, x + 26, y + 88);
	});
}

function drawMonths(
	ctx: CanvasRenderingContext2D,
	layout: CardLayout,
	data: YearCardPayload,
	accent: string,
) {
	ctx.textAlign = "left";
	ctx.textBaseline = "top";
	ctx.font = cardFont(30, 600);
	ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
	ctx.fillText("月度节奏", CARD_PADDING, layout.monthsTop);

	const bestCount = Math.max(...data.months);
	const bestMonth = bestCount > 0 ? data.months.indexOf(bestCount) + 1 : 0;
	ctx.textAlign = "right";
	ctx.font = cardFont(22, 500);
	ctx.fillStyle = accent;
	ctx.fillText(
		bestMonth > 0
			? `最高产 ${bestMonth} 月 · ${bestCount} 篇`
			: "这一年还没落笔",
		CARD_WIDTH - CARD_PADDING,
		layout.monthsTop + 6,
	);

	const barWidth = (CARD_INNER - CHART_GAP * 11) / 12;
	const max = Math.max(1, ...data.months);
	data.months.forEach((count, index) => {
		const x = CARD_PADDING + index * (barWidth + CHART_GAP);
		const height = count === 0 ? 4 : Math.max(18, (count / max) * CHART_HEIGHT);
		const y = layout.chartTop + CHART_HEIGHT - height;

		ctx.save();
		ctx.globalAlpha = count === 0 ? 0.08 : index + 1 === bestMonth ? 1 : 0.55;
		ctx.fillStyle = count === 0 ? "#ffffff" : accent;
		roundRectPath(ctx, x, y, barWidth, height, 6);
		ctx.fill();
		ctx.restore();

		ctx.textAlign = "center";
		ctx.font = cardFont(20, 400);
		ctx.fillStyle =
			index + 1 === bestMonth
				? "rgba(255, 255, 255, 0.72)"
				: "rgba(255, 255, 255, 0.34)";
		ctx.fillText(
			String(index + 1),
			x + barWidth / 2,
			layout.chartTop + CHART_HEIGHT + 12,
		);
	});
	ctx.textAlign = "left";
}

function drawTags(ctx: CanvasRenderingContext2D, layout: CardLayout) {
	ctx.textAlign = "left";
	ctx.textBaseline = "top";
	ctx.font = cardFont(30, 600);
	ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
	ctx.fillText("这一年常写", CARD_PADDING, layout.tagsTop);

	ctx.font = cardFont(22, 500);
	layout.pills.forEach((row, rowIndex) => {
		let x = CARD_PADDING;
		const y = layout.pillsTop + rowIndex * (PILL_HEIGHT + 12);
		for (const pill of row) {
			ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
			roundRectPath(ctx, x, y, pill.width, PILL_HEIGHT, PILL_HEIGHT / 2);
			ctx.fill();

			ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
			ctx.textBaseline = "middle";
			ctx.fillText(pill.name, x + 22, y + PILL_HEIGHT / 2 + 1);
			ctx.textBaseline = "top";
			x += pill.width + PILL_GAP;
		}
	});
}

function drawHighlights(
	ctx: CanvasRenderingContext2D,
	layout: CardLayout,
	accent: string,
) {
	ctx.textAlign = "left";
	ctx.textBaseline = "top";
	ctx.font = cardFont(30, 600);
	ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
	ctx.fillText("年度之最", CARD_PADDING, layout.highlightsTop);

	for (const row of layout.rows) {
		ctx.fillStyle = accent;
		roundRectPath(ctx, CARD_PADDING, row.top + 6, 4, 24, 2);
		ctx.fill();

		ctx.font = cardFont(22, 500);
		ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
		ctx.fillText(row.label, CARD_PADDING + 22, row.top + 4);

		ctx.font = cardFont(28, 600);
		ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
		const contentX = CARD_PADDING + HIGHLIGHT_LABEL_WIDTH;
		row.lines.forEach((line, index) => {
			ctx.fillText(line, contentX, row.top + index * HIGHLIGHT_LINE_HEIGHT);
		});
	}
}

function drawComparison(
	ctx: CanvasRenderingContext2D,
	layout: CardLayout,
	data: YearCardPayload,
	accent: string,
) {
	if (layout.comparisonTop === null || !data.comparison) return;
	ctx.save();
	ctx.globalAlpha = 0.14;
	ctx.fillStyle = accent;
	roundRectPath(ctx, CARD_PADDING, layout.comparisonTop, CARD_INNER, 60, 18);
	ctx.fill();
	ctx.restore();

	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	ctx.font = cardFont(24, 500);
	ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
	ctx.fillText(data.comparison, CARD_PADDING + 24, layout.comparisonTop + 31);
	ctx.textBaseline = "top";
}

function drawFooter(
	ctx: CanvasRenderingContext2D,
	layout: CardLayout,
	site: { title: string; url: string },
) {
	ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
	ctx.fillRect(CARD_PADDING, layout.footerY, CARD_INNER, 2);

	ctx.textBaseline = "alphabetic";
	ctx.textAlign = "left";
	ctx.font = cardFont(26, 600);
	ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
	ctx.fillText(site.title, CARD_PADDING, layout.footerY + 58);

	ctx.textAlign = "right";
	ctx.font = cardFont(22, 400);
	ctx.fillStyle = "rgba(255, 255, 255, 0.34)";
	ctx.fillText(site.url, CARD_WIDTH - CARD_PADDING, layout.footerY + 58);
	ctx.textAlign = "left";
	ctx.textBaseline = "top";
}

export function drawYearCard(
	canvas: HTMLCanvasElement,
	data: YearCardPayload,
	site: { title: string; url: string },
) {
	const probe = document.createElement("canvas");
	const probeCtx = probe.getContext("2d");
	if (!probeCtx) return 0;
	const layout = layoutCard(probeCtx, data);

	canvas.width = CARD_WIDTH;
	canvas.height = layout.height;
	canvas.style.aspectRatio = `${CARD_WIDTH} / ${layout.height}`;

	const ctx = canvas.getContext("2d");
	if (!ctx) return 0;

	const accent = accentColor();
	drawBackground(ctx, layout.height, accent);
	drawHeader(ctx, data, site, accent);
	drawSummary(ctx, layout);
	drawStats(ctx, layout, data, accent);
	drawMonths(ctx, layout, data, accent);
	drawTags(ctx, layout);
	drawHighlights(ctx, layout, accent);
	drawComparison(ctx, layout, data, accent);
	drawFooter(ctx, layout, site);
	return layout.height;
}

function cardFileName(year: number) {
	return `year-report-${year}.png`;
}

export function mountYearCardPage() {
	const root = document.getElementById("year-card");
	if (!root) return;
	// Swup 首次进入和 page:view 都会调一次，别重复绑监听
	if (root.dataset.cardMounted === "true") return;
	const data = readPayload(root);
	if (!data) return;
	root.dataset.cardMounted = "true";

	const openBtn = document.getElementById("year-card-open");
	const panel = document.getElementById(
		"year-card-panel",
	) as HTMLDialogElement | null;
	const canvas = document.getElementById(
		"year-card-canvas",
	) as HTMLCanvasElement | null;
	const closeBtn = document.getElementById("year-card-close");
	const shareBtn = document.getElementById("year-card-share");
	const downloadBtn = document.getElementById("year-card-download");
	if (!openBtn || !panel || !canvas) return;

	const site = siteInfo(root);
	let rendered = false;
	const ensureCard = () => {
		if (rendered) return true;
		const height = drawYearCard(canvas, data, site);
		rendered = height > 0;
		return rendered;
	};

	const open = () => {
		ensureCard();
		if (!panel.open) panel.showModal();
		panel.classList.remove("hidden");
		panel.classList.add("flex");
	};

	const close = () => {
		panel.classList.add("hidden");
		panel.classList.remove("flex");
		if (panel.open) panel.close();
	};

	const buildFile = async () => {
		if (!ensureCard()) {
			showToast("卡片还没准备好，请稍后再试");
			return null;
		}
		const file = await canvasToFile(canvas, cardFileName(data.year));
		if (!file) showToast("卡片生成失败，请刷新后重试");
		return file;
	};

	const share = async () => {
		const file = await buildFile();
		if (!file) return;
		const text = `${data.year} 年度报告 · ${site.title}`;
		if (await shareFile(file, text)) return;
		downloadBlob(file, file.name);
		showToast("当前环境不支持直接分享，卡片已下载");
	};

	const download = async () => {
		const file = await buildFile();
		if (!file) return;
		downloadBlob(file, file.name);
		showToast("卡片已下载");
	};

	openBtn.addEventListener("click", open);
	closeBtn?.addEventListener("click", close);
	shareBtn?.addEventListener("click", () => void share());
	downloadBtn?.addEventListener("click", () => void download());
	panel.addEventListener("click", (event) => {
		if (event.target === panel) close();
	});
	// Esc 由 <dialog> 自己关，类名得跟着同步，否则 flex 会把隐藏态撑开
	panel.addEventListener("close", () => {
		panel.classList.add("hidden");
		panel.classList.remove("flex");
	});
}
