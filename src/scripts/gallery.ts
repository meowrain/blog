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

const BATCH_SIZE = 20;
const ESTIMATED_COLUMN_WIDTH = 300;
const FALLBACK_ASPECT_RATIO = 1.2;

let sortedImages: GalleryImage[] = [];
let filteredImages: GalleryImage[] = [];
let currentIndex = 0;
let lightboxIndex = 0;
let columns: HTMLDivElement[] = [];
let columnHeights: number[] = [];
let observer: IntersectionObserver | undefined;
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
		sentinel: byId<HTMLDivElement>("loading-sentinel"),
		endMessage: byId<HTMLDivElement>("end-message"),
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

function initGrid() {
	const { grid, sentinel, emptyState } = getElements();
	if (!grid) return;

	if (filteredImages.length === 0) {
		emptyState?.classList.remove("hidden");
		grid.classList.add("hidden");
		sentinel?.classList.add("hidden");
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

	currentIndex = 0;
	loadMore();

	requestAnimationFrame(() => {
		grid.classList.remove("opacity-0");
	});

	sentinel?.classList.remove("hidden");

	observer?.disconnect();
	observer = new IntersectionObserver(
		(entries) => {
			if (entries[0]?.isIntersecting) loadMore();
		},
		{ rootMargin: "400px" },
	);
	if (sentinel) observer.observe(sentinel);
}

function createCard(imageData: GalleryImage, index: number, isInitial = false) {
	const { url, year, month } = imageData;
	const div = document.createElement("div");
	div.className =
		"gallery-item relative rounded-lg overflow-hidden cursor-zoom-in group/img bg-black/5 dark:bg-white/5";
	div.dataset.index = String(index);

	const dateLabel = `${year}年${Number.parseInt(month)}月`;

	div.innerHTML = `
      <div class="loading-bar absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-16 h-1 bg-black/10 dark:bg-white/10 z-10 rounded-full overflow-hidden">
        <div class="loading-progress h-full w-8 bg-[var(--primary)] animate-loading-progress rounded-full"></div>
      </div>
      <img
        src="${url}"
        ${isInitial ? "" : 'loading="lazy"'}
        class="w-full h-auto object-cover opacity-0 transition-all duration-500 group-hover/img:scale-105 group-hover/img:opacity-90"
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
		img.addEventListener("load", () => {
			img.style.opacity = "1";
			loadingBar?.style.setProperty("opacity", "0");
			aspectRatioCache.set(url, img.naturalHeight / img.naturalWidth);
		});
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

function loadMore() {
	const { grid, sentinel, endMessage } = getElements();
	if (!grid) return;

	if (currentIndex >= filteredImages.length) {
		sentinel?.classList.add("hidden");
		endMessage?.classList.remove("hidden");
		return;
	}

	const end = Math.min(currentIndex + BATCH_SIZE, filteredImages.length);
	const isInitialBatch = currentIndex === 0;

	for (let i = currentIndex; i < end; i++) {
		const imageData = filteredImages[i];
		if (!imageData) continue;

		const colIndex = getShortestColumn();
		columns[colIndex]?.appendChild(createCard(imageData, i, isInitialBatch));

		const aspectRatio =
			aspectRatioCache.get(imageData.url) || FALLBACK_ASPECT_RATIO;
		columnHeights[colIndex] =
			(columnHeights[colIndex] ?? 0) +
			ESTIMATED_COLUMN_WIDTH * aspectRatio +
			12;
	}

	currentIndex = end;

	if (currentIndex >= filteredImages.length) {
		sentinel?.classList.add("hidden");
		endMessage?.classList.remove("hidden");
	}
}

function applyFilter(filter: string) {
	if (filter === "all") {
		filteredImages = [...sortedImages];
	} else if (filter.includes("-")) {
		filteredImages = sortedImages.filter((img) => img.yearMonth === filter);
	} else {
		filteredImages = sortedImages.filter((img) => img.year === filter);
	}

	const { totalCount, sentinel, endMessage } = getElements();
	if (totalCount) {
		totalCount.textContent = `共 ${filteredImages.length} 张图片`;
	}

	sentinel?.classList.remove("hidden");
	endMessage?.classList.add("hidden");

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
					? document.querySelector<HTMLButtonElement>(`[data-filter="${year}"]`)
					: null;
				yearBtn?.nextElementSibling?.classList.add("show");
			} else {
				hideAllMonthPills();
			}

			applyFilter(filter);
		});
	}
}

function openLightbox(index: number) {
	const els = getElements();
	const imageData = filteredImages[index];
	if (!els.lightbox || !els.lightboxImg || !imageData) return;

	lightboxIndex = index;
	els.lightboxImg.src = imageData.url;
	if (els.lightboxCounter) {
		els.lightboxCounter.textContent = `${index + 1} / ${filteredImages.length}`;
	}
	if (els.lightboxInfo) {
		els.lightboxInfo.textContent = `${imageData.year}/${imageData.month}/${imageData.filename}`;
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
	const { initialLoading, sentinel, totalCount } = getElements();

	await loadImagesData();
	if (id !== mountId) return;

	filteredImages = [...sortedImages];
	if (totalCount) {
		totalCount.textContent = `共 ${sortedImages.length} 张图片`;
	}

	initialLoading?.classList.add("hidden");
	sentinel?.classList.remove("hidden");

	renderFilterButtons();
	initGrid();
	initLightboxEvents();
	initFilterButtons();

	ready = true;
}

function teardown() {
	observer?.disconnect();
	observer = undefined;
	for (const fn of cleanups) fn();
	cleanups = [];
	sortedImages = [];
	filteredImages = [];
	currentIndex = 0;
	lightboxIndex = 0;
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
