type GalleryImage = {
	url: string;
	filename: string;
	year: string;
	month: string;
	day: string;
	date: string;
	yearMonth: string;
};

type MonthOption = { year: string; month: string; value: string };

/** 每页 60 张：5 列瀑布流刚好 12 行，首屏只下缩略图约 400KB */
const PAGE_SIZE = 60;
const FALLBACK_ASPECT_RATIO = 1.2;

const ORIGIN_PREFIX = "/api/i/";
const THUMB_PREFIX = "/api/i/_t/";
/** 与图床 generate-thumbs.js 支持的源格式保持一致，svg 等没有缩略图直接用原图 */
const THUMBABLE_EXTENSIONS = new Set([
	"jpg",
	"jpeg",
	"png",
	"webp",
	"gif",
	"avif",
	"bmp",
]);

let sortedImages: GalleryImage[] = [];
let filteredImages: GalleryImage[] = [];
let currentPage = 1;
let columns: HTMLDivElement[] = [];
let columnHeights: number[] = [];
let aspectRatioCache = new Map<string, number>();
let yearGroups: Record<string, MonthOption[]> = {};
let years: string[] = [];
let cleanups: (() => void)[] = [];
let mountId = 0;
let ready = false;

function byId<T extends HTMLElement>(id: string) {
	return document.getElementById(id) as T | null;
}

function getElements() {
	return {
		grid: byId<HTMLDivElement>("gallery-grid"),
		totalCount: byId<HTMLDivElement>("total-count"),
		emptyState: byId<HTMLDivElement>("empty-state"),
		initialLoading: byId<HTMLDivElement>("initial-loading"),
		lightbox: byId<HTMLDivElement>("lightbox"),
		lightboxImg: byId<HTMLImageElement>("lightbox-img"),
		lightboxCounter: byId<HTMLDivElement>("lightbox-counter"),
		lightboxInfo: byId<HTMLDivElement>("lightbox-info"),
		prevBtn: byId<HTMLButtonElement>("lightbox-prev"),
		nextBtn: byId<HTMLButtonElement>("lightbox-next"),
	};
}

/** 顶部和底部两条分页条，内容始终同步 */
function paginationElements() {
	return ["gallery-pagination-top", "gallery-pagination"]
		.map((id) => byId<HTMLDivElement>(id))
		.filter((el): el is HTMLDivElement => el !== null);
}

/**
 * 原图 -> 缩略图，纯按约定推导，省得给 images.json 加字段：
 *   /api/i/<年>/<月>/<日>/<name>.jpg -> /api/i/_t/<年>/<月>/<日>/<name>.webp
 * 推不出缩略图格式的（svg、老数据没回灌过）直接回原图，卡片里还有 onerror 兜底。
 */
function thumbUrlFor(url: string) {
	if (!url.startsWith(ORIGIN_PREFIX) || url.startsWith(THUMB_PREFIX))
		return url;
	const ext = url.split(".").pop()?.toLowerCase() ?? "";
	if (!THUMBABLE_EXTENSIONS.has(ext)) return url;
	return (
		THUMB_PREFIX + url.slice(ORIGIN_PREFIX.length).replace(/\.[^.]+$/, ".webp")
	);
}

