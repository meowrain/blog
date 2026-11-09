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

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}
