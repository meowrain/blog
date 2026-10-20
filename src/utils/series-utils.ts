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

/** 系列名 → 锚点：保留中英文和数字，空格转连字符，其余标点丢掉。 */
export function seriesSlug(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^\p{Letter}\p{Number}-]/gu, "");
}

/** 章节排序：先按 seriesOrder，没写的按发布时间，最后用标题兜底，保证结果稳定。 */
function sortChapters(posts: CollectionEntry<"posts">[]): SeriesChapter[] {
	return [...posts]
		.sort((a, b) => {
			const orderA = a.data.seriesOrder ?? Number.POSITIVE_INFINITY;
			const orderB = b.data.seriesOrder ?? Number.POSITIVE_INFINITY;
			if (orderA !== orderB) return orderA - orderB;

			const byDate = a.data.published.getTime() - b.data.published.getTime();
			if (byDate !== 0) return byDate;

			return a.data.title.localeCompare(b.data.title, "zh-Hans-CN");
		})
		.map((post, i) => ({
			slug: post.slug,
			title: post.data.title,
			index: i + 1,
			published: post.data.published,
		}));
}

/** 全站文章按 series 分组：系列名 → 排好序的章节列表。 */
async function groupSeries(): Promise<Map<string, SeriesChapter[]>> {
	const posts = await getSortedPosts();
	const grouped = new Map<string, CollectionEntry<"posts">[]>();

	for (const post of posts) {
		const name = (post.data.series ?? "").trim();
		if (!name) continue;

		const members = grouped.get(name) ?? [];
		members.push(post);
		grouped.set(name, members);
	}

	const series = new Map<string, SeriesChapter[]>();
	for (const [name, members] of grouped) {
		series.set(name, sortChapters(members));
	}
	return series;
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

	const chapters = (await groupSeries()).get(name);
	if (!chapters || chapters.length < 2) return null;

	const position = chapters.findIndex((chapter) => chapter.slug === entry.slug);
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
	const series = await groupSeries();

	return [...series.entries()]
		.map(([name, chapters]) => ({
			name,
			slug: seriesSlug(name),
			chapters,
			latestPublished: chapters.reduce(
				(latest, chapter) =>
					chapter.published > latest ? chapter.published : latest,
				chapters[0].published,
			),
		}))
		.sort((a, b) => b.latestPublished.getTime() - a.latestPublished.getTime());
}
