/**
 * 数据分享卡（歌单 / 追番 / 监控 / 年度报告）的纯工具。
 *
 * 卡片由 `cloud-functions/api/og/[[default]].js` 的 satori + resvg 管线渲染，
 * 这里只负责把页面里的数据拼成查询参数。保持纯函数：Astro 构建期与页面
 * 脚本运行时共用同一份实现，避免两处各写一遍拼参逻辑。
 *
 * 注意：云函数不回源抓数据。歌单、监控的实时数据由页面自己取，算好后通过
 * publishOgCardData() 推给分享卡组件，卡片只是把这些数字排成图。
 */

export type OgCardType = "playlist" | "bangumi" | "monitor" | "year";

export interface OgCardStat {
	label: string;
	value: string;
}

export interface OgCardParams {
	title: string;
	/** 副标题最多两行，用 `|` 分隔 */
	subtitle?: string;
	/** 右上角角标，留空时云函数退回显示卡片类型 */
	badge?: string;
	/** 指标格，最多 6 个（超过一行时云函数会自动降级布局） */
	stats?: OgCardStat[];
	/** 底部标签，最多 4 个会显示 */
	tags?: string[];
	/** 一排柱条，用来表现月度节奏这类分布 */
	bars?: number[];
	/** 底栏右侧的补充文本（日期 / 更新时间等） */
	date?: string;
}

/** 与云函数保持一致的上限，超出的部分直接截掉，避免 URL 过长 */
const MAX_TAGS = 6;
const MAX_STATS = 6;
const MAX_BARS = 12;

function clean(value: string | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * 把参数拼成 `type=...&title=...` 形式的查询串（不含 `?`）。
 *
 * stats 用 `标签:数值` 的形态：云函数按最后一个冒号切分，所以标签里的
 * 冒号要先去掉；`|` 是格与格之间的分隔符，数值里同样不能出现。
 */
export function buildOgCardQuery(
	type: OgCardType,
	params: OgCardParams,
): string {
	const query = new URLSearchParams({ type });

	const title = clean(params.title);
	if (title) query.set("title", title);

	const subtitle = clean(params.subtitle);
	if (subtitle) query.set("subtitle", subtitle);

	const badge = clean(params.badge);
	if (badge) query.set("badge", badge);

	const date = clean(params.date);
	if (date) query.set("date", date);

	const stats = (params.stats ?? [])
		.slice(0, MAX_STATS)
		.map((stat) => {
			const label = clean(stat.label).replace(/[:|]/g, "");
			const value = clean(stat.value).replace(/\|/g, "");
			return label && value ? `${label}:${value}` : "";
		})
		.filter(Boolean);
	if (stats.length > 0) query.set("stats", stats.join("|"));

	const tags = (params.tags ?? [])
		.map(clean)
		.filter((tag) => tag && !tag.includes(","))
		.slice(0, MAX_TAGS);
	if (tags.length > 0) query.set("tags", tags.join(","));

	const bars = (params.bars ?? [])
		.filter((value) => Number.isFinite(value) && value >= 0)
		.slice(0, MAX_BARS)
		.map((value) => String(Math.round(value)));
	if (bars.length > 0) query.set("bars", bars.join(","));

	return query.toString();
}

/** 拼出完整的卡片地址；base 是云函数所在域名（见 src/config.ts 的 ogImageBase） */
export function buildOgCardUrl(
	base: string,
	type: OgCardType,
	slug: string,
	params: OgCardParams,
): string {
	const safeSlug = slug.replace(/^\/+|\/+$/g, "") || "card";
	return `${base.replace(/\/+$/, "")}/api/og/${safeSlug}?${buildOgCardQuery(type, params)}`;
}

/**
 * 运行时数据桥：歌单与监控的数据要等接口返回才有，页面脚本算好后通过这个
 * 事件推给分享卡组件，避免组件自己去请求业务接口。
 */
export const OG_CARD_EVENT = "og:card-data";

export function publishOgCardData(
	type: OgCardType,
	params: OgCardParams,
): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent(OG_CARD_EVENT, { detail: { type, params } }),
	);
}
