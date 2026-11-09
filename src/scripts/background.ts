import {
	type BackgroundSource,
	appendCacheBuster,
	buildBackgroundPlan,
} from "../utils/background-core";

/**
 * 随机二次元壁纸。
 *
 * - 上次用过的图存在 localStorage，刷新时先直接铺上，避免长时间只有渐变；
 * - 同时后台随机挑一个源拉新图，加载并解码完成后无缝替换（不会白屏）；
 * - 单个源超时 / 失败就换下一个候选；全部失败则保留旧图或渐变；
 * - 站点用 Swup 做无刷新跳转，#bg-photo 常在容器外，脚本只在整页加载时跑一次，
 *   换页时背景保持不变。
 */

const STORAGE_KEY = "random-bg-url";

interface RandomBackgroundOptions {
	sources: BackgroundSource[];
	timeout: number;
	maxAttempts: number;
}

let started = false;

function readOptions(): RandomBackgroundOptions | null {
	const carrier = document.getElementById("config-carrier");
	const raw = carrier?.dataset.bgSources;
	if (!raw) return null;
	try {
		const sources = JSON.parse(raw) as BackgroundSource[];
		if (!Array.isArray(sources) || sources.length === 0) return null;
		return {
			sources,
			timeout: Number(carrier?.dataset.bgTimeout) || 8000,
			maxAttempts: Number(carrier?.dataset.bgMaxAttempts) || 3,
		};
	} catch {
		return null;
	}
}

function readCache(): string {
	try {
		return localStorage.getItem(STORAGE_KEY) || "";
	} catch {
		return "";
	}
}

function writeCache(url: string): void {
	try {
		localStorage.setItem(STORAGE_KEY, url);
	} catch {
		// 隐私模式下 localStorage 可能不可写，忽略即可
	}
}

/** 按视口宽度算请求宽度：够铺满 cover 即可，不必拉 4K 原图。 */
function viewportWidth(): number {
	// 限制到 2x，避免高 DPR 手机上请求过大的图
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	return Math.round(window.innerWidth * dpr);
}

function applyBackground(url: string): void {
	const layer = document.getElementById("bg-photo");
	if (!layer) return;
	// 只换 background-image，不碰 filter / display，避免和设置面板的模糊、禁用背景打架
	layer.style.backgroundImage = `url("${url}")`;
	layer.dataset.randomBg = "ready";
}

/** 预加载并解码一张图，成功返回 true；超时 / 出错返回 false。 */
function preload(url: string, timeout: number): Promise<boolean> {
	return new Promise((resolve) => {
		const image = new Image();
		let settled = false;
		const finish = (ok: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			image.onload = null;
			image.onerror = null;
			resolve(ok);
		};
		const timer = setTimeout(() => finish(false), timeout);
		image.onload = () => finish(image.naturalWidth > 0);
		image.onerror = () => finish(false);
		image.decoding = "async";
		image.src = url;
	});
}

export async function mountRandomBackground(): Promise<void> {
	if (started) return;
	started = true;

	const options = readOptions();
	if (!options) return;

	// 先铺上次的图，首屏不用干等网络
	const cached = readCache();
	if (cached) applyBackground(cached);

	const plan = buildBackgroundPlan(options.sources, {
		mobile: window.innerWidth < 768,
		maxAttempts: options.maxAttempts,
		width: viewportWidth(),
	}).map((url) =>
		appendCacheBuster(
			url,
			`${Date.now()}-${Math.random().toString(36).slice(2)}`,
		),
	);

	for (const url of plan) {
		if (await preload(url, options.timeout)) {
			// 图片已解码，直接替换不会出现空白帧
			applyBackground(url);
			writeCache(url);
			return;
		}
	}
	// 全部源都失败：保留 cached（若有），否则维持渐变背景
}
