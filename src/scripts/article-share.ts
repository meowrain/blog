import { downloadBlob, fetchAsFile, shareFile, showToast } from "./image-share";

/**
 * 文章分享卡片：直接复用文章 OG 图（云函数实时渲染的 1200x630 PNG），
 * 不再用 canvas 另画一套。文章页在 Swup 容器内，换页后要重新挂载。
 */

type ShareState = {
	title: string;
	slug: string;
	cardUrl: string;
};

let activeDialog: HTMLDialogElement | null = null;
let scrollLocked = false;
let bodyOverflow = "";
let hooksBound = false;
let toastHome: { parent: Node; next: Node | null } | null = null;

const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

function prefersReducedMotion(): boolean {
	return (
		window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
	);
}

/** 进场：遮罩淡入 + 面板从下方轻微弹出 */
function animateIn(dialog: HTMLElement, panel: HTMLElement | null): void {
	if (prefersReducedMotion()) return;
	dialog.animate([{ opacity: 0 }, { opacity: 1 }], {
		duration: 220,
		easing: "ease-out",
	});
	panel?.animate(
		[
			{ opacity: 0, transform: "translateY(14px) scale(0.965)" },
			{ opacity: 1, transform: "translateY(0) scale(1)" },
		],
		{ duration: 300, easing: EASE_OUT },
	);
}

/**
 * 退场：反向收起。返回跑完的动画，调用方先隐藏元素再 cancel，
 * 否则 cancel 的瞬间元素会以 opacity:1 闪一帧。
 */
function animateOut(
	dialog: HTMLElement,
	panel: HTMLElement | null,
): Promise<Animation[]> {
	if (prefersReducedMotion()) return Promise.resolve([]);
	const animations = [
		dialog.animate([{ opacity: 1 }, { opacity: 0 }], {
			duration: 180,
			easing: "ease-in",
			fill: "both",
		}),
		...(panel
			? [
					panel.animate(
						[
							{ opacity: 1, transform: "translateY(0) scale(1)" },
							{ opacity: 0, transform: "translateY(8px) scale(0.975)" },
						],
						{ duration: 150, easing: "ease-in", fill: "both" },
					),
				]
			: []),
	];
	return Promise.all(
		animations.map((animation) => animation.finished.catch(() => undefined)),
	).then(() => animations);
}

/** 弹窗打开时预取，系统分享点击时就不必 await fetch（iOS Safari 会丢手势） */
let prefetchedUrl = "";
let prefetchedFile: File | null = null;
let prefetchedPromise: Promise<File | null> | null = null;

function shareUrl(): string {
	const canonical = document
		.querySelector<HTMLLinkElement>('link[rel="canonical"]')
		?.href.trim();
	if (canonical) return canonical;
	const url = new URL(window.location.href);
	url.hash = "";
	return url.href;
}

