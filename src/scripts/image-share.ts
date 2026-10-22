/**
 * 图片预览的通用能力：下载原图、复制链接，以及「照片 + 文案」分享卡片。
 *
 * 相册查看器（gallery.ts）和正文图片预览（Fancybox）共用同一套面板；面板用
 * <dialog> 承载，showModal() 会进入 top layer，所以能盖住同样是 modal dialog
 * 实现的 Fancybox。
 */

import { registerShortcut } from "./shortcuts";

const CARD_WIDTH = 1080;
const CARD_PADDING = 64;
const CARD_TEXT_SIZE = 40;
const CARD_PHOTO_MAX_HEIGHT = 1320;
const CARD_MAX_LINES = 6;
const CARD_CJK = /[\u2e80-\u9fff\u3000-\u303f\uf900-\ufaff\uff00-\uffef]/;

export type ShareTarget = {
	url: string;
	filename: string;
};

type ShareSheetElements = {
	panel: HTMLDialogElement | null;
	closeBtn: HTMLButtonElement | null;
	text: HTMLTextAreaElement | null;
	textCount: HTMLSpanElement | null;
	watermark: HTMLInputElement | null;
	canvas: HTMLCanvasElement | null;
	cardShareBtn: HTMLButtonElement | null;
	cardDownloadBtn: HTMLButtonElement | null;
	shareOriginalBtn: HTMLButtonElement | null;
	downloadOriginalBtn: HTMLButtonElement | null;
	copyLinkBtn: HTMLButtonElement | null;
	toast: HTMLDivElement | null;
};

let elements: ShareSheetElements | null = null;
let target: ShareTarget | null = null;
let cardImage: HTMLImageElement | null = null;
/** 文案跟着浏览会话走：翻图、换页都不丢 */
let draftText = "";
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let cardTimer: ReturnType<typeof setTimeout> | undefined;
let imageToken = 0;
let bound = false;

function byId<T extends HTMLElement>(id: string) {
	return document.getElementById(id) as T | null;
}

/** 面板写在 Layout 里、不随 Swup 换页重建，取一次缓存住即可 */
function els(): ShareSheetElements {
	if (!elements) {
		elements = {
			panel: byId<HTMLDialogElement>("image-share-panel"),
			closeBtn: byId<HTMLButtonElement>("image-share-close"),
			text: byId<HTMLTextAreaElement>("image-share-text"),
			textCount: byId<HTMLSpanElement>("image-share-count"),
			watermark: byId<HTMLInputElement>("image-share-watermark"),
			canvas: byId<HTMLCanvasElement>("image-share-canvas"),
			cardShareBtn: byId<HTMLButtonElement>("image-share-card-share"),
			cardDownloadBtn: byId<HTMLButtonElement>("image-share-card-download"),
			shareOriginalBtn: byId<HTMLButtonElement>("image-share-original"),
			downloadOriginalBtn: byId<HTMLButtonElement>(
				"image-share-download-original",
			),
			copyLinkBtn: byId<HTMLButtonElement>("image-share-copy-link"),
			toast: byId<HTMLDivElement>("image-share-toast"),
		};
	}
	return elements;
}

/* --------------------------------- 通用小工具 --------------------------------- */

export function absoluteUrl(url: string) {
	return new URL(url, window.location.href).href;
}

function isSameOrigin(url: string) {
	try {
		return new URL(url, window.location.href).origin === window.location.origin;
	} catch {
		return false;
	}
}

/** 从地址里抠出文件名，抠不到就退回兜底名 */
export function fileNameFromUrl(url: string, fallback = "image") {
	try {
		const path = new URL(url, window.location.href).pathname;
		const name = decodeURIComponent(path.split("/").pop() ?? "").trim();
		return name || fallback;
	} catch {
		return fallback;
	}
}

export function showToast(message: string) {
	const { toast } = els();
	if (!toast) return;
	toast.textContent = message;
	toast.classList.remove("hidden");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => toast.classList.add("hidden"), 2400);
}

