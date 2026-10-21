import {
	MIN_READING_PROGRESS,
	READING_HISTORY_EVENT,
	READ_LATER_EVENT,
	type ReadLaterItem,
	type ReadingRecord,
	getLastUnfinishedRecord,
	getReadLaterList,
	getReadingHistory,
	isInReadLater,
	removeFromReadLater,
	saveReadingProgress,
	toggleReadLater,
} from "../utils/reading-utils";

/**
 * 阅读进度的客户端逻辑：
 * - 文章页滚动时把进度写进 localStorage
 * - 侧栏 / 首页的「继续阅读 + 稍后读」面板
 * - 从「继续阅读」进入时恢复上次的滚动位置
 *
 * 侧栏在 Swup 容器之外，只会挂载一次；首页和文章页在容器内，
 * 每次 page:view 都要重新挂载，所以这里的所有绑定都做了幂等处理。
 */

const ICON_CLOCK =
	'<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const ICON_BOOKMARK =
	'<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/></svg>';
const ICON_ARROW =
	'<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const ICON_CLOSE =
	'<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

/** 进度写盘的最小间隔，滚动时不要把 localStorage 写爆。 */
const SAVE_INTERVAL = 800;

interface ReadingTracker {
	flush: () => void;
	destroy: () => void;
}

let tracker: ReadingTracker | null = null;
let bound = false;
let resumedKey = "";

function icon(inner: string, className: string): HTMLSpanElement {
	const span = document.createElement("span");
	span.className = className;
	span.innerHTML = inner;
	return span;
}

function make<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text !== undefined) element.textContent = text;
	return element;
}

function percent(progress: number): string {
	return `${Math.round(progress * 100)}%`;
}

function seriesLabel(record: {
	series: string;
	chapterIndex: number;
	chapterTotal: number;
}): string {
	if (!record.series) return "";
	const chapter =
		record.chapterIndex > 0 && record.chapterTotal > 0
			? ` · 第 ${record.chapterIndex}/${record.chapterTotal} 章`
			: "";
	return `${record.series}${chapter}`;
}

function progressBar(progress: number, className?: string): HTMLDivElement {
	const outer = make(
		"div",
		`h-1.5 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10${
			className ? ` ${className}` : ""
		}`,
	);
	outer.setAttribute("role", "progressbar");
	outer.setAttribute("aria-valuemin", "0");
	outer.setAttribute("aria-valuemax", "100");
	outer.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
	const inner = make(
		"div",
		"h-full rounded-full bg-[var(--primary)] transition-all duration-500",
	);
	inner.style.width = percent(progress);
	outer.appendChild(inner);
	return outer;
}

function resumeUrl(url: string): string {
	try {
		const target = new URL(url, location.origin);
		target.searchParams.set("resume", "1");
		return `${target.pathname}${target.search}${target.hash}`;
	} catch {
		return url;
	}
}

function continueLink(record: ReadingRecord, variant: "sidebar" | "home") {
	const link = make(
		"a",
		"block group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]",
	);
	link.href = resumeUrl(record.url);

	const row = make("div", "flex items-center justify-between gap-3");
	const text = make("div", "min-w-0 flex-1");

	const title = make(
		"div",
		variant === "home"
			? "truncate font-bold text-base md:text-lg text-90 transition group-hover:text-[var(--primary)]"
			: "line-clamp-2 text-sm font-bold text-90 transition group-hover:text-[var(--primary)]",
		record.title,
	);
	text.appendChild(title);

	const meta = make("div", "mt-1 flex items-center gap-2 text-xs text-30");
	const series = seriesLabel(record);
	if (series) {
		meta.appendChild(make("span", "truncate", series));
		meta.appendChild(make("span", "shrink-0", "·"));
	}
	const progressLabel = make(
		"span",
		"shrink-0",
		`已读 ${percent(record.progress)}`,
	);
	progressLabel.dataset.continuePercent = "";
	meta.appendChild(progressLabel);
	text.appendChild(meta);

	row.appendChild(text);
	const arrow = icon(
		ICON_ARROW,
		"shrink-0 text-black/25 transition group-hover:translate-x-0.5 group-hover:text-[var(--primary)] dark:text-white/25",
	);
	row.appendChild(arrow);

	link.appendChild(row);

	const bar = progressBar(record.progress, "mt-2.5");
	const barInner = bar.firstElementChild as HTMLElement | null;
	if (barInner) barInner.dataset.continueBar = "";
	link.appendChild(bar);
	return link;
}

