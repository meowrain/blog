/**
 * 系列（连载合集）的纯逻辑：分组、排序、名字匹配。
 *
 * 排序规则是从 `src/utils/series-utils.ts:42-54` 抄过来的 —— 那个文件被 `/series/` 页面
 * 和文章页的上一章 / 下一章导航共用，不能为了给 agent 用去改它；但 agent 说「JUC 从第 6 章
 * 读起」必须和访客点进 `/series/#juc` 看到的一致，所以这边逐条对齐，逻辑别自己发挥。
 *
 * 零依赖、只吃索引里的字段，方便在 Node 里直接跑单测。
 */

/** 索引里一篇带系列信息的文章（`/posts-index.json` 的字段子集）。 */
export interface SeriesPostMeta {
	title: string;
	slug: string;
	url: string;
	series: string;
	seriesOrder?: number;
	/** 只到天 */
	published: string;
	/** 完整时间戳；排序用它，`published` 同日并列会把顺序排乱 */
	publishedAt?: string;
	tags: string[];
}

/** 系列里的一章。 */
export interface SeriesChapter {
	index: number;
	title: string;
	slug: string;
	url: string;
	published: string;
}

export interface SeriesSummaryItem {
	name: string;
	slug: string;
	count: number;
	latestPublished: string;
	tags: string[];
}

/** 系列名 → 锚点，与 series-utils.ts:34-40 的 `seriesSlug` 逐字一致（刻意不加 NFKC，URL 变了锚点就废了）。 */
export function seriesSlug(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^\p{Letter}\p{Number}-]/gu, '');
}

/** 比较用的归一化：NFKC + 小写 + 收空格。只影响「找哪个系列」，不影响 slug。 */
function normalizeName(name: string): string {
	return name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 排序用的时间戳：优先完整 ISO，没有就退回日期（UTC 零点）。 */
function publishedTime(post: SeriesPostMeta): number {
	const at = Date.parse(post.publishedAt || post.published);
	return Number.isNaN(at) ? 0 : at;
}

/**
 * 章节排序：先按 seriesOrder，没写的按发布时间，最后用标题兜底，保证结果稳定。
 * 与 series-utils.ts:42-54 保持一致。
 */
export function sortChapters(
	posts: readonly SeriesPostMeta[],
): SeriesChapter[] {
	return [...posts]
		.sort((a, b) => {
			const orderA = a.seriesOrder ?? Number.POSITIVE_INFINITY;
			const orderB = b.seriesOrder ?? Number.POSITIVE_INFINITY;
			if (orderA !== orderB) return orderA - orderB;

			const byDate = publishedTime(a) - publishedTime(b);
			if (byDate !== 0) return byDate;

			return a.title.localeCompare(b.title, 'zh-Hans-CN');
		})
		.map((post, i) => ({
			index: i + 1,
			title: post.title,
			slug: post.slug,
			url: post.url,
			published: post.published,
		}));
}

/** 全站文章按 series 分组：系列名 → 排好序的章节列表。系列名去掉首尾空白后为空的不算。 */
export function groupSeries(
	posts: readonly SeriesPostMeta[],
): Map<string, SeriesChapter[]> {
	const grouped = new Map<string, SeriesPostMeta[]>();
	for (const post of posts) {
		const name = (post.series ?? '').trim();
		if (!name) continue;
		const members = grouped.get(name);
		if (members) members.push(post);
		else grouped.set(name, [post]);
	}

	const series = new Map<string, SeriesChapter[]>();
	for (const [name, members] of grouped)
		series.set(name, sortChapters(members));
	return series;
}

/** 系列里最高频的几个标签，按次数降序、同次数按名字，结果稳定。 */
function topTags(posts: readonly SeriesPostMeta[], max: number): string[] {
	const counts = new Map<string, number>();
	for (const post of posts) {
		for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort((a, b) =>
			b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0], 'zh-Hans-CN'),
		)
		.slice(0, max)
		.map(([tag]) => tag);
}