function readPageFromUrl() {
	const raw = new URL(window.location.href).searchParams.get("page");
	const parsed = raw ? Number.parseInt(raw, 10) : 1;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function writePageToUrl(page: number) {
	const url = new URL(window.location.href);
	if (page <= 1) url.searchParams.delete("page");
	else url.searchParams.set("page", String(page));
	// 用 replaceState：可分享、刷新后还在本页，但不会往 swup 的历史栈里塞条目
	history.replaceState(history.state, "", url.toString());
}

async function loadImagesData(): Promise<GalleryImage[]> {
	try {
		const response = await fetch("/api/i/images.json");
		if (!response.ok) {
			throw new Error(`Failed to load images data: ${response.status}`);
		}
		const data = (await response.json()) as Omit<GalleryImage, "yearMonth">[];

		sortedImages = data
			.map((item) => ({
				...item,
				yearMonth: `${item.year}-${item.month.padStart(2, "0")}`,
			}))
			.sort((a, b) => b.date.localeCompare(a.date));

		const yearMonths = [
			...new Set(sortedImages.map((img) => img.yearMonth)),
		].sort((a, b) => b.localeCompare(a));

		yearGroups = {};
		for (const ym of yearMonths) {
			const [year = "", month = ""] = ym.split("-");
			if (!yearGroups[year]) yearGroups[year] = [];
			yearGroups[year].push({ year, month, value: ym });
		}
		years = Object.keys(yearGroups).sort((a, b) => b.localeCompare(a));

		return sortedImages;
	} catch (error) {
		console.error("Error loading images data:", error);
		const { initialLoading } = getElements();
		if (initialLoading) {
			initialLoading.innerHTML =
				'<p class="text-red-500">加载失败，请刷新页面重试</p>';
		}
		return [];
	}
}

function renderFilterButtons() {
	const container = document.getElementById("filter-container");
	if (!container) return;

	let html = `
      <button
        id="filter-all"
        class="filter-btn active px-3 py-1.5 rounded-lg text-sm font-medium transition-all
               bg-[var(--primary)] text-white dark:text-black/70
               hover:opacity-90"
        data-filter="all"
      >
        全部
      </button>
    `;

	for (const year of years) {
		html += `
        <div class="flex gap-1 items-center">
          <button
            class="filter-btn year-btn px-3 py-1.5 rounded-lg text-sm font-medium transition-all
                   bg-black/5 dark:bg-white/5 text-75 hover:bg-black/10 dark:hover:bg-white/10"
            data-filter="${year}"
          >
            ${year}年
          </button>
          <div class="month-pills hidden flex-wrap gap-1">
      `;

		for (const { month, value } of yearGroups[year]) {
			html += `
          <button
            class="filter-btn month-btn px-2 py-1 rounded text-xs transition-all
                   bg-black/5 dark:bg-white/5 text-50 hover:bg-black/10 dark:hover:bg-white/10"
            data-filter="${value}"
            data-year="${year}"
          >
            ${Number.parseInt(month)}月
          </button>
        `;
		}

		html += `
          </div>
        </div>
      `;
	}

	container.innerHTML = html;
}

function getColumnCount() {
	const width = window.innerWidth;
	if (width < 640) return 2;
	if (width < 768) return 3;
	if (width < 1024) return 4;
	return 5;
}

function getTotalPages() {
	return Math.max(1, Math.ceil(filteredImages.length / PAGE_SIZE));
}

function clampPage(page: number) {
	const total = getTotalPages();
	if (page < 1) return 1;
	if (page > total) return total;
	return page;
}

function pageStart(page: number) {
	return (page - 1) * PAGE_SIZE;
}

function pageImages(page: number) {
	const start = pageStart(page);
	return filteredImages.slice(start, start + PAGE_SIZE);
}

function initGrid() {
	const { grid, emptyState } = getElements();
	if (!grid) return;

	currentPage = clampPage(currentPage);

	if (filteredImages.length === 0) {
		emptyState?.classList.remove("hidden");
		grid.classList.add("hidden");
		for (const el of paginationElements()) el.classList.add("hidden");
		return;
	}

	emptyState?.classList.add("hidden");
	grid.classList.remove("hidden");

	const colCount = getColumnCount();
	grid.innerHTML = "";
	columns = [];
	columnHeights = new Array(colCount).fill(0);

	for (let i = 0; i < colCount; i++) {
		const col = document.createElement("div");
		col.className = "flex flex-col gap-3 flex-1 min-w-0";
		grid.appendChild(col);
		columns.push(col);
	}

	// 只渲染当前页：以前是无限滚动追加，翻到底 DOM 里挂着几千张图，越滚越卡
	const start = pageStart(currentPage);
	for (const [offset, imageData] of pageImages(currentPage).entries()) {
		const index = start + offset;
		const colIndex = getShortestColumn();
		columns[colIndex]?.appendChild(createCard(imageData, index));
		const ratio = aspectRatioCache.get(imageData.url) ?? FALLBACK_ASPECT_RATIO;
		columnHeights[colIndex] = (columnHeights[colIndex] ?? 0) + ratio * 100 + 12;
	}

	requestAnimationFrame(() => {
		grid.classList.remove("opacity-0");
	});

	renderPagination();
	updateTotalCount();
}

function createCard(imageData: GalleryImage, index: number) {
	const { url, year, month } = imageData;
	const div = document.createElement("div");
	div.className =
		"gallery-item relative rounded-lg overflow-hidden cursor-zoom-in group/img bg-black/5 dark:bg-white/5";
	div.dataset.index = String(index);

	// 先用缓存/兜底比例占位，图片到位后再换成真实比例，避免加载时整页跳动
	const estimatedRatio = aspectRatioCache.get(url) ?? FALLBACK_ASPECT_RATIO;
	div.style.aspectRatio = `1 / ${estimatedRatio}`;

	const dateLabel = `${year}年${Number.parseInt(month)}月`;
	const thumb = thumbUrlFor(url);

	div.innerHTML = `
      <div class="loading-bar absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-16 h-1 bg-black/10 dark:bg-white/10 z-10 rounded-full overflow-hidden">
        <div class="loading-progress h-full w-8 bg-[var(--primary)] animate-loading-progress rounded-full"></div>
      </div>
      <img
        src="${thumb}"
        data-original="${url}"
        loading="lazy"
        decoding="async"
        class="w-full h-full object-cover opacity-0 transition-all duration-500 group-hover/img:scale-105"
        alt="Gallery Image"
      />
      <div class="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-all duration-300 flex items-center justify-center opacity-0 group-hover/img:opacity-100">
        <div class="absolute bottom-2 right-2 text-white/90 text-xs font-bold px-2 py-1 bg-black/50 rounded backdrop-blur-sm">
            ${dateLabel}
        </div>
      </div>
    `;

	const img = div.querySelector<HTMLImageElement>("img");
	const loadingBar = div.querySelector<HTMLElement>(".loading-bar");

	if (img) {
		const settle = () => {
			img.style.opacity = "1";
			loadingBar?.style.setProperty("opacity", "0");
			if (img.naturalWidth > 0 && img.naturalHeight > 0) {
				const ratio = img.naturalHeight / img.naturalWidth;
				aspectRatioCache.set(url, ratio);
				div.style.aspectRatio = `1 / ${ratio}`;
			}
		};
		img.addEventListener("load", settle);
		img.addEventListener("error", () => {
			// 缩略图缺失（回灌之前的老图、或图床端临时故障）退回原图，只退一次
			if (img.dataset.fallen !== "1" && img.src !== url) {
				img.dataset.fallen = "1";
				img.src = url;
				return;
			}
			loadingBar?.style.setProperty("opacity", "0");
			img.style.opacity = "0.25";
		});
		if (img.complete && img.naturalWidth > 0) settle();
	}

	div.addEventListener("click", () => openLightbox(index));

	return div;
}

function getShortestColumn() {
	let minHeight = columnHeights[0] ?? 0;
	let minIndex = 0;
	for (let i = 1; i < columnHeights.length; i++) {
		const height = columnHeights[i] ?? 0;
		if (height < minHeight) {
			minHeight = height;
			minIndex = i;
		}
	}
	return minIndex;
}

const CHEVRON_LEFT =
	'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
const CHEVRON_RIGHT =
	'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

/** 与 Pagination.astro 同一套窗口算法：首页、尾页、当前页 ±adj，中间省略号 */
function buildPageList(current: number, total: number, adj = 2) {
	const HIDDEN = -1;
	const VISIBLE = adj * 2 + 1;
	let l = current;
	let r = current;
	let count = 1;
	while (0 < l - 1 && r + 1 <= total && count + 2 <= VISIBLE) {
		count += 2;
		l--;
		r++;
	}
	while (0 < l - 1 && count < VISIBLE) {
		count++;
		l--;
	}
	while (r + 1 <= total && count < VISIBLE) {
		count++;
		r++;
	}

	const pages: number[] = [];
	if (l > 1) pages.push(1);
	if (l === 3) pages.push(2);
	if (l > 3) pages.push(HIDDEN);
	for (let i = l; i <= r; i++) pages.push(i);
	if (r < total - 2) pages.push(HIDDEN);
	if (r === total - 2) pages.push(total - 1);
	if (r < total) pages.push(total);
	return pages;
}

function renderPagination() {
	const els = paginationElements();
	const total = getTotalPages();

	if (filteredImages.length <= PAGE_SIZE) {
		for (const el of els) {
			el.classList.add("hidden");
			el.innerHTML = "";
		}
		return;
	}

	// 窄屏只留当前页左右各 1 个页码，按钮也缩一号，否则 « 1 2 3 4 5 … 67 » 会顶出屏幕
	const narrow = window.innerWidth < 640;
	const box = narrow ? "w-9 h-9" : "w-11 h-11";
	const dots = narrow ? "w-4" : "w-6";

	const arrowClass = `page-btn btn-card overflow-hidden rounded-lg text-[var(--primary)] ${box} flex items-center justify-center disabled:opacity-40 disabled:pointer-events-none transition active:scale-[0.85]`;
	const linkClass = `page-btn transition flex items-center justify-center ${box} rounded-lg overflow-hidden active:scale-[0.85] hover:bg-[var(--btn-card-bg-hover)] active:bg-[var(--btn-card-bg-active)] text-black/75 dark:text-white/75`;

	let numbers = "";
	for (const p of buildPageList(currentPage, total, narrow ? 1 : 2)) {
		if (p === -1) {
			numbers += `<span class="mx-1 flex items-center justify-center ${dots} text-50 select-none">···</span>`;
		} else if (p === currentPage) {
			numbers += `<span class="${box} rounded-lg bg-[var(--primary)] flex items-center justify-center font-bold text-white dark:text-black/70">${p}</span>`;
		} else {
			numbers += `<button type="button" class="${linkClass}" data-page="${p}" aria-label="第 ${p} 页">${p}</button>`;
		}
	}

	const html = `
      <button type="button" class="${arrowClass}" data-page="${currentPage - 1}" aria-label="上一页" ${currentPage <= 1 ? "disabled" : ""}>${CHEVRON_LEFT}</button>
      <div class="bg-[var(--card-bg)] flex flex-row rounded-lg items-center text-neutral-700 dark:text-neutral-300 font-bold">
        ${numbers}
      </div>
      <button type="button" class="${arrowClass}" data-page="${currentPage + 1}" aria-label="下一页" ${currentPage >= total ? "disabled" : ""}>${CHEVRON_RIGHT}</button>
    `;

	for (const el of els) {
		el.innerHTML = html;
		el.classList.remove("hidden");
	}
}

function updateTotalCount() {
	const { totalCount } = getElements();
	if (!totalCount) return;
	const total = getTotalPages();
	totalCount.textContent =
		filteredImages.length === 0
			? "暂无图片"
			: `共 ${filteredImages.length} 张图片 · 第 ${currentPage} / ${total} 页`;
}

function goToPage(page: number, options: { scroll?: boolean } = {}) {
	const next = clampPage(page);
	const changed = next !== currentPage;
	currentPage = next;
	writePageToUrl(next);

	if (changed) initGrid();
	else renderPagination();

	if (options.scroll !== false) scrollToGrid();
}

function scrollToGrid() {
	const { grid } = getElements();
	if (!grid) return;
	const top = grid.getBoundingClientRect().top + window.scrollY - 24;
	window.scrollTo({ top: top > 0 ? top : 0, behavior: "smooth" });
}

function applyFilter(filter: string) {
	if (filter === "all") {
		filteredImages = [...sortedImages];
	} else if (filter.includes("-")) {
		filteredImages = sortedImages.filter((img) => img.yearMonth === filter);
	} else {
		filteredImages = sortedImages.filter((img) => img.year === filter);
	}

	currentPage = 1;
	writePageToUrl(1);
	initGrid();
}

function hideAllMonthPills() {
	for (const pills of document.querySelectorAll(".month-pills")) {
		pills.classList.remove("show");
	}
}

function initFilterButtons() {
	const filterButtons =
		document.querySelectorAll<HTMLButtonElement>(".filter-btn");

	for (const btn of filterButtons) {
		btn.addEventListener("click", () => {
			const filter = btn.dataset.filter;
			if (!filter) return;

			for (const other of filterButtons) other.classList.remove("active");
			btn.classList.add("active");

			if (btn.classList.contains("year-btn")) {
				const monthPills = btn.nextElementSibling;
				const isShowing = monthPills?.classList.contains("show");
				hideAllMonthPills();
				if (!isShowing && monthPills) monthPills.classList.add("show");
			} else if (btn.classList.contains("month-btn")) {
				const year = btn.dataset.year;
				hideAllMonthPills();
				const yearBtn = year
					? document.querySelector<HTMLButtonElement>(
							`[data-filter="${year}"]:not(.month-btn)`,
						)
					: null;
				yearBtn?.nextElementSibling?.classList.add("show");
			} else {
				hideAllMonthPills();
			}

			applyFilter(filter);
		});
	}
}

function initPaginationEvents() {
	const handler = (event: MouseEvent) => {
		const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
			"[data-page]",
		);
		if (!target || target.hasAttribute("disabled")) return;
		const page = Number.parseInt(target.dataset.page ?? "1", 10);
		if (!Number.isFinite(page)) return;
		goToPage(page);
	};

	for (const el of paginationElements()) {
		el.addEventListener("click", handler);
		cleanups.push(() => el.removeEventListener("click", handler));
	}
}