/** 滚动进度只更新进度条和百分比，不重建整张卡片（避免入场动画重播）。 */
function updateShelfProgress(
	root: HTMLElement,
	record: ReadingRecord | null,
): void {
	if (!record) return;
	const bar = root.querySelector<HTMLElement>("[data-continue-bar]");
	const label = root.querySelector<HTMLElement>("[data-continue-percent]");
	const track = bar?.parentElement;
	const value = percent(record.progress);
	if (bar) bar.style.width = value;
	if (label) label.textContent = `已读 ${value}`;
	track?.setAttribute(
		"aria-valuenow",
		String(Math.round(record.progress * 100)),
	);
}

function readLaterList(
	items: ReadLaterItem[],
	variant: "sidebar" | "home",
	withDivider: boolean,
): HTMLDivElement {
	const wrapper = make(
		"div",
		withDivider ? "mt-4 border-t border-[var(--line-divider)] pt-3" : "",
	);
	const head = make("div", "mb-2 flex items-center justify-between");
	const headLeft = make("div", "flex items-center gap-2");
	headLeft.appendChild(icon(ICON_BOOKMARK, "h-4 w-4 text-[var(--primary)]"));
	headLeft.appendChild(make("h3", "text-sm font-bold text-75", "稍后读"));
	head.appendChild(headLeft);
	head.appendChild(make("span", "text-xs text-30", `${items.length} 篇`));
	wrapper.appendChild(head);

	const list = make(
		"ul",
		variant === "home"
			? "grid gap-1 gap-x-6 md:grid-cols-2"
			: "flex flex-col gap-1",
	);
	for (const item of items) {
		const li = make("li", "group/item flex items-start gap-1");
		const link = make(
			"a",
			"min-w-0 flex-1 truncate rounded-md py-1 text-xs text-50 transition hover:text-[var(--primary)]",
			item.title,
		);
		link.href = item.url;
		link.title = item.title;
		li.appendChild(link);

		const remove = make(
			"button",
			"mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-black/20 transition hover:bg-[var(--btn-plain-bg-hover)] hover:text-[var(--primary)] dark:text-white/20",
		);
		remove.type = "button";
		remove.dataset.removeReadLater = item.slug;
		remove.setAttribute("aria-label", `移出稍后读：${item.title}`);
		remove.innerHTML = ICON_CLOSE;
		li.appendChild(remove);

		list.appendChild(li);
	}
	wrapper.appendChild(list);
	return wrapper;
}

/** 每个面板上次渲染用的数据指纹，避免滚动写进度时整块重建（会重播卡片入场动画）。 */
const renderedSignature = new WeakMap<HTMLElement, string>();

