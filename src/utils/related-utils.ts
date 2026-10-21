import type { CollectionEntry } from "astro:content";
import { getPostCategories, parseCategoryPath } from "./category-utils";
import { getSortedPosts } from "./content-utils";
import { getPostTags } from "./tag-utils";
import { getPostUrlBySlug } from "./url-utils";

/** 一篇相关文章：只带列表要用的字段，不渲染正文。 */
export interface RelatedPost {
	slug: string;
	title: string;
	description: string;
	published: Date;
	url: string;
	/** 命中的关联来源，用来在卡片上写一句「同系列」「3 个共同标签」 */
	reason: string;
	score: number;
}

// 权重刻意拉开数量级，保证优先级严格是 系列 > 标签重合度 > 分类：
// 系列满打满算都排在前面，标签每重合一个积一点，分类只作为最后的兜底排序。
const WEIGHT_SERIES = 100;
const WEIGHT_TAG = 10;
const WEIGHT_CATEGORY = 3;

function normalize(value: string): string {
	return value.trim().toLowerCase();
}

function sharedTagCount(tagsA: string[], tagsB: string[]): number {
	const setB = new Set(tagsB.map(normalize));
	return tagsA.filter((tag) => setB.has(normalize(tag))).length;
}

/**
 * 分类层级重合度：完全相同的分类算「同分类」，只共享顶级分类
 * （比如都在「中间件」下）也算沾边，但要弱一档。
 * 返回 2 = 完全相同，1 = 同顶级分类，0 = 无关。
 */
function categoryAffinity(
	categoriesA: string[],
	categoriesB: string[],
): number {
	const setB = new Set(categoriesB.map(normalize));
	let best = 0;

	for (const categoryA of categoriesA) {
		const pathA = parseCategoryPath(categoryA).map(normalize);
		for (const categoryB of setB) {
			const pathB = parseCategoryPath(categoryB).map(normalize);
			const shared = pathA.findIndex((part, i) => part !== pathB[i]);
			const commonLength =
				shared < 0 ? Math.min(pathA.length, pathB.length) : shared;

			if (commonLength === 0) continue;
			if (commonLength === pathA.length && commonLength === pathB.length) {
				return 2;
			}
			best = 1;
		}
	}

	return best;
}

/**
 * 给一篇文章找相关文章，构建期算分。
 *
 * 打分规则（严格按优先级）：
 * 1. 同一 series：+100，同系列的文章天然是最相关的；
 * 2. 每重合一个 tag：+10，写法和大小写无关；
 * 3. 同一 category：+3（只看顶级分类，同层级更深），只作为没有系列、
 *    标签也不重合时的兜底。
 * 同分时发布时间新的排前面，保证每次构建结果一致。
 */
export async function getRelatedPosts(
	entry: CollectionEntry<"posts">,
	limit = 3,
): Promise<RelatedPost[]> {
	const allPosts = await getSortedPosts();
	const series = normalize(entry.data.series ?? "");
	const tags = getPostTags(entry).map(normalize);
	const categories = getPostCategories(entry);

	const scored = allPosts
		.filter((post) => post.slug !== entry.slug)
		.map((post) => {
			const postSeries = normalize(post.data.series ?? "");
			const sameSeries = series !== "" && postSeries === series;
			const sharedTags = sharedTagCount(getPostTags(post), tags);
			const categoryScore = categoryAffinity(
				getPostCategories(post),
				categories,
			);

			let score = 0;
			if (sameSeries) score += WEIGHT_SERIES;
			score += sharedTags * WEIGHT_TAG;
			score += categoryScore * WEIGHT_CATEGORY;

			let reason = "";
			if (sameSeries) reason = "同系列";
			else if (sharedTags > 0) reason = `${sharedTags} 个共同标签`;
			else if (categoryScore === 2) reason = "同分类";
			else if (categoryScore === 1) reason = "同上级分类";

			return { post, score, reason };
		})
		// 0 分说明系列、标签、分类都不沾边，不值得推荐
		.filter((item) => item.score > 0)
		.sort(
			(a, b) =>
				b.score - a.score ||
				b.post.data.published.getTime() - a.post.data.published.getTime() ||
				a.post.slug.localeCompare(b.post.slug),
		)
		.slice(0, limit);

	return scored.map(({ post, score, reason }) => ({
		slug: post.slug,
		title: post.data.title,
		description: post.data.description,
		published: post.data.published,
		url: getPostUrlBySlug(post.slug),
		reason,
		score,
	}));
}