let lightboxIndex = 0;

function openLightbox(index: number) {
	const els = getElements();
	const imageData = filteredImages[index];
	if (!els.lightbox || !els.lightboxImg || !imageData) return;

	// 从预览里翻到别的页时，背后的网格跟着翻页，关掉后停在那一页
	const page = clampPage(Math.floor(index / PAGE_SIZE) + 1);
	if (page !== currentPage) {
		currentPage = page;
		writePageToUrl(page);
		initGrid();
	}

	lightboxIndex = index;
	// 预览必须是原图，缩略图只负责网格
	els.lightboxImg.src = imageData.url;
	els.lightboxImg.dataset.original = imageData.url;
	if (els.lightboxCounter) {
		els.lightboxCounter.textContent = `${index + 1} / ${filteredImages.length}`;
	}
	if (els.lightboxInfo) {
		els.lightboxInfo.textContent = `${imageData.year}/${imageData.month}/${imageData.day}/${imageData.filename}`;
	}

	els.lightbox.classList.remove("hidden");
	els.lightbox.classList.add("flex");

	if (els.prevBtn) els.prevBtn.disabled = index === 0;
	if (els.nextBtn) els.nextBtn.disabled = index === filteredImages.length - 1;

	document.body.style.overflow = "hidden";
}

function closeLightbox() {
	const { lightbox } = getElements();
	if (!lightbox) return;
	lightbox.classList.add("hidden");
	lightbox.classList.remove("flex");
	document.body.style.overflow = "";
}

