/**
 * 数据分享卡（歌单 / 追番 / 监控 / 年度报告）：复用云函数 OG 的 satori + resvg 管线。
 *
 * 卡片地址就是 `/api/og/<slug>?type=...`，所以和文章分享卡一样直接拿 PNG：
 * 预览、系统分享、下载都走同一份文件，浏览器端不再画 canvas。
 *
 * 歌单与监控的数据要等接口返回才有，页面脚本算好后通过 publishOgCardData()
 * 发事件，这里收到同 type 的数据就换一份卡片地址重新取图。
 */

import {
	OG_CARD_EVENT,
	type OgCardParams,
	type OgCardType,
	buildOgCardUrl,
} from "../utils/og-card";
import { downloadBlob, fetchAsFile, shareFile, showToast } from "./image-share";

const CARD_FILE: Record<OgCardType, string> = {
	playlist: "playlist",
	bangumi: "bangumi",
	monitor: "monitor",
	year: "year-report",
};

interface CardState {
	type: OgCardType;
	slug: string;
	base: string;
	params: OgCardParams;
	live: boolean;
}

let boundListener = false;
/** 当前页面挂载的卡片；全局监听只认这一份，Swup 换页后自动指向新节点 */
let active: { state: CardState; image: HTMLImageElement | null } | null = null;
/** 数据变化后地址会变，缓存的 File 跟着作废 */
let cachedUrl = "";
let cachedFile: File | null = null;

function cardUrl(state: CardState): string {
	// 云函数返回长缓存，数据变了要换 URL；参数太长时只加进摘要，避免超过 URL 上限
	return buildOgCardUrl(state.base, state.type, state.slug, state.params);
}

function readParams(root: HTMLElement): OgCardParams | null {
	const source = root.querySelector<HTMLScriptElement>("[data-og-card-data]");
	if (!source?.textContent) return null;
	try {
		return JSON.parse(source.textContent) as OgCardParams;
	} catch (error) {
		console.warn("分享卡数据解析失败", error);
		return null;
	}
}

function typeFrom(value: string | undefined): OgCardType | null {
	return value === "playlist" ||
		value === "bangumi" ||
		value === "monitor" ||
		value === "year"
		? value
		: null;
}

/** 卡片数据更新后，预览图与缓存都要跟着换 */
function refreshPreview(
	state: CardState,
	image: HTMLImageElement | null,
): void {
	if (!image) return;
	const url = cardUrl(state);
	if (image.dataset.src === url) return;
	image.dataset.src = url;
	// 先清掉旧图，加载失败时不会继续显示上一次的数据
	image.classList.add("hidden");
	image.src = url;
}

async function cardFile(state: CardState): Promise<File | null> {
	const url = cardUrl(state);
	if (cachedUrl === url && cachedFile) return cachedFile;
	const file = await fetchAsFile(url, `${CARD_FILE[state.type]}.png`);
	if (file) {
		cachedUrl = url;
		cachedFile = file;
	}
	return file;
}

export function mountDataShareCard(): void {
	const root = document.querySelector<HTMLElement>("[data-og-card]");
	if (!root) {
		// 离开卡片页时清掉缓存，避免 Swup 换页后还留着上一页的 File
		active = null;
		cachedUrl = "";
		cachedFile = null;
		return;
	}
	if (root.dataset.cardBound === "true") return;

	const type = typeFrom(root.dataset.ogCardType);
	const slug = root.dataset.ogCardSlug?.trim();
	const base = root.dataset.ogCardBase?.trim();
	const initial = readParams(root);
	if (!type || !slug || !base || !initial) return;

	const dialog = root.querySelector<HTMLDialogElement>("[data-og-card-dialog]");
	const openBtn = root.querySelector<HTMLButtonElement>("[data-og-card-open]");
	const closeBtn = root.querySelector<HTMLButtonElement>(
		"[data-og-card-close]",
	);
	const shareBtn = root.querySelector<HTMLButtonElement>(
		"[data-og-card-share]",
	);
	const downloadBtn = root.querySelector<HTMLButtonElement>(
		"[data-og-card-download]",
	);
	const image = root.querySelector<HTMLImageElement>("[data-og-card-image]");
	const loading = root.querySelector<HTMLElement>("[data-og-card-loading]");
	const fallback = root.querySelector<HTMLElement>("[data-og-card-fallback]");
	if (!dialog || !openBtn) return;

	root.dataset.cardBound = "true";

	const state: CardState = {
		type,
		slug,
		base,
		params: initial,
		live: root.dataset.ogCardLive === "true",
	};
	active = { state, image };

	// 换页重挂时不要重复绑全局事件；监听里只认当前 active，旧节点的事件自然作废
	if (!boundListener) {
		boundListener = true;
		window.addEventListener(OG_CARD_EVENT, (event) => {
			const detail = (
				event as CustomEvent<{ type: OgCardType; params: OgCardParams }>
			).detail;
			if (!active || !detail || detail.type !== active.state.type) return;
			if (!active.state.live) return;
			active.state.params = detail.params;
			refreshPreview(active.state, active.image);
		});
	}

	const showImage = () => {
		loading?.classList.add("hidden");
		fallback?.classList.add("hidden");
		image?.classList.remove("hidden");
	};
	const showLoading = () => {
		fallback?.classList.add("hidden");
		image?.classList.add("hidden");
		loading?.classList.remove("hidden");
	};
	const showFallback = () => {
		loading?.classList.add("hidden");
		image?.classList.add("hidden");
		fallback?.classList.remove("hidden");
	};

	image?.addEventListener("load", showImage);
	image?.addEventListener("error", showFallback);

	const open = () => {
		if (!dialog.open) dialog.showModal();
		dialog.classList.remove("hidden");
		dialog.classList.add("flex");
		// 每次打开都检查一次：数据可能已经在对话框关闭期间更新了
		if (!image) return;
		const url = cardUrl(state);
		if (image.dataset.src !== url) {
			showLoading();
			refreshPreview(state, image);
		} else if (image.complete) {
			if (image.naturalWidth > 0) showImage();
			else showFallback();
		}
	};

	const close = () => {
		dialog.classList.add("hidden");
		dialog.classList.remove("flex");
		if (dialog.open) dialog.close();
	};

	const share = async () => {
		const file = await cardFile(state);
		if (!file) {
			showToast("卡片还没准备好，请稍后再试");
			return;
		}
		const text = `${state.params.title} · ${document.title}`;
		if (await shareFile(file, text)) return;
		downloadBlob(file, file.name);
		showToast("当前环境不支持直接分享，卡片已下载");
	};

	const download = async () => {
		const file = await cardFile(state);
		if (!file) {
			showToast("卡片下载失败，请稍后再试");
			return;
		}
		downloadBlob(file, file.name);
		showToast("卡片已下载");
	};

	openBtn.addEventListener("click", open);
	closeBtn?.addEventListener("click", close);
	shareBtn?.addEventListener("click", () => void share());
	downloadBtn?.addEventListener("click", () => void download());
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) close();
	});
	dialog.addEventListener("close", () => {
		dialog.classList.add("hidden");
		dialog.classList.remove("flex");
	});

	// 预取一次，点分享时不必等网络（iOS Safari 的分享手势经不起 await）
	refreshPreview(state, image);
	void cardFile(state);
}