function triggerDownload(url: string, filename: string) {
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.rel = "noopener";
	document.body.appendChild(link);
	link.click();
	link.remove();
}

export function downloadBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	triggerDownload(url, filename);
	setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** http 域名 / 无用户手势时 clipboard API 会拒绝，退回 execCommand 再试一次 */
function legacyCopy(text: string) {
	const area = document.createElement("textarea");
	area.value = text;
	area.style.position = "fixed";
	area.style.opacity = "0";
	document.body.appendChild(area);
	area.select();
	const copied = document.execCommand("copy");
	area.remove();
	return copied;
}

async function copyText(text: string, successMessage: string) {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
		} else if (!legacyCopy(text)) {
			throw new Error("copy rejected");
		}
		showToast(successMessage);
	} catch {
		if (legacyCopy(text)) {
			showToast(successMessage);
			return;
		}
		showToast("复制失败，请长按或右键手动复制");
	}
}

function cardFileName(filename: string) {
	return `card-${filename.replace(/\.[^.]+$/, "") || "image"}.png`;
}

function siteInfo() {
	const { panel } = els();
	return {
		title: panel?.dataset.siteTitle?.trim() || document.title,
		url: panel?.dataset.siteUrl?.trim() || window.location.host,
	};
}

/** 主题色的实际计算值（--primary 是 oklch 表达式，得让浏览器先解析） */
export function accentColor() {
	const probe = document.createElement("span");
	probe.style.color = "var(--primary)";
	probe.style.position = "fixed";
	probe.style.opacity = "0";
	document.body.appendChild(probe);
	const color = getComputedStyle(probe).color;
	probe.remove();
	return color || "rgb(236, 118, 164)";
}

/** 下载原图：跨域地址上 <a download> 会被忽略，先抓成 blob 再存 */
export async function downloadImage(url: string, filename?: string) {
	const name = filename?.trim() || fileNameFromUrl(url);
	const href = absoluteUrl(url);
	if (!isSameOrigin(href)) {
		const file = await fetchAsFile(href, name);
		if (file) {
			downloadBlob(file, name);
			showToast(`正在下载 ${name}`);
			return;
		}
		// 跨域又不给 CORS，只能开个新标签页让用户自己存
		showToast("图片来自外部域名，已在新标签页打开");
		window.open(href, "_blank", "noopener");
		return;
	}
	triggerDownload(href, name);
	showToast(`正在下载 ${name}`);
}

/* ---------------------------------- 分享卡片 ---------------------------------- */

export function roundRectPath(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number,
) {
	const r = Math.min(radius, width / 2, height / 2);
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + width, y, x + width, y + height, r);
	ctx.arcTo(x + width, y + height, x, y + height, r);
	ctx.arcTo(x, y + height, x, y, r);
	ctx.arcTo(x, y, x + width, y, r);
	ctx.closePath();
}

