// 数据已经在 HTML 里，这里只做档位切换与分页，不请求任何接口。
const PAGE_SIZE = 24;
const statusLabels: Record<string, string> = {
	"3": "在看",
	"1": "想看",
	"2": "看过",
	"4": "搁置",
	"5": "抛弃",
};

let activeRoot: HTMLElement | null = null;
let cleanupPage: (() => void) | null = null;
let activeType = "3";
let currentPage = 1;

function query<T extends Element>(
	root: HTMLElement,
	selector: string,
): T | null {
	return root.querySelector<T>(selector);
}

function cardsOf(root: HTMLElement, type: string): HTMLElement[] {
	return Array.from(
		root.querySelectorAll<HTMLElement>(`.bangumi-card[data-status="${type}"]`),
	);
}

function render(root: HTMLElement) {
	const visible = cardsOf(root, activeType);
	const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
	if (currentPage > totalPages) currentPage = totalPages;
	if (currentPage < 1) currentPage = 1;

	const start = (currentPage - 1) * PAGE_SIZE;
	for (const card of root.querySelectorAll<HTMLElement>(".bangumi-card")) {
		card.hidden = true;
	}
	for (const card of visible.slice(start, start + PAGE_SIZE)) {
		card.hidden = false;
	}

	const title = query(root, "#bangumi-list-title");
	const count = query(root, "#bangumi-list-count");
	const subtitle = query(root, "#bangumi-list-subtitle");
	const empty = query(root, "#bangumi-list-empty");
	const pagination = query(root, "#bangumi-pagination");
	const pageLabel = query(root, "#bangumi-page-label");
	const prev = query<HTMLButtonElement>(root, "#bangumi-prev");
	const next = query<HTMLButtonElement>(root, "#bangumi-next");

	if (title) title.textContent = statusLabels[activeType] || "动画";
	if (count) count.textContent = String(visible.length);
	if (subtitle) {
		subtitle.textContent =
			visible.length > 0
				? `共 ${visible.length} 部，按 Bangumi 收藏顺序展示`
				: "这个状态下还没有动画条目";
	}
	if (empty) empty.classList.toggle("hidden", visible.length > 0);
	if (pagination)
		pagination.classList.toggle("hidden", visible.length <= PAGE_SIZE);
	if (pageLabel) pageLabel.textContent = `${currentPage} / ${totalPages}`;
	if (prev) prev.disabled = currentPage <= 1;
	if (next) next.disabled = currentPage >= totalPages;

	for (const button of root.querySelectorAll<HTMLElement>(
		".bangumi-status-tab",
	)) {
		const isActive = button.dataset.status === activeType;
		button.classList.toggle("is-active", isActive);
		button.setAttribute("aria-pressed", String(isActive));
	}
}

export function initBangumiPage() {
	const root = document.getElementById("bangumi-page");
	if (!root) return;
	if (activeRoot === root) return;

	cleanupPage?.();
	activeRoot = root;
	activeType = root.dataset.activeType || "3";
	currentPage = 1;

	const onStatusClick = (event: Event) => {
		const target = event.target as HTMLElement;
		const button = target.closest<HTMLElement>("[data-status]");
		if (!button?.dataset.status) return;
		activeType = button.dataset.status;
		currentPage = 1;
		render(root);
	};

	const onPrev = () => {
		currentPage -= 1;
		render(root);
	};

	const onNext = () => {
		currentPage += 1;
		render(root);
	};

	const tabs = Array.from(
		root.querySelectorAll<HTMLElement>(".bangumi-status-tab"),
	);
	const prev = query<HTMLButtonElement>(root, "#bangumi-prev");
	const next = query<HTMLButtonElement>(root, "#bangumi-next");

	for (const button of tabs) button.addEventListener("click", onStatusClick);
	prev?.addEventListener("click", onPrev);
	next?.addEventListener("click", onNext);

	cleanupPage = () => {
		for (const button of tabs)
			button.removeEventListener("click", onStatusClick);
		prev?.removeEventListener("click", onPrev);
		next?.removeEventListener("click", onNext);
		activeRoot = null;
	};

	render(root);
}
