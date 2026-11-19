/**
 * 访问统计仪表盘的纯计算逻辑（无 DOM，可单测）。
 *
 * 只负责“把每日序列换算成画图坐标”：y 轴上限取整、刻度、x 轴标签位置、
 * 每个点的折线坐标。SVG 拼接和交互在 src/scripts/stats-dashboard.ts 里做。
 */

export interface DailyPoint {
	date: string;
	views: number;
	visitors: number;
}

export interface ChartOptions {
	width?: number;
	height?: number;
	padTop?: number;
	padRight?: number;
	padBottom?: number;
	padLeft?: number;
	/** y 轴刻度数量（含 0），默认 4 段 */
	tickCount?: number;
	/** x 轴最多显示几个日期标签 */
	maxXLabels?: number;
}

export interface YTick {
	value: number;
	/** 像素 y（自上而下） */
	y: number;
	label: string;
}

export interface XLabel {
	index: number;
	/** 像素 x */
	x: number;
	label: string;
}

export interface ScaledPoint {
	index: number;
	date: string;
	x: number;
	yViews: number;
	yVisitors: number;
	views: number;
	visitors: number;
}

export interface ChartModel {
	width: number;
	height: number;
	yMax: number;
	plotLeft: number;
	plotRight: number;
	plotTop: number;
	plotBottom: number;
	yTicks: YTick[];
	xLabels: XLabel[];
	points: ScaledPoint[];
}

/** 把最大值向上取到一个好看的整数（1/2/5 × 10^n），保证刻度整洁。 */
export function niceMax(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return 1;
	const exponent = Math.floor(Math.log10(value));
	const base = 10 ** exponent;
	const fraction = value / base;
	let niceFraction: number;
	if (fraction <= 1) niceFraction = 1;
	else if (fraction <= 2) niceFraction = 2;
	else if (fraction <= 5) niceFraction = 5;
	else niceFraction = 10;
	return niceFraction * base;
}

/** 紧凑数字：1234 → 1.2K，12000 → 12K，1_200_000 → 1.2M。 */
export function compactNumber(value: number): string {
	if (!Number.isFinite(value)) return "0";
	const abs = Math.abs(value);
	if (abs >= 1_000_000) return `${trimZero(value / 1_000_000)}M`;
	if (abs >= 1_000) return `${trimZero(value / 1_000)}K`;
	return String(Math.round(value));
}

function trimZero(n: number): string {
	return n.toFixed(1).replace(/\.0$/, "");
}

/** MM-DD，`2026-10-27` → `10-27`。 */
export function shortDate(date: string): string {
	const parts = date.split("-");
	return parts.length === 3 ? `${parts[1]}-${parts[2]}` : date;
}

/**
 * 根据每日序列算出画图模型。series 需按日期升序。
 * 空序列也会返回一个合法的空模型（避免图表崩掉）。
 */
export function buildChartModel(
	series: DailyPoint[],
	options: ChartOptions = {},
): ChartModel {
	const width = options.width ?? 720;
	const height = options.height ?? 260;
	const padTop = options.padTop ?? 16;
	const padRight = options.padRight ?? 16;
	const padBottom = options.padBottom ?? 26;
	const padLeft = options.padLeft ?? 40;
	const maxXLabels = Math.max(2, options.maxXLabels ?? 6);

	const plotLeft = padLeft;
	const plotRight = width - padRight;
	const plotTop = padTop;
	const plotBottom = height - padBottom;
	const plotW = Math.max(0, plotRight - plotLeft);
	const plotH = Math.max(0, plotBottom - plotTop);

	const peak = series.reduce(
		(max, d) => Math.max(max, d.views || 0, d.visitors || 0),
		0,
	);

	// 先取“圆整的步长”，再把上限抬到步长的整数倍 —— 这样每个刻度都是
	// 0/5/10/15 这种整数，不会出现 13/38。计数天然是整数，步长至少为 1。
	const targetTicks = Math.max(1, options.tickCount ?? 4);
	const rawStep = peak / targetTicks;
	const step = Math.max(1, niceMax(rawStep));
	const yMax = step * Math.max(1, Math.ceil(peak / step));
	const tickStepCount = Math.round(yMax / step);

	const toY = (value: number) =>
		yMax <= 0 ? plotBottom : plotBottom - (Math.max(0, value) / yMax) * plotH;

	const yTicks: YTick[] = [];
	for (let i = 0; i <= tickStepCount; i += 1) {
		const value = step * i;
		yTicks.push({ value, y: toY(value), label: compactNumber(value) });
	}

	const n = series.length;
	const xAt = (index: number) =>
		n <= 1 ? plotLeft + plotW / 2 : plotLeft + (index / (n - 1)) * plotW;

	const points: ScaledPoint[] = series.map((d, index) => ({
		index,
		date: d.date,
		x: xAt(index),
		yViews: toY(d.views || 0),
		yVisitors: toY(d.visitors || 0),
		views: d.views || 0,
		visitors: d.visitors || 0,
	}));

	// x 轴标签：均匀取最多 maxXLabels 个，首尾尽量保留。
	const xLabels: XLabel[] = [];
	if (n > 0) {
		const count = Math.min(maxXLabels, n);
		const step = count <= 1 ? 0 : (n - 1) / (count - 1);
		const seen = new Set<number>();
		for (let i = 0; i < count; i += 1) {
			const index = Math.round(i * step);
			if (seen.has(index)) continue;
			seen.add(index);
			xLabels.push({
				index,
				x: xAt(index),
				label: shortDate(series[index].date),
			});
		}
	}

	return {
		width,
		height,
		yMax,
		plotLeft,
		plotRight,
		plotTop,
		plotBottom,
		yTicks,
		xLabels,
		points,
	};
}

