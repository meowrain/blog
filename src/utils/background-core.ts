// 随机背景图源的选择逻辑。只做纯数据处理（洗牌、模板替换、加缓存旁路参数），
// 不碰 DOM、不发请求，方便单测。真正的加载与切换在 src/scripts/background.ts。

import type { BackgroundSource } from "../types/config";

export type { BackgroundSource };

export interface BackgroundPlanOptions {
	/** 是否用 `mobileUrl`（竖屏图），没有配置时回落到 `url` */
	mobile?: boolean;
	/** 最多返回几个候选 URL，默认 3 */
	maxAttempts?: number;
	/** 请求宽度，替换 URL 里的 `{width}` 占位符 */
	width?: number;
	/** 洗牌用的随机源，默认 Math.random，测试时注入固定序列 */
	random?: () => number;
}

/** 洗牌（Fisher–Yates），不改动入参。 */
export function shuffleSources<T>(
	items: readonly T[],
	random: () => number,
): T[] {
	const result = [...items];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

/** 按设备挑 URL，并把 `{width}` 换成实际宽度；负数和 0 视为不替换。 */
export function resolveSourceUrl(
	source: BackgroundSource,
	options: BackgroundPlanOptions = {},
): string {
	const raw = options.mobile ? source.mobileUrl || source.url : source.url;
	const width = options.width;
	if (!width || width <= 0) return raw;
	return raw.replaceAll("{width}", String(Math.round(width)));
}

/**
 * 生成有序的候选 URL 列表：先洗牌再截断，调用方按顺序逐个尝试，
 * 前一个加载失败就换下一个。
 */
export function buildBackgroundPlan(
	sources: readonly BackgroundSource[],
	options: BackgroundPlanOptions = {},
): string[] {
	const random = options.random ?? Math.random;
	const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
	return shuffleSources(sources, random)
		.slice(0, maxAttempts)
		.map((source) => resolveSourceUrl(source, options));
}

/**
 * 加一个随机查询参数绕过浏览器 / CDN 缓存，保证每次拿到不同的图。
 * 绝对 / 相对 URL 都支持；解析不了就退化成字符串拼接。
 */
export function appendCacheBuster(url: string, token: string): string {
	if (!token) return url;
	if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url)) {
		try {
			const parsed = new URL(url);
			parsed.searchParams.set("_bg", token);
			return parsed.toString();
		} catch {
			// 落到下面的字符串拼接
		}
	}
	const [pathAndQuery, hash = ""] = url.split("#");
	const separator = pathAndQuery.includes("?") ? "&" : "?";
	const next = `${pathAndQuery}${separator}_bg=${encodeURIComponent(token)}`;
	return hash ? `${next}#${hash}` : next;
}