/** 系列总览：按篇数降序，最多 maxSeries 个；只带标题、篇数和 topTags，章节留给 read_series。 */
export function summarizeSeries(
	posts: readonly SeriesPostMeta[],
	maxSeries: number,
	maxTags: number,
): { totalSeries: number; totalPosts: number; series: SeriesSummaryItem[] } {
	const series = groupSeries(posts);
	const members = new Map<string, SeriesPostMeta[]>();
	let totalPosts = 0;
	for (const post of posts) {
		const name = (post.series ?? '').trim();
		if (!name) continue;
		totalPosts += 1;
		const list = members.get(name);
		if (list) list.push(post);
		else members.set(name, [post]);
	}

	const items: SeriesSummaryItem[] = [...series.entries()]
		.map(([name, chapters]) => {
			// 「最近更新」按发布时间取最大，与 /series/ 页面一致
			const latest = chapters.reduce(
				(acc, chapter) => (chapter.published > acc ? chapter.published : acc),
				'',
			);
			return {
				name,
				slug: seriesSlug(name),
				count: chapters.length,
				latestPublished: latest,
				tags: topTags(members.get(name) ?? [], maxTags),
			};
		})
		.sort((a, b) => {
			if (a.count !== b.count) return b.count - a.count;
			if (a.latestPublished !== b.latestPublished)
				return a.latestPublished < b.latestPublished ? 1 : -1;
			return a.name.localeCompare(b.name, 'zh-Hans-CN');
		});

	return {
		totalSeries: items.length,
		totalPosts,
		series: items.slice(0, maxSeries),
	};
}

export type SeriesMatch =
	| { kind: 'exact'; name: string }
	| { kind: 'fuzzy'; name: string }
	| { kind: 'ambiguous'; candidates: string[] }
	| { kind: 'none'; candidates: string[] };

/**
 * 按名字找系列：先精确（NFKC + 小写，或锚点相等），再模糊（互相包含）。
 * 模糊命中多条时返回候选让模型自己选 —— 猜一个「最像的」比不给更糟，访客会读到另一个系列去。
 */
export function matchSeriesName(
	wanted: string,
	names: readonly string[],
): SeriesMatch {
	const needle = normalizeName(wanted);
	if (!needle) return { kind: 'none', candidates: [] };

	const exact = names.filter((name) => normalizeName(name) === needle);
	if (exact.length === 1) return { kind: 'exact', name: exact[0] };
	if (exact.length > 1) return { kind: 'ambiguous', candidates: exact };

	const wantedSlug = seriesSlug(wanted);
	const bySlug = wantedSlug
		? names.filter((name) => seriesSlug(name) === wantedSlug)
		: [];
	if (bySlug.length === 1) return { kind: 'exact', name: bySlug[0] };
	if (bySlug.length > 1) return { kind: 'ambiguous', candidates: bySlug };

	const fuzzy = names.filter((name) => {
		const normalized = normalizeName(name);
		return normalized.includes(needle) || needle.includes(normalized);
	});
	if (fuzzy.length === 1) return { kind: 'fuzzy', name: fuzzy[0] };
	if (!fuzzy.length) return { kind: 'none', candidates: [] };
	return { kind: 'ambiguous', candidates: fuzzy };
}

/** 一个系列的完整章节表，给 read_series 用；`published` 只到天，跟 `/series/` 页面一致。 */
export function readSeries(
	posts: readonly SeriesPostMeta[],
	name: string,
): {
	name: string;
	slug: string;
	url: string;
	count: number;
	chapters: SeriesChapter[];
} {
	const series = groupSeries(posts);
	const chapters = series.get(name);
	if (!chapters) throw new Error(`未知系列：${name}`);
	const slug = seriesSlug(name);
	return {
		name,
		slug,
		url: `/series/#${slug}`,
		count: chapters.length,
		chapters,
	};
}
