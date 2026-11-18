import type { CollectionEntry } from "astro:content";
import { getSortedPosts } from "./content-utils";

/** 系列里的一章：一篇带同名 series 的文章。 */
export interface SeriesChapter {
	slug: string;
	title: string;
	/** 章序号，从 1 开始。 */
	index: number;
	published: Date;
}

/** 章节 + 阅读时长，详情页 / 总览卡片用。 */
export interface SeriesEntryChapter extends SeriesChapter {
	/** 阅读时长（分钟），来自 remark-reading-time；取不到时为 0。 */
	minutes: number;
}

/** 一篇文章在系列里的位置，给正文顶部的系列导航用。 */
export interface SeriesInfo {
	name: string;
	/** 锚点 / URL 片段，中文原样保留。 */
	slug: string;
	chapters: SeriesChapter[];
	current: SeriesChapter;
	prev: SeriesChapter | null;
	next: SeriesChapter | null;
	total: number;
}

/** 系列总览，给 /series 页面用。 */
export interface SeriesSummary {
	name: string;
	slug: string;
	chapters: SeriesChapter[];
	latestPublished: Date;
}

/** 系列详情页的数据：总览卡片与 /series/<slug>/ 共用同一份。 */
export interface SeriesDetail {
	name: string;
	slug: string;
	chapters: SeriesEntryChapter[];
	latestPublished: Date;
	/** 系列简介，取最近一篇文章的 description；可能为空。 */
	description: string;
	/** 封面：最近一篇带 image 的文章的封面；全都没有时为空串。 */
	cover: string;
	/** 封面所属文章的 id，即它在 src/content/posts 下的相对路径，ImageWrapper 用它拼 basePath。 */
	coverEntryId: string;
	/** 已发布章节数。 */
	publishedCount: number;
	/**
	 * 计划总章数：frontmatter 写了 seriesTotal 才有值。
	 * 为 null 时页面只说「已发布 N 章」，不暗示存在没写的章节。
	 */
	totalCount: number | null;
	/** 整个系列的累计阅读时长（分钟）。 */
	totalMinutes: number;
	/** 第一章 / 最新一章，给「从头读」「继续读」按钮用。 */
	first: SeriesEntryChapter;
	latest: SeriesEntryChapter;
}

/** 系列名 → 锚点：保留中英文和数字，空格转连字符，其余标点丢掉。 */
export function seriesSlug(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^\p{Letter}\p{Number}-]/gu, "");
}

/** 详情页路径，卡片和文章内导航都走这里，别各拼各的。 */
export function seriesPath(slug: string): string {
	return `/series/${slug}/`;
}

/** 章节排序：先按 seriesOrder，没写的按发布时间，最后用标题兜底，保证结果稳定。 */
function sortEntries(
	posts: CollectionEntry<"posts">[],
): CollectionEntry<"posts">[] {
	return [...posts].sort((a, b) => {
		const orderA = a.data.seriesOrder ?? Number.POSITIVE_INFINITY;
		const orderB = b.data.seriesOrder ?? Number.POSITIVE_INFINITY;
		if (orderA !== orderB) return orderA - orderB;

		const byDate = a.data.published.getTime() - b.data.published.getTime();
		if (byDate !== 0) return byDate;

		return a.data.title.localeCompare(b.data.title, "zh-Hans-CN");
	});
}

/** 排好序的文章 → 章节，序号从 1 开始。 */
function toChapters(posts: CollectionEntry<"posts">[]): SeriesChapter[] {
	return posts.map((post, i) => ({
		slug: post.slug,
		title: post.data.title,
		index: i + 1,
		published: post.data.published,
	}));
}

/** 全站文章按 series 分组，组内已排好序；系列名 → 文章列表。 */
async function groupSeries(): Promise<Map<string, CollectionEntry<"posts">[]>> {
	const posts = await getSortedPosts();
	const grouped = new Map<string, CollectionEntry<"posts">[]>();

	for (const post of posts) {
		const name = (post.data.series ?? "").trim();
		if (!name) continue;

		const members = grouped.get(name) ?? [];
		members.push(post);
		grouped.set(name, members);
	}

	for (const [name, members] of grouped) {
		grouped.set(name, sortEntries(members));
	}
	return grouped;
}

