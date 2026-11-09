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
 * 标签归并键：NFKC + 小写 + 去首尾空白。
 * frontmatter 里 Java / JAVA、MySQL / MYSQL、Golang / golang 这类写法
 * 只是大小写或全角差异，应当视作同一个标签，统计、筛选、URL 都按这个键归并。
 */
export function tagKey(tag: string): string {
	return tag.trim().normalize("NFKC").toLowerCase();
}

/**
 * 标签 → 路由 slug。
 * 和分类页一样保留中文（静态站按文件名直接访问更稳），只把空格和
 * 路径分隔符、查询串等保留字符换掉，避免个别标签生成出无法访问的链接。
 * 统一转小写并做 NFKC：上面的写法差异会归并到同一个标签页。
 */
export function tagSlug(tag: string): string {
	return tagKey(tag).replace(/[\s/\\?#%]+/g, "-");
}

/**
 * 为一组标签出现记录挑选规范写法。
 * 每次出现（同一篇文章内重复的标签只算一次）投票，取出现次数最多的写法；
 * 并列时按字典序取第一个，保证构建结果稳定。返回「归并键 → 展示名」。
 */
export function resolveTagNames(
	tagLists: Iterable<readonly string[]>,
): Map<string, string> {
	const groups = new Map<string, Map<string, number>>();
	for (const tags of tagLists) {
		const seen = new Set<string>();
		for (const tag of tags) {
			const key = tagKey(tag);
			if (!key || seen.has(key)) continue;
			seen.add(key);
			const variants = groups.get(key) ?? new Map<string, number>();
			variants.set(tag.trim(), (variants.get(tag.trim()) ?? 0) + 1);
			groups.set(key, variants);
		}
	}

	const names = new Map<string, string>();
	for (const [key, variants] of groups) {
		const name = [...variants.entries()].sort(
			(a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN"),
		)[0][0];
		names.set(key, name);
	}
	return names;
}

export function getTagUrl(tag: string): string {
	return `${TAG_URL_PREFIX}${tagSlug(tag)}/`;
}

/**
 * 文章上的标签，统一去空并按归并键去重
 * （frontmatter 里同一个标签写两遍、或写成 MySQL / MYSQL 的情况）。
 */
export function getPostTags(post: CollectionEntry<"posts">): string[] {
	const tags = post.data.tags ?? [];
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of tags) {
		const tag = raw.trim();
		if (!tag) continue;
		const key = tagKey(tag);
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(tag);
	}
	return result;
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
			group.variants.set(tag.trim(), (group.variants.get(tag.trim()) ?? 0) + 1);
			groups.set(slug, group);
		}
	}

	return [...groups.entries()]
		.map(([slug, group]) => {
			// 展示名取文章数最多的那种写法，Java 胜过 JAVA、MySQL 胜过 MYSQL
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

/**
 * 给一组文章生成「标签归并键 → 规范展示名」的映射。
 * 详情页/卡片直接用 frontmatter 里的原始写法，会把 JAVA、MYSQL 原样显示出来；
 * 用它查一下就能统一成 Java、MySQL。
 */
export function getTagDisplayNames(
	posts: CollectionEntry<"posts">[],
): Map<string, string> {
	return resolveTagNames(posts.map((post) => getPostTags(post)));
}

/** 把一组原始标签映射成规范展示名并去重（JAVA → Java、MYSQL → MySQL）。 */
export function resolveTagList(
	tags: readonly string[],
	names: Map<string, string>,
): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of tags) {
		const tag = raw.trim();
		if (!tag) continue;
		const key = tagKey(tag);
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(names.get(key) ?? tag);
	}
	return result;
}