function renderShelf(root: HTMLElement): void {
	const variant = root.dataset.readingShelf === "home" ? "home" : "sidebar";

	// 首页主栏已经有「继续阅读」卡片，侧栏不再重复一份
	if (
		variant === "sidebar" &&
		document.querySelector('[data-reading-shelf="home"]')
	) {
		root.replaceChildren();
		root.classList.add("hidden");
		renderedSignature.delete(root);
		return;
	}

	// 正文页的侧栏不给自己推荐自己
	const currentSlug =
		document.getElementById("post-container")?.dataset.postSlug;
	const record = getLastUnfinishedRecord(currentSlug);
	const readLater = getReadLaterList();

	// 进度变化单独走 updateShelfProgress，所以指纹里不放 progress；
	// currentSlug 决定要不要排除当前文章，切页后可能变，得算进指纹
	const signature = JSON.stringify([
		variant,
		currentSlug ?? "",
		record
			? [record.slug, record.title, record.url, seriesLabel(record)]
			: null,
		readLater.map((item) => [item.slug, item.title]),
	]);
	if (renderedSignature.get(root) === signature) {
		updateShelfProgress(root, record);
		return;
	}
	renderedSignature.set(root, signature);

	root.replaceChildren();
	if (!record && readLater.length === 0) {
		root.classList.add("hidden");
		return;
	}
	root.classList.remove("hidden");

	const card = make(
		"div",
		variant === "home"
			? "card-base border border-black/10 px-6 py-5 dark:border-white/10 md:px-8"
			: "card-base px-5 py-4",
	);

	const head = make(
		"div",
		variant === "home"
			? "mb-3 flex items-center justify-between"
			: "mb-3 flex items-center gap-2",
	);
	const headLeft = make("div", "flex items-center gap-2");
	headLeft.appendChild(icon(ICON_CLOCK, "h-5 w-5 text-[var(--primary)]"));
	headLeft.appendChild(make("h2", "text-lg font-bold text-90", "继续阅读"));
	head.appendChild(headLeft);
	if (variant === "home") {
		head.appendChild(make("span", "text-xs text-30", "阅读记录保存在本地"));
	}
	card.appendChild(head);

	if (record) {
		card.appendChild(continueLink(record, variant));
	} else if (readLater.length === 0) {
		card.appendChild(
			make(
				"p",
				"py-1 text-xs text-30",
				"读过的文章会出现在这里，随时接着上次的进度继续。",
			),
		);
	}

	if (readLater.length > 0) {
		card.appendChild(readLaterList(readLater, variant, !!record));
	}

	root.appendChild(card);
}

function renderShelves(): void {
	for (const root of document.querySelectorAll<HTMLElement>(
		"[data-reading-shelf]",
	)) {
		renderShelf(root);
	}
}

function updateReadLaterButtons(): void {
	for (const button of document.querySelectorAll<HTMLButtonElement>(
		"[data-read-later-btn]",
	)) {
		const slug = button.dataset.slug;
		if (!slug) continue;
		const active = isInReadLater(slug);
		button.setAttribute("aria-pressed", String(active));
		button.classList.toggle("text-[var(--primary)]", active);
		button.querySelector(".rl-add")?.classList.toggle("hidden", active);
		button.querySelector(".rl-added")?.classList.toggle("hidden", !active);
		const label = button.querySelector(".rl-label");
		if (label) label.textContent = active ? "已加入稍后读" : "稍后读";
	}
}

function handleDocumentClick(event: MouseEvent): void {
	const target = event.target as Element | null;
	if (!target) return;

	const removeButton = target.closest<HTMLElement>("[data-remove-read-later]");
	if (removeButton?.dataset.removeReadLater) {
		event.preventDefault();
		removeFromReadLater(removeButton.dataset.removeReadLater);
		return;
	}

	const laterButton = target.closest<HTMLElement>("[data-read-later-btn]");
	if (!laterButton) return;
	const slug = laterButton.dataset.slug;
	if (!slug) return;
	event.preventDefault();
	toggleReadLater({
		slug,
		title: laterButton.dataset.title || slug,
		url: laterButton.dataset.url || `/posts/${slug}/`,
		series: laterButton.dataset.series || "",
	});
}

function bindGlobal(): void {
	if (bound) return;
	bound = true;

	const refresh = () => {
		renderShelves();
		updateReadLaterButtons();
	};

	window.addEventListener(READING_HISTORY_EVENT, refresh);
	window.addEventListener(READ_LATER_EVENT, refresh);
	window.addEventListener("storage", refresh);
	document.addEventListener("click", handleDocumentClick);

	// 离开页面前把当前进度落盘（Swup 切页、关闭标签页都会走到）
	const flush = () => tracker?.flush();
	const bindSwup = () => {
		window.swup?.hooks?.on("visit:start", flush);
	};
	if (window.swup) {
		bindSwup();
	} else {
		document.addEventListener("swup:enable", bindSwup, { once: true });
	}
	window.addEventListener("pagehide", flush);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") flush();
	});
}