/** 把一串点转成 SVG path 的 `M/L` 指令串。 */
export function toPolyline(
	points: ScaledPoint[],
	key: "yViews" | "yVisitors",
): string {
	if (points.length === 0) return "";
	return points
		.map((p, i) => `${i === 0 ? "M" : "L"}${round2(p.x)},${round2(p[key])}`)
		.join(" ");
}

// ─── 柱状图（时段分布等单系列） ─────────────────────────────────────

export interface BarDatum {
	index: number;
	label: string;
	value: number;
	/** 柱子左边缘 */
	x: number;
	/** 柱子顶部 */
	y: number;
	width: number;
	height: number;
}

export interface BarModel {
	width: number;
	height: number;
	yMax: number;
	plotLeft: number;
	plotRight: number;
	plotTop: number;
	plotBottom: number;
	yTicks: YTick[];
	xLabels: XLabel[];
	bars: BarDatum[];
}

export interface BarOptions extends ChartOptions {
	/** 相邻柱子间的留白（像素），默认 2px。 */
	gap?: number;
	/** 自定义每个柱子的标签（tooltip / x 轴都用它），默认用索引。 */
	labelFor?: (index: number) => string;
}

/**
 * 单系列柱状图的坐标模型：与折线图共用 niceMax 刻度逻辑，
 * 柱子等宽、贴着基线、顶部留圆角（圆角在渲染层做）。
 */
export function buildBarModel(
	values: number[],
	options: BarOptions = {},
): BarModel {
	const width = options.width ?? 720;
	const height = options.height ?? 200;
	const padTop = options.padTop ?? 12;
	const padRight = options.padRight ?? 8;
	const padBottom = options.padBottom ?? 24;
	const padLeft = options.padLeft ?? 36;
	const maxXLabels = Math.max(2, options.maxXLabels ?? 8);
	const gap = Math.max(0, options.gap ?? 2);

	const plotLeft = padLeft;
	const plotRight = width - padRight;
	const plotTop = padTop;
	const plotBottom = height - padBottom;
	const plotW = Math.max(0, plotRight - plotLeft);
	const plotH = Math.max(0, plotBottom - plotTop);

	const peak = values.reduce((max, v) => Math.max(max, v || 0), 0);
	const targetTicks = Math.max(1, options.tickCount ?? 4);
	const step = Math.max(1, niceMax(peak / targetTicks));
	const yMax = step * Math.max(1, Math.ceil(peak / step));
	const tickStepCount = Math.round(yMax / step);

	const toY = (value: number) =>
		yMax <= 0 ? plotBottom : plotBottom - (Math.max(0, value) / yMax) * plotH;

	const yTicks: YTick[] = [];
	for (let i = 0; i <= tickStepCount; i += 1) {
		const value = step * i;
		yTicks.push({ value, y: toY(value), label: compactNumber(value) });
	}

	const n = values.length;
	const slot = n > 0 ? plotW / n : 0;
	const barWidth = Math.max(1, slot - gap);
	const labelFor = options.labelFor ?? ((index: number) => String(index));

	const bars: BarDatum[] = values.map((value, index) => {
		const v = value || 0;
		const y = toY(v);
		return {
			index,
			label: labelFor(index),
			value: v,
			x: plotLeft + index * slot + gap / 2,
			y,
			width: barWidth,
			height: Math.max(0, plotBottom - y),
		};
	});

	// x 轴标签：按步长抽稀，避免 24 根柱子把小时标签挤成一团。
	const xLabels: XLabel[] = [];
	if (n > 0) {
		const count = Math.min(maxXLabels, n);
		const stride = count <= 1 ? n : Math.max(1, Math.ceil(n / count));
		for (let i = 0; i < n; i += stride) {
			xLabels.push({
				index: i,
				x: plotLeft + i * slot + slot / 2,
				label: labelFor(i),
			});
		}
	}

	return {
		width,
		height,
		yMax,
		plotLeft,
		plotRight,
		plotTop,
		plotBottom,
		yTicks,
		xLabels,
		bars,
	};
}

// ─── 表格用的小工具 ────────────────────────────────────────────────

export interface BucketRow {
	name: string;
	value: number;
}

/** 占比（0-100，保留一位小数）。总数非正时返回 0。 */
export function sharePercent(value: number, total: number): number {
	if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0)
		return 0;
	return Math.round((value / total) * 1000) / 10;
}

/** 小时 → `08:00`。 */
export function hourLabel(hour: number): string {
	const h = ((Math.round(hour) % 24) + 24) % 24;
	return `${String(h).padStart(2, "0")}:00`;
}

const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 0=周日 … 6=周六 → `周日`；越界兜底为空串。 */
export function weekdayLabel(weekday: number): string {
	const i = Math.round(weekday);
	return i >= 0 && i < WEEKDAY_NAMES.length ? WEEKDAY_NAMES[i] : "";
}

/**
 * 新老访客占比：返回 { newPercent, returningPercent }，相加可能因四舍五入为 99.9/100.1。
 */
export function audienceSplit(
	newVisitors: number,
	returning: number,
): {
	newPercent: number;
	returningPercent: number;
} {
	const total = (newVisitors || 0) + (returning || 0);
	return {
		newPercent: sharePercent(newVisitors, total),
		returningPercent: sharePercent(returning, total),
	};
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}
