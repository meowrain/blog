// 阅读布局模式。只做数据与推导，不碰 DOM，方便单测；
// 落盘、写 html 属性在 setting-utils 里。

export type ReadingLayout = "standard" | "wide" | "focus";

export interface ReadingLayoutOption {
	value: ReadingLayout;
	label: string;
	description: string;
	icon: string;
}

export const DEFAULT_READING_LAYOUT: ReadingLayout = "standard";

export const READING_LAYOUT_OPTIONS: ReadingLayoutOption[] = [
	{
		value: "standard",
		label: "标准",
		description: "侧栏 + 正文 + 目录",
		icon: "material-symbols:view-sidebar-rounded",
	},
	{
		value: "wide",
		label: "宽屏",
		description: "收起侧栏，正文加宽",
		icon: "material-symbols:open-in-full-rounded",
	},
	{
		value: "focus",
		label: "沉浸",
		description: "只留正文，居中阅读",
		icon: "material-symbols:chrome-reader-mode-outline-rounded",
	},
];

export function isReadingLayout(value: unknown): value is ReadingLayout {
	return value === "standard" || value === "wide" || value === "focus";
}

/** 未知 / 空值一律回落到标准布局，避免脏 localStorage 把页面卡在某个模式 */
export function normalizeReadingLayout(value: unknown): ReadingLayout {
	return isReadingLayout(value) ? value : DEFAULT_READING_LAYOUT;
}
