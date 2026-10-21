import type { CollectionEntry } from "astro:content";
import { getSortedPosts } from "./content-utils";

export const TAG_URL_PREFIX = "/tags/";

export interface TagSummary {
	/** 展示用的标签名：同一 slug 下文章最多的那个写法（Java / JAVA 归并后显示 Java） */
	name: string;
	/** URL 里用的文件名，中文原样保留，只替换会破坏路径的字符 */
	slug: string;
	count: number;
	url: string;
}

/**
 * 标签 → 路由 slug。
 * 和分类页一样保留中文（静态站按文件名直接访问更稳），只把空格和
 * 路径分隔符、查询串等保留字符换掉，避免个别标签生成出无法访问的链接。
 * 统一转小写：frontmatter 里 Java / JAVA、MySQL / MYSQL、Python / python
 * 这种大小写不一致的写法归并到同一个标签页。
 */
export function tagSlug(tag: string): string {
	return tag
		.trim()
		.replace(/[\s/\\?#%]+/g, "-")
		.toLowerCase();
}

export function getTagUrl(tag: string): string {
	return `${TAG_URL_PREFIX}${tagSlug(tag)}/`;
}

/** 文章上的标签，统一去空并去重（frontmatter 里同一个标签写两遍的情况）。 */
export function getPostTags(post: CollectionEntry<"posts">): string[] {
	const tags = post.data.tags ?? [];
	return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

/**
 * 统计全站标签，按文章数从多到少排。
 * 大小写不同但 slug 相同的标签合并成一项，展示名取出现次数最多的写法。
 */
export async function getAllTags(
	posts?: CollectionEntry<"posts">[],
): Promise<TagSummary[]> {
	const allPosts = posts ?? (await getSortedPosts());
	const groups = new Map<
		string,
		{ count: number; variants: Map<string, number> }
	>();

	for (const post of allPosts) {
		for (const tag of getPostTags(post)) {
			const slug = tagSlug(tag);
			const group = groups.get(slug) ?? { count: 0, variants: new Map() };
			group.count++;
			group.variants.set(tag, (group.variants.get(tag) ?? 0) + 1);
			groups.set(slug, group);
		}
	}

	return [...groups.entries()]
		.map(([slug, group]) => {
			const name = [...group.variants.entries()].sort(
				(a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN"),
			)[0][0];
			return {
				name,
				slug,
				count: group.count,
				url: `${TAG_URL_PREFIX}${slug}/`,
			};
		})
		.sort(
			(a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hans-CN"),
		);
}

/** 某个标签下的文章，保持传入顺序（默认按发布时间倒序、置顶在前）。 */
export function getPostsByTagSlug(
	posts: CollectionEntry<"posts">[],
	slug: string,
): CollectionEntry<"posts">[] {
	return posts.filter((post) =>
		getPostTags(post).some((tag) => tagSlug(tag) === slug),
	);
}