/** 文章页滚动进度记录，切页时替换掉上一个页面的 tracker。 */
function syncTracker(): void {
	if (tracker) {
		tracker.flush();
		tracker.destroy();
		tracker = null;
	}

	const container = document.getElementById("post-container");
	const slug = container?.dataset.postSlug;
	if (!container || !slug) return;

	const title = container.dataset.postTitle || slug;
	const series = container.dataset.postSeries || "";
	const chapterIndex = Number(container.dataset.postChapter) || 0;
	const chapterTotal = Number(container.dataset.postChapterTotal) || 0;
	// 记下当前路径：Swup 切页后 location 会先变，落盘时不能跟着变
	const recordUrl = location.pathname;

	let lastSavedAt = 0;
	let frame = 0;
	let lastProgress = 0;

	const measure = (): number | null => {
		// 切页后旧容器已从文档里摘掉，getBoundingClientRect 全是 0，
		// 硬算会把进度误判成 100%，所以这里直接放弃这次采样。
		if (!container.isConnected) return null;
		const rect = container.getBoundingClientRect();
		const top = rect.top + window.scrollY;
		const height = Math.max(rect.height, 1);
		const viewed = window.scrollY + window.innerHeight - top;
		return Math.min(1, Math.max(0, viewed / height));
	};

	const save = (force = false) => {
		const progress = measure();
		if (progress === null) return;
		lastProgress = progress;
		if (lastProgress <= MIN_READING_PROGRESS) return;
		const now = Date.now();
		if (!force && now - lastSavedAt < SAVE_INTERVAL) return;
		lastSavedAt = now;
		saveReadingProgress({
			slug,
			title,
			url: recordUrl,
			progress: lastProgress,
			series,
			chapterIndex,
			chapterTotal,
		});
	};

	const onScroll = () => {
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			save();
		});
	};

	window.addEventListener("scroll", onScroll, { passive: true });

	tracker = {
		flush: () => save(true),
		destroy: () => {
			window.removeEventListener("scroll", onScroll);
			if (frame) cancelAnimationFrame(frame);
		},
	};
}

/** 从「继续阅读」进来时，恢复到上次的滚动位置。 */
function resumeIfRequested(): void {
	const params = new URLSearchParams(location.search);
	if (params.get("resume") !== "1") {
		// 离开过带 resume 的页面后，下次再点「继续阅读」要能重新定位
		resumedKey = "";
		return;
	}

	const container = document.getElementById("post-container");
	const slug = container?.dataset.postSlug;
	if (!container || !slug || resumedKey === slug) return;

	const record = getReadingHistory().find((item) => item.slug === slug);
	if (!record || record.progress <= MIN_READING_PROGRESS) return;
	resumedKey = slug;

	const scrollToRecord = (): boolean => {
		const current = document.getElementById("post-container");
		if (!current || current.dataset.postSlug !== slug) return false;
		const rect = current.getBoundingClientRect();
		const top = rect.top + window.scrollY;
		const target = Math.max(
			0,
			top + record.progress * rect.height - window.innerHeight,
		);
		window.scrollTo({ top: target, behavior: "auto" });
		return true;
	};

	// 去掉 resume 参数，刷新时不再重复定位
	const cleanUrl = () => {
		const clean = new URL(location.href);
		clean.searchParams.delete("resume");
		history.replaceState(history.state, "", clean.toString());
	};

	// 等 Swup 的滚动插件先跳回顶部；图片还没加载完时布局会变，等 load 再校正一次
	window.setTimeout(() => {
		if (!scrollToRecord()) return;
		cleanUrl();
		showResumeToast();
		if (document.readyState !== "complete") {
			window.addEventListener(
				"load",
				() => {
					scrollToRecord();
				},
				{ once: true },
			);
		}
	}, 400);
}

function showResumeToast(): void {
	const toast = make(
		"div",
		"fixed bottom-24 left-1/2 z-[100] -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-xs text-white shadow-lg backdrop-blur transition-opacity duration-500 dark:bg-white/15",
		"已恢复到上次阅读的位置",
	);
	toast.setAttribute("role", "status");
	document.body.appendChild(toast);
	window.setTimeout(() => {
		toast.classList.add("opacity-0");
		window.setTimeout(() => toast.remove(), 500);
	}, 2200);
}

/** Swup 每次完成页面切换、以及首次加载时调用。 */
export function mountReadingWidgets(): void {
	bindGlobal();
	renderShelves();
	updateReadLaterButtons();
	syncTracker();
	resumeIfRequested();
}