/** slug 里的 / 换成 -，去掉文件系统非法字符，拼成下载文件名 */
function cardFileName(slug: string): string {
	const safe = slug
		.replace(/[/\\]+/g, "-")
		.replace(/[<>:"|?*]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[-.]+|[-.]+$/g, "");
	return `${safe || "article"}.png`;
}

function legacyCopy(text: string): boolean {
	try {
		const area = document.createElement("textarea");
		area.value = text;
		area.style.position = "fixed";
		area.style.opacity = "0";
		area.setAttribute("readonly", "");
		document.body.appendChild(area);
		area.select();
		const copied = document.execCommand("copy");
		area.remove();
		return copied;
	} catch {
		return false;
	}
}

async function copyText(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// clipboard 权限被拒时继续走 execCommand 兜底
	}
	return legacyCopy(text);
}

function lockScroll(): void {
	if (scrollLocked) return;
	scrollLocked = true;
	bodyOverflow = document.body.style.overflow;
	document.body.style.overflow = "hidden";
}

function unlockScroll(): void {
	if (!scrollLocked) return;
	scrollLocked = false;
	document.body.style.overflow = bodyOverflow;
}

/**
 * 全局轻提示不在 top layer 里，dialog 打开后会被遮罩盖住；
 * 临时把同一个 toast 节点挪进 dialog，关闭时再放回原位。
 */
function moveToastInto(dialog: HTMLDialogElement): void {
	const toast = document.getElementById("image-share-toast");
	if (!toast || toast.parentElement === dialog) return;
	toastHome = { parent: toast.parentNode as Node, next: toast.nextSibling };
	dialog.appendChild(toast);
}

function restoreToast(): void {
	const toast = document.getElementById("image-share-toast");
	if (!toast || !toastHome) return;
	const { parent, next } = toastHome;
	if (next && next.parentNode === parent) {
		parent.insertBefore(toast, next);
	} else {
		parent.appendChild(toast);
	}
	toastHome = null;
}

function prefetchCard(state: ShareState): void {
	if (prefetchedUrl === state.cardUrl && prefetchedPromise) return;
	prefetchedUrl = state.cardUrl;
	prefetchedFile = null;
	prefetchedPromise = fetchAsFile(state.cardUrl, cardFileName(state.slug)).then(
		(file) => {
			if (prefetchedUrl !== state.cardUrl) return null;
			prefetchedFile = file;
			return file;
		},
	);
}

async function cachedCardFile(state: ShareState): Promise<File | null> {
	if (prefetchedUrl === state.cardUrl) {
		if (prefetchedFile) return prefetchedFile;
		if (prefetchedPromise) return prefetchedPromise;
	}
	return fetchAsFile(state.cardUrl, cardFileName(state.slug));
}

async function shareWithoutFile(state: ShareState): Promise<void> {
	const url = shareUrl();
	if (typeof navigator.share === "function") {
		try {
			await navigator.share({
				title: state.title,
				text: `${state.title}\n${url}`,
				url,
			});
			return;
		} catch (error) {
			if ((error as DOMException)?.name === "AbortError") return;
		}
	}
	const copied = await copyText(url);
	showToast(copied ? "已复制链接，可粘贴分享" : "分享失败，请手动复制链接");
}

function shareArticle(state: ShareState): void {
	const url = shareUrl();
	if (prefetchedFile) {
		// 先同步调用 navigator.share，保留用户手势；文件不受支持再降级
		void shareFile(prefetchedFile, `${state.title}\n${url}`).then((shared) => {
			if (!shared) void shareWithoutFile(state);
		});
		return;
	}
	void shareWithoutFile(state);
}

async function copyArticleLink(): Promise<void> {
	const copied = await copyText(shareUrl());
	showToast(copied ? "链接已复制" : "复制失败，请手动复制链接");
}

async function downloadCard(state: ShareState): Promise<void> {
	const file = await cachedCardFile(state);
	if (file) {
		downloadBlob(file, cardFileName(state.slug));
		showToast("卡片已下载");
		return;
	}
	// 跨域 / 404 / 413 / 500 都拿不到 blob，只能新开标签页让用户自己存
	window.open(state.cardUrl, "_blank", "noopener");
	showToast("已打开卡片，可长按保存");
}

/** Swup 换页时页面节点马上会被替换，不做退场动画，直接收状态 */
function closeActiveShare(): void {
	if (activeDialog?.open) {
		activeDialog.close();
	} else {
		activeDialog = null;
		unlockScroll();
		restoreToast();
	}
}

function bindSwupHooks(): void {
	if (hooksBound) return;
	hooksBound = true;
	const bind = () => {
		window.swup?.hooks?.on("visit:start", closeActiveShare);
		window.swup?.hooks?.on("page:view", mountArticleShare);
	};
	if (window.swup) {
		bind();
	} else {
		document.addEventListener("swup:enable", bind, { once: true });
	}
}

export function mountArticleShare(): void {
	bindSwupHooks();

	// 页面节点已被 Swup 换掉但没走 close 事件时，收个尾
	if (activeDialog && !activeDialog.isConnected) {
		activeDialog = null;
		unlockScroll();
		restoreToast();
	}

	const trigger = document.querySelector<HTMLButtonElement>(
		"[data-article-share]",
	);
	const dialog = document.querySelector<HTMLDialogElement>(
		"[data-article-share-dialog]",
	);
	if (!trigger || !dialog) return;
	if (dialog.dataset.bound === "true") return;
	dialog.dataset.bound = "true";

	const title = trigger.dataset.title?.trim() || document.title;
	const slug = trigger.dataset.slug?.trim() || "";
	const cardUrl = trigger.dataset.cardUrl?.trim() || "";
	if (!cardUrl) return;
	const state: ShareState = { title, slug, cardUrl };

	const image = dialog.querySelector<HTMLImageElement>(
		"[data-article-share-image]",
	);
	const skeleton = dialog.querySelector<HTMLElement>(
		"[data-article-share-skeleton]",
	);
	const fallback = dialog.querySelector<HTMLElement>(
		"[data-article-share-fallback]",
	);
	const closeBtn = dialog.querySelector<HTMLButtonElement>(
		"[data-article-share-close]",
	);
	const systemBtn = dialog.querySelector<HTMLButtonElement>(
		"[data-article-share-system]",
	);
	const copyBtn = dialog.querySelector<HTMLButtonElement>(
		"[data-article-share-copy]",
	);
	const downloadBtn = dialog.querySelector<HTMLButtonElement>(
		"[data-article-share-download]",
	);

	const panel = dialog.querySelector<HTMLElement>("[data-article-share-panel]");

	const showSkeleton = () => {
		fallback?.classList.add("hidden");
		fallback?.classList.remove("flex");
		image?.classList.add("hidden");
		skeleton?.classList.remove("hidden");
		skeleton?.classList.add("flex");
	};
	const showImage = () => {
		skeleton?.classList.add("hidden");
		skeleton?.classList.remove("flex");
		fallback?.classList.add("hidden");
		fallback?.classList.remove("flex");
		image?.classList.remove("hidden");
		// 骨架屏直接消失太生硬，图片淡入接上
		if (image && !prefersReducedMotion()) {
			image.animate([{ opacity: 0 }, { opacity: 1 }], {
				duration: 260,
				easing: "ease-out",
			});
		}
	};
	const showFallback = () => {
		skeleton?.classList.add("hidden");
		skeleton?.classList.remove("flex");
		image?.classList.add("hidden");
		fallback?.classList.remove("hidden");
		fallback?.classList.add("flex");
	};
	const syncPreview = () => {
		if (!image) return;
		if (image.complete) {
			if (image.naturalWidth > 0) showImage();
			else showFallback();
		}
	};

	image?.addEventListener("load", showImage);
	image?.addEventListener("error", showFallback);

	// 退场动画期间挡住重复触发，也避免 Swup 换页时叠加两次关闭。
	// openToken 用来识别「关到一半又被重新打开」的情况，别让旧动画把新弹窗收走。
	let closing = false;
	let openToken = 0;

	const finishClose = (token: number, animations: Animation[]) => {
		if (token !== openToken) return;
		// 先让元素隐身，再 cancel 掉 fill:both 的动画，避免闪回不透明的一帧
		dialog.classList.add("hidden");
		dialog.classList.remove("flex");
		for (const animation of animations) animation.cancel();
		if (activeDialog === dialog) activeDialog = null;
		unlockScroll();
		restoreToast();
		if (dialog.open) dialog.close();
		closing = false;
	};

	const close = () => {
		if (closing) return;
		if (!dialog.open && dialog.classList.contains("hidden")) return;
		closing = true;
		const token = ++openToken;
		void animateOut(dialog, panel).then((animations) =>
			finishClose(token, animations),
		);
	};

	// Esc 默认会立刻 close()，拦下来走统一退场动画
	dialog.addEventListener("cancel", (event) => {
		event.preventDefault();
		close();
	});

	// 兜底：外部直接 close()（Swup 换页等）时同步状态，避免遮罩残留
	dialog.addEventListener("close", () => {
		if (closing) return;
		dialog.classList.add("hidden");
		dialog.classList.remove("flex");
		if (activeDialog === dialog) activeDialog = null;
		unlockScroll();
		restoreToast();
	});

	// 点遮罩关闭；点在面板内部时 target 不是 dialog
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) close();
	});

	closeBtn?.addEventListener("click", close);
	copyBtn?.addEventListener("click", () => void copyArticleLink());
	systemBtn?.addEventListener("click", () => shareArticle(state));
	downloadBtn?.addEventListener("click", () => void downloadCard(state));

	trigger.addEventListener("click", () => {
		if (!dialog.isConnected) return;
		if (activeDialog && activeDialog !== dialog) closeActiveShare();
		activeDialog = dialog;
		// 退场动画还没跑完就再次打开：作废旧动画，重新进场
		closing = false;
		openToken += 1;
		for (const animation of [
			...dialog.getAnimations(),
			...(panel?.getAnimations() ?? []),
		]) {
			animation.cancel();
		}
		lockScroll();
		moveToastInto(dialog);
		dialog.classList.remove("hidden");
		dialog.classList.add("flex");
		if (!dialog.open) dialog.showModal();
		animateIn(dialog, panel);
		prefetchCard(state);
		// 重新打开时图片可能早已加载 / 早已失败，骨架屏不能一直挂着
		showSkeleton();
		syncPreview();
	});
}
