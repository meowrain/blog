/**
 * 继续阅读 / 稍后读的本地存储。
 *
 * 跟 setting-utils 一样直接读写 localStorage，没有后端参与：
 * - `reading-history`：最近读过的文章和阅读进度（按最后阅读时间倒序）
 * - `read-later`：手动标记的稍后读列表
 *
 * 读写完成后会派发自定义事件，侧栏书架和首页卡片监听后即时刷新。
 */

export interface ReadingRecord {
	slug: string;
	title: string;
	url: string;
	/** 阅读进度，0~1。记录的是读到过的最远位置。 */
	progress: number;
	/** 最后阅读时间（毫秒时间戳）。 */
	updatedAt: number;
	/** 所属系列名，不属于系列时为空字符串。 */
	series: string;
	/** 系列内章节序号，从 1 开始；未知时为 0。 */
	chapterIndex: number;
	/** 系列总章节数；未知时为 0。 */
	chapterTotal: number;
}

export interface ReadLaterItem {
	slug: string;
	title: string;
	url: string;
	addedAt: number;
	series?: string;
}

export const READING_HISTORY_KEY = "reading-history";
export const READ_LATER_KEY = "read-later";

export const READING_HISTORY_EVENT = "reading-history-change";
export const READ_LATER_EVENT = "read-later-change";

const MAX_HISTORY = 20;
const MAX_READ_LATER = 50;
/** 低于这个进度视为误触，不写进历史。 */
export const MIN_READING_PROGRESS = 0.02;
/** 读到这个比例就算读完，不再出现在「继续阅读」里。 */
export const FINISHED_READING_PROGRESS = 0.99;

function clampProgress(progress: number): number {
	if (!Number.isFinite(progress)) return 0;
	return Math.min(1, Math.max(0, progress));
}

function readJson<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return fallback;
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function writeJson(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// 隐私模式 / 存储已满时静默失败，不影响阅读
	}
}

function dispatch(name: string): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new CustomEvent(name));
}

function postUrl(slug: string): string {
	return `/posts/${slug}/`;
}

function normalizeRecord(record: ReadingRecord): ReadingRecord {
	const slug = String(record.slug);
	return {
		slug,
		title: String(record.title ?? slug),
		url:
			typeof record.url === "string" && record.url ? record.url : postUrl(slug),
		progress: clampProgress(Number(record.progress)),
		updatedAt: Number(record.updatedAt) || 0,
		series: typeof record.series === "string" ? record.series : "",
		chapterIndex: Number(record.chapterIndex) || 0,
		chapterTotal: Number(record.chapterTotal) || 0,
	};
}

/** 最近阅读记录，按最后阅读时间倒序。 */
export function getReadingHistory(): ReadingRecord[] {
	const list = readJson<ReadingRecord[]>(READING_HISTORY_KEY, []);
	if (!Array.isArray(list)) return [];
	return list
		.filter(
			(item) =>
				item && typeof item.slug === "string" && typeof item.title === "string",
		)
		.map(normalizeRecord)
		.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 记录一篇文章的阅读进度。
 * 进度只增不减，避免从文末滚回开头后「继续阅读」的百分比倒退。
 */
export function saveReadingProgress(
	record: Omit<ReadingRecord, "updatedAt" | "progress"> & {
		progress: number;
		updatedAt?: number;
	},
): void {
	const progress = clampProgress(record.progress);
	if (progress <= MIN_READING_PROGRESS) return;

	const history = getReadingHistory();
	const previous = history.find((item) => item.slug === record.slug);
	history.unshift({
		...record,
		slug: String(record.slug),
		title: String(record.title),
		url: record.url || postUrl(record.slug),
		series: record.series ?? "",
		chapterIndex: record.chapterIndex ?? 0,
		chapterTotal: record.chapterTotal ?? 0,
		progress: previous ? Math.max(progress, previous.progress) : progress,
		updatedAt: record.updatedAt ?? Date.now(),
	});

	const seen = new Set<string>();
	const deduped = history.filter((item) => {
		if (seen.has(item.slug)) return false;
		seen.add(item.slug);
		return true;
	});

	writeJson(READING_HISTORY_KEY, deduped.slice(0, MAX_HISTORY));
	dispatch(READING_HISTORY_EVENT);
}

export function removeReadingRecord(slug: string): void {
	const next = getReadingHistory().filter((item) => item.slug !== slug);
	writeJson(READING_HISTORY_KEY, next);
	dispatch(READING_HISTORY_EVENT);
}

/** 稍后读列表，最新加入的排在最前。 */
export function getReadLaterList(): ReadLaterItem[] {
	const list = readJson<ReadLaterItem[]>(READ_LATER_KEY, []);
	if (!Array.isArray(list)) return [];
	return list
		.filter(
			(item) =>
				item && typeof item.slug === "string" && typeof item.title === "string",
		)
		.map((item) => ({
			slug: String(item.slug),
			title: String(item.title),
			url:
				typeof item.url === "string" && item.url
					? item.url
					: postUrl(item.slug),
			addedAt: Number(item.addedAt) || 0,
			series: typeof item.series === "string" ? item.series : "",
		}))
		.sort((a, b) => b.addedAt - a.addedAt);
}

export function isInReadLater(slug: string): boolean {
	return getReadLaterList().some((item) => item.slug === slug);
}

/** 加入 / 移出稍后读，返回操作后是否在列表中。 */
export function toggleReadLater(item: Omit<ReadLaterItem, "addedAt">): boolean {
	const list = getReadLaterList();
	const exists = list.some((entry) => entry.slug === item.slug);
	const next = exists
		? list.filter((entry) => entry.slug !== item.slug)
		: [
				{
					...item,
					slug: String(item.slug),
					title: String(item.title),
					url: item.url || postUrl(item.slug),
					series: item.series ?? "",
					addedAt: Date.now(),
				},
				...list,
			].slice(0, MAX_READ_LATER);

	writeJson(READ_LATER_KEY, next);
	dispatch(READ_LATER_EVENT);
	return !exists;
}

export function removeFromReadLater(slug: string): void {
	const next = getReadLaterList().filter((item) => item.slug !== slug);
	writeJson(READ_LATER_KEY, next);
	dispatch(READ_LATER_EVENT);
}

/**
 * 最近一次阅读、且还没读完的那篇，用于「继续阅读」。
 * `excludeSlug` 一般是当前正在读的文章：在正文页把它自己推荐给自己没有意义。
 */
export function getLastUnfinishedRecord(
	excludeSlug?: string,
): ReadingRecord | null {
	return (
		getReadingHistory().find(
			(item) =>
				item.progress < FINISHED_READING_PROGRESS && item.slug !== excludeSlug,
		) ?? null
	);
}