function showPrev() {
	if (lightboxIndex > 0) openLightbox(lightboxIndex - 1);
}

function showNext() {
	if (lightboxIndex < filteredImages.length - 1)
		openLightbox(lightboxIndex + 1);
}

function initLightboxEvents() {
	const closeHandler = () => closeLightbox();
	const prevHandler = () => showPrev();
	const nextHandler = () => showNext();
	const keyHandler = (event: KeyboardEvent) => {
		const { lightbox } = getElements();
		if (!lightbox || lightbox.classList.contains("hidden")) return;
		if (event.key === "Escape") closeLightbox();
		if (event.key === "ArrowLeft") showPrev();
		if (event.key === "ArrowRight") showNext();
	};
	const bgClickHandler = (event: MouseEvent) => {
		if (event.target === event.currentTarget) closeLightbox();
	};

	const closeBtn = document.getElementById("lightbox-close");
	const prevBtn = document.getElementById("lightbox-prev");
	const nextBtn = document.getElementById("lightbox-next");
	const lightbox = document.getElementById("lightbox");

	closeBtn?.addEventListener("click", closeHandler);
	prevBtn?.addEventListener("click", prevHandler);
	nextBtn?.addEventListener("click", nextHandler);
	lightbox?.addEventListener("click", bgClickHandler);
	document.addEventListener("keydown", keyHandler);

	cleanups.push(() => {
		closeBtn?.removeEventListener("click", closeHandler);
		prevBtn?.removeEventListener("click", prevHandler);
		nextBtn?.removeEventListener("click", nextHandler);
		lightbox?.removeEventListener("click", bgClickHandler);
		document.removeEventListener("keydown", keyHandler);
	});
}