function latestOf(chapters: SeriesChapter[]): Date {
	return chapters.reduce(
		(latest, chapter) =>
			chapter.published > latest ? chapter.published : latest,
		chapters[0].published,
	);
}

/**
 * 取某篇文章的系列上下文。
 * 系列下至少两章才返回，免得单篇系列刷出一条没有上一章也没有下一章的导航。
 */
export async function getSeriesInfo(
	entry: CollectionEntry<"posts">,
): Promise<SeriesInfo | null> {
	const name = (entry.data.series ?? "").trim();
	if (!name) return null;

	const members = (await groupSeries()).get(name);
	if (!members || members.length < 2) return null;

	const chapters = toChapters(members);
	const position = members.findIndex((post) => post.slug === entry.slug);
	if (position < 0) return null;

	return {
		name,
		slug: seriesSlug(name),
		chapters,
		current: chapters[position],
		prev: chapters[position - 1] ?? null,
		next: chapters[position + 1] ?? null,
		total: chapters.length,
	};
}

/** 所有系列的概览，最近更新的排前面。 */
export async function getAllSeries(): Promise<SeriesSummary[]> {
	const grouped = await groupSeries();

	return [...grouped.entries()]
		.map(([name, members]) => {
			const chapters = toChapters(members);
			return {
				name,
				slug: seriesSlug(name),
				chapters,
				latestPublished: latestOf(chapters),
			};
		})
		.sort((a, b) => b.latestPublished.getTime() - a.latestPublished.getTime());
}

/** 单篇的阅读时长：remark 插件在构建期写进 frontmatter，拿不到就记 0。 */
async function minutesOf(post: CollectionEntry<"posts">): Promise<number> {
	try {
		const { remarkPluginFrontmatter } = await post.render();
		return Number(remarkPluginFrontmatter.minutes) || 0;
	} catch {
		return 0;
	}
}

/**
 * 全部系列的展示数据：封面、简介、章节目录、进度，最近更新的排前面。
 * 详情页拿它按 slug 取一条，总览页直接铺卡片。
 */
export async function getSeriesDetails(): Promise<SeriesDetail[]> {
	const grouped = await groupSeries();

	const details = await Promise.all(
		[...grouped.entries()].map(async ([name, members]) => {
			const chapters: SeriesEntryChapter[] = await Promise.all(
				members.map(async (post, i) => ({
					slug: post.slug,
					title: post.data.title,
					index: i + 1,
					published: post.data.published,
					minutes: await minutesOf(post),
				})),
			);

			// 封面 / 简介都取「最新一篇有料的」：读者打开详情页看到的是现在这个系列长什么样
			const coverPost = [...members]
				.reverse()
				.find((post) => (post.data.image ?? "").trim() !== "");
			const descriptionPost = [...members]
				.reverse()
				.find((post) => (post.data.description ?? "").trim() !== "");

			const plannedTotals = members
				.map((post) => post.data.seriesTotal)
				.filter((total): total is number => typeof total === "number");

			return {
				name,
				slug: seriesSlug(name),
				chapters,
				latestPublished: latestOf(chapters),
				description: (descriptionPost?.data.description ?? "").trim(),
				cover: (coverPost?.data.image ?? "").trim(),
				coverEntryId: coverPost?.id ?? "",
				publishedCount: chapters.length,
				totalCount:
					plannedTotals.length > 0 ? Math.max(...plannedTotals) : null,
				totalMinutes: chapters.reduce(
					(sum, chapter) => sum + chapter.minutes,
					0,
				),
				first: chapters[0],
				latest: chapters[chapters.length - 1],
			} satisfies SeriesDetail;
		}),
	);

	return details.sort(
		(a, b) => b.latestPublished.getTime() - a.latestPublished.getTime(),
	);
}

/** 详情页用：按 slug 找单个系列，找不到返回 null。 */
export async function getSeriesDetail(
	slug: string,
): Promise<SeriesDetail | null> {
	const details = await getSeriesDetails();
	return details.find((detail) => detail.slug === slug) ?? null;
}
