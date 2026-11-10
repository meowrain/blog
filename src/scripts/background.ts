import {
	type BackgroundSource,
	appendCacheBuster,
	buildBackgroundPlan,
} from "../utils/background-core";

/**
 * 随机二次元壁纸。
 *
 * - 上次用过的图存在 localStorage，刷新时先直接铺上，避免长时间只有渐变；
 * - 同时后台把候选源**并发**拉一遍，第一张解码完成的就采用（串行等待会让
 *   最慢的那个源决定总耗时）；
 * - 全部失败则保留旧图或渐变，不会出现破图；
 * - 壁纸就绪后给 <html> 打上 data-random-bg="ready"，CSS 据此把底下的紫色
 *   渐变层（#bg-box）淡出，否则壁纸上会一直蒙着主题色；
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
			timeout: Number(carrier?.dataset.bgTimeout) || 6000,
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

/**
 * 按视口宽度算请求宽度：够铺满 cover 即可，不必拉 4K 原图。
 * 上限 2560：再大对整屏模糊背景没有肉眼收益，只会让首屏多等几秒。
 */
function viewportWidth(): number {
	// 限制到 2x，避免高 DPR 手机上请求过大的图
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	return Math.min(Math.round(window.innerWidth * dpr), 2560);
}

function applyBackground(url: string): void {
	const layer = document.getElementById("bg-photo");
	if (!layer) return;
	// 只换 background-image，不碰 filter / display，避免和设置面板的模糊、禁用背景打架
	layer.style.backgroundImage = `url("${url}")`;
	layer.dataset.randomBg = "ready";
	// 让 CSS 把底下的紫色渐变淡出，壁纸才是原色
	document.documentElement.dataset.randomBg = "ready";
}

/** 一次图片加载，可中途取消。取消后 promise 以 false 收尾。 */
function loadImage(
	url: string,
	timeout: number,
): { promise: Promise<boolean>; cancel: () => void } {
	let image: HTMLImageElement | null = new Image();
	let finish: (ok: boolean) => void = () => {};

	const promise = new Promise<boolean>((resolve) => {
		let settled = false;
		const done = (ok: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (image) {
				image.onload = null;
				image.onerror = null;
			}
			resolve(ok);
		};
		finish = done;
		const timer = setTimeout(() => done(false), timeout);
		const current = image as HTMLImageElement;
		current.onload = () => done(current.naturalWidth > 0);
		current.onerror = () => done(false);
		current.decoding = "async";
		current.src = url;
	});

	return {
		promise,
		cancel() {
			if (image) {
				image.onload = null;
				image.onerror = null;
				image.src = "";
				image = null;
			}
			finish(false);
		},
	};
}

/**
 * 并发拉所有候选，返回第一张能解码的 URL；全部失败返回 null。
 * 采用后立刻取消其余加载，不浪费流量。
 */
async function pickFirst(
	urls: readonly string[],
	timeout: number,
): Promise<string | null> {
	const handles = urls.map((url) => loadImage(url, timeout));
	return new Promise<string | null>((resolve) => {
		let settled = false;
		let pending = handles.length;

		// winner 不取消：它的图片已经解码好，取消会把 src 清掉，
		// 紧接着设置 background-image 就得重新走一次网络
		const finish = (url: string | null, winner: number) => {
			if (settled) return;
			settled = true;
			handles.forEach((handle, index) => {
				if (index !== winner) handle.cancel();
			});
			resolve(url);
		};

		if (pending === 0) {
			finish(null, -1);
			return;
		}

		handles.forEach((handle, index) => {
			handle.promise.then((ok) => {
				if (settled) return;
				if (ok) {
					finish(urls[index], index);
					return;
				}
				pending--;
				if (pending === 0) finish(null, -1);
			});
		});
	});
}

export async function mountRandomBackground(): Promise<void> {
	if (started) return;
	started = true;

	const options = readOptions();
	if (!options) return;

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

	// 上次的图和本次的新图**同时**开始加载，谁先好谁上，不互相排队。
	// 缓存里存的是带 cache-buster 的完整地址，图片本身可被浏览器缓存
	// （各图源的 max-age 都在 30 天左右），所以首屏通常几十毫秒就能铺上；
	// 旧地址也可能已经失效（图源换域名、图片下架），校验失败就跳过。
	const cached = readCache();
	const cachedHandle = cached ? loadImage(cached, 1500) : null;
	// 新图一旦铺上，后到的旧图就不能再覆盖它
	let applied = false;
	if (cachedHandle) {
		void cachedHandle.promise.then((ok) => {
			if (ok && !applied) applyBackground(cached);
		});
	}

	const fresh = await pickFirst(plan, options.timeout);
	if (fresh) {
		// 图片已解码，直接替换不会出现空白帧
		applied = true;
		cachedHandle?.cancel(); // 旧图不用再加载了，省流量
		applyBackground(fresh);
		writeCache(fresh);
	}
	// 全部源都失败：保留 cached（若有），否则维持渐变背景
}