export function cardFont(size: number, weight = 600) {
	return `${weight} ${size}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
}

/** 中文逐字断行、英文按词断行 */
function tokenizeForCard(text: string) {
	const tokens: string[] = [];
	let buffer = "";
	for (const char of text) {
		if (CARD_CJK.test(char) || char === " " || char === "\t" || char === "\n") {
			if (buffer) {
				tokens.push(buffer);
				buffer = "";
			}
			tokens.push(char);
		} else {
			buffer += char;
		}
	}
	if (buffer) tokens.push(buffer);
	return tokens;
}

export function wrapCardText(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
	maxLines: number,
) {
	const lines: string[] = [];
	let line = "";
	let truncated = false;

	for (const token of tokenizeForCard(text.replace(/\r/g, ""))) {
		if (token === "\n") {
			lines.push(line.trimEnd());
			line = "";
			if (lines.length >= maxLines) {
				truncated = true;
				break;
			}
			continue;
		}
		const candidate = line ? line + token : token === " " ? "" : token;
		if (line && ctx.measureText(candidate.trimEnd()).width > maxWidth) {
			lines.push(line.trimEnd());
			line = token.trimStart();
			if (lines.length >= maxLines) {
				truncated = true;
				break;
			}
			continue;
		}
		line = candidate;
	}

	if (!truncated && line.trim()) lines.push(line.trimEnd());

	const result = lines.slice(0, maxLines);
	if (truncated && result.length > 0) {
		result[result.length - 1] = `${result[result.length - 1]}…`;
	}
	return result;
}

function drawCard(
	canvas: HTMLCanvasElement,
	image: HTMLImageElement,
	text: string,
	watermark: boolean,
) {
	const naturalWidth = image.naturalWidth || 1;
	const naturalHeight = image.naturalHeight || 1;
	const innerWidth = CARD_WIDTH - CARD_PADDING * 2;

	let photoWidth = innerWidth;
	let photoHeight = Math.round((innerWidth * naturalHeight) / naturalWidth);
	// 竖长图（比如手机 9:16）别把卡片拉成一条，缩窄留出侧边
	if (photoHeight > CARD_PHOTO_MAX_HEIGHT) {
		photoHeight = CARD_PHOTO_MAX_HEIGHT;
		photoWidth = Math.round(
			(CARD_PHOTO_MAX_HEIGHT * naturalWidth) / naturalHeight,
		);
	}

	canvas.width = CARD_WIDTH;
	canvas.height = 8;
	const measure = canvas.getContext("2d");
	if (!measure) return;
	measure.font = cardFont(CARD_TEXT_SIZE);
	const lines = text.trim()
		? wrapCardText(measure, text, innerWidth, CARD_MAX_LINES)
		: [];
	const lineHeight = Math.round(CARD_TEXT_SIZE * 1.5);
	const textBlock = lines.length > 0 ? 44 + lines.length * lineHeight : 0;
	const footerBlock = watermark ? 96 : 0;
	const height = CARD_PADDING * 2 + photoHeight + textBlock + footerBlock;

	canvas.height = height;
	canvas.style.aspectRatio = `${CARD_WIDTH} / ${height}`;

	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	// 底色 + 主题色光晕，和站内 OG 卡片一个调子
	const background = ctx.createLinearGradient(0, 0, CARD_WIDTH, height);
	background.addColorStop(0, "#17171a");
	background.addColorStop(1, "#08080a");
	ctx.fillStyle = background;
	ctx.fillRect(0, 0, CARD_WIDTH, height);

	const glow = ctx.createRadialGradient(
		CARD_WIDTH * 0.18,
		-60,
		0,
		CARD_WIDTH * 0.18,
		-60,
		CARD_WIDTH * 0.95,
	);
	glow.addColorStop(0, accentColor());
	glow.addColorStop(1, "rgba(0, 0, 0, 0)");
	ctx.save();
	ctx.globalAlpha = 0.22;
	ctx.fillStyle = glow;
	ctx.fillRect(0, 0, CARD_WIDTH, height);
	ctx.restore();

	const photoX = Math.round((CARD_WIDTH - photoWidth) / 2);
	const photoY = CARD_PADDING;
	const radius = 28;

	ctx.save();
	ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
	ctx.shadowBlur = 48;
	ctx.shadowOffsetY = 18;
	ctx.fillStyle = "#000";
	roundRectPath(ctx, photoX, photoY, photoWidth, photoHeight, radius);
	ctx.fill();
	ctx.restore();

	ctx.save();
	roundRectPath(ctx, photoX, photoY, photoWidth, photoHeight, radius);
	ctx.clip();
	ctx.drawImage(image, photoX, photoY, photoWidth, photoHeight);
	ctx.restore();

	ctx.save();
	roundRectPath(ctx, photoX, photoY, photoWidth, photoHeight, radius);
	ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
	ctx.lineWidth = 2;
	ctx.stroke();
	ctx.restore();

	if (lines.length > 0) {
		ctx.font = cardFont(CARD_TEXT_SIZE);
		ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
		ctx.textBaseline = "top";
		let y = photoY + photoHeight + 44;
		for (const line of lines) {
			ctx.fillText(line, CARD_PADDING, y);
			y += lineHeight;
		}
	}

	if (watermark) {
		const { title, url } = siteInfo();
		const baseY = height - CARD_PADDING + 6;
		ctx.textBaseline = "alphabetic";
		ctx.font = cardFont(30, 600);
		ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
		ctx.textAlign = "left";
		ctx.fillText(title, CARD_PADDING, baseY);
		ctx.font = cardFont(26, 400);
		ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
		ctx.textAlign = "right";
		ctx.fillText(url, CARD_WIDTH - CARD_PADDING, baseY);
		ctx.textAlign = "left";
	}
}

function renderCard() {
	const { canvas, text, textCount, watermark } = els();
	if (textCount) textCount.textContent = `${text?.value.length ?? 0} / 140`;
	if (!canvas || !cardImage) return;
	try {
		drawCard(canvas, cardImage, text?.value ?? "", watermark?.checked ?? true);
	} catch (error) {
		console.warn("分享卡片生成失败", error);
	}
}

/** 卡片要按原图比例排版，自己拉一份原图（一般已在缓存里） */
function loadCardImage(url: string) {
	const token = ++imageToken;
	cardImage = null;
	const href = absoluteUrl(url);
	// 跨域图带 crossOrigin 走一遍，能过 CORS 的话 canvas 就不会被污染
	const attempt = (crossOrigin: boolean) => {
		const image = new Image();
		image.decoding = "async";
		if (crossOrigin) image.crossOrigin = "anonymous";
		image.addEventListener(
			"load",
			() => {
				if (token !== imageToken) return;
				cardImage = image;
				renderCard();
			},
			{ once: true },
		);
		image.addEventListener(
			"error",
			() => {
				if (token !== imageToken) return;
				if (crossOrigin) {
					attempt(false);
					return;
				}
				showToast("图片加载失败，无法生成卡片");
			},
			{ once: true },
		);
		image.src = href;
	};
	attempt(!isSameOrigin(href));
}

export function canvasToFile(canvas: HTMLCanvasElement, filename: string) {
	return new Promise<File | null>((resolve) => {
		try {
			canvas.toBlob((blob) => {
				resolve(
					blob ? new File([blob], filename, { type: "image/png" }) : null,
				);
			}, "image/png");
		} catch {
			// 跨域图片会污染 canvas，读回时抛 SecurityError
			resolve(null);
		}
	});
}

export async function fetchAsFile(url: string, filename: string) {
	try {
		const response = await fetch(url, { cache: "force-cache" });
		if (!response.ok) return null;
		const blob = await response.blob();
		return new File([blob], filename, {
			type: blob.type || "application/octet-stream",
		});
	} catch {
		return null;
	}
}

/** 走系统分享面板；浏览器不支持就返回 false，由调用方兜底 */
export async function shareFile(file: File, text?: string) {
	if (typeof navigator.canShare !== "function") return false;
	if (!navigator.canShare({ files: [file] })) return false;
	try {
		await navigator.share(text ? { files: [file], text } : { files: [file] });
		return true;
	} catch (error) {
		// 用户自己取消了分享，不算失败，也不用再下载一份
		return (error as DOMException)?.name === "AbortError";
	}
}

async function shareOriginal() {
	if (!target) return;
	const url = absoluteUrl(target.url);
	const file = await fetchAsFile(url, target.filename);
	if (file && (await shareFile(file, target.filename))) return;
	await copyText(url, "浏览器不支持直接分享，已复制图片链接");
}

async function shareCard() {
	const { canvas, text } = els();
	if (!target || !canvas || !cardImage) {
		showToast("图片还没准备好，请稍后再试");
		return;
	}
	renderCard();
	const file = await canvasToFile(canvas, cardFileName(target.filename));
	if (!file) {
		showToast("卡片生成失败，可能是图片跨域受限");
		return;
	}
	if (await shareFile(file, text?.value.trim() || undefined)) return;
	downloadBlob(file, file.name);
	showToast("当前环境不支持直接分享，卡片已下载");
}

async function downloadCard() {
	const { canvas } = els();
	if (!target || !canvas || !cardImage) {
		showToast("图片还没准备好，请稍后再试");
		return;
	}
	renderCard();
	const file = await canvasToFile(canvas, cardFileName(target.filename));
	if (!file) {
		showToast("卡片生成失败，可能是图片跨域受限");
		return;
	}
	downloadBlob(file, file.name);
	showToast("卡片已下载");
}

function copyImageLink() {
	if (!target) return;
	void copyText(absoluteUrl(target.url), "图片链接已复制");
}

/* --------------------------------- 面板开关 --------------------------------- */

export function isShareSheetOpen() {
	const { panel } = els();
	return !!panel?.open;
}

export function openShareSheet(next: ShareTarget) {
	const { panel, text } = els();
	if (!panel) return;
	bindShareSheet();
	target = next;
	if (text) text.value = draftText;
	if (!panel.open) panel.showModal();
	panel.classList.remove("hidden");
	panel.classList.add("flex");
	loadCardImage(next.url);
}

export function closeShareSheet() {
	const { panel } = els();
	if (!panel) return;
	panel.classList.add("hidden");
	panel.classList.remove("flex");
	if (panel.open) panel.close();
	target = null;
	cardImage = null;
	// 在途的 onload 回来时别再画上一张图
	imageToken += 1;
}

function bindShareSheet() {
	if (bound) return;
	bound = true;
	const {
		panel,
		closeBtn,
		text,
		watermark,
		cardShareBtn,
		cardDownloadBtn,
		shareOriginalBtn,
		downloadOriginalBtn,
		copyLinkBtn,
	} = els();

	const closeHandler = () => closeShareSheet();
	const backdropHandler = (event: MouseEvent) => {
		if (event.target === panel) closeShareSheet();
	};
	const textHandler = () => {
		draftText = text?.value ?? "";
		clearTimeout(cardTimer);
		cardTimer = setTimeout(renderCard, 120);
	};
	const watermarkHandler = () => renderCard();
	const cardShareHandler = () => void shareCard();
	const cardDownloadHandler = () => void downloadCard();
	const shareOriginalHandler = () => void shareOriginal();
	const downloadOriginalHandler = () => {
		if (target) void downloadImage(target.url, target.filename);
	};
	const copyLinkHandler = () => copyImageLink();
	const closeSyncHandler = () => {
		panel?.classList.add("hidden");
		panel?.classList.remove("flex");
		target = null;
	};

	// 分享面板是 top layer 的 dialog，Esc 要抢在 Fancybox / 相册查看器之前处理
	registerShortcut({
		id: "image-share.escape",
		key: "Escape",
		when: isShareSheetOpen,
		whenLayerOpen: true,
		allowInEditable: true,
		priority: 400,
		stopPropagation: true,
		handler: closeShareSheet,
	});

	panel?.addEventListener("click", backdropHandler);
	panel?.addEventListener("close", closeSyncHandler);
	closeBtn?.addEventListener("click", closeHandler);
	text?.addEventListener("input", textHandler);
	watermark?.addEventListener("change", watermarkHandler);
	cardShareBtn?.addEventListener("click", cardShareHandler);
	cardDownloadBtn?.addEventListener("click", cardDownloadHandler);
	shareOriginalBtn?.addEventListener("click", shareOriginalHandler);
	downloadOriginalBtn?.addEventListener("click", downloadOriginalHandler);
	copyLinkBtn?.addEventListener("click", copyLinkHandler);
}