async function initGallery(id: number) {
	const { initialLoading } = getElements();

	await loadImagesData();
	if (id !== mountId) return;

	filteredImages = [...sortedImages];
	currentPage = clampPage(readPageFromUrl());

	initialLoading?.classList.add("hidden");

	renderFilterButtons();
	initGrid();
	initLightboxEvents();
	initFilterButtons();
	initPaginationEvents();

	ready = true;
}

function teardown() {
	for (const fn of cleanups) fn();
	cleanups = [];
	sortedImages = [];
	filteredImages = [];
	currentPage = 1;
	lightboxIndex = 0;
	columns = [];
	columnHeights = [];
	aspectRatioCache = new Map();
	yearGroups = {};
	years = [];
	ready = false;
	document.body.style.overflow = "";
}

export function mountGalleryPage() {
	if (!document.getElementById("gallery-grid")) return;
	teardown();
	mountId += 1;
	void initGallery(mountId);
}

let resizeTimer: ReturnType<typeof setTimeout> | undefined;
window.addEventListener("resize", () => {
	if (!ready || !document.getElementById("gallery-grid")) return;
	clearTimeout(resizeTimer);
	resizeTimer = setTimeout(() => {
		if (ready && document.getElementById("gallery-grid")) initGrid();
	}, 200);
});
