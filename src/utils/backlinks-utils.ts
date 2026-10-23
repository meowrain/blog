import type { CollectionEntry } from "astro:content";
import { getSortedPosts } from "./content-utils";
import { postPathBySlug } from "./url-utils";
import { type OutlinkRecord, buildBacklinkIndex } from "./wikilink-core";

/**
 * 反向链接的数据层。
 *
 * remark 插件在 `render()` 时把每篇文章的出链写进
 * `remarkPluginFrontmatter.wikilinks`，这里把「每篇的出链」反转成
 * 「每篇被谁引用」。全站只算一遍，结果按文章缓存。
 */

/** 只用反链面板需要的字段，和 RelatedPost 的裁剪版对齐。 */
export interface BacklinkPost {
	slug: string;
	title: string;
	description: string;
	published: Date;
	url: string;
}

/** 一篇存在文章的最小描述，供 remark 插件渲染链接文字与锚点校验。 */
export interface WikiTarget {
	title: string;
	headings: string[];
}

/**
 * 缓存。构建期 `[...slug].astro` 会对每篇文章各调一次，
 * 没有缓存就是 O(n²) 次 `render()`；dev 下必须关掉，否则改完文章 HMR 还拿旧数据。
 */
const cacheEnabled = import.meta.env.PROD;
let targetsCache: Map<string, WikiTarget> | null = null;
let backlinkIndexCache: Map<string, BacklinkPost[]> | null = null;

/** 清空缓存（测试、以及需要强制刷新的场景）。 */
export function resetWikiLinkCache(): void {
	targetsCache = null;
	backlinkIndexCache = null;
}

/**
 * 取出某篇文章的出链清单。
 *
 * `remarkPluginFrontmatter` 里的东西是 remark 插件写进 `vfile.data.astro.frontmatter`
 * 的，Astro 只在 `render()` 的返回值上给了一份；条目对象本身上的
 * `entry.remarkPluginFrontmatter` 是另一条路径（懒加载的模块导出），
 * 在「只 render 过、没走页面渲染」的场景下读不到，所以以 `render()` 的返回为准。
 *
 * @param frontmatter `render()` 返回的 `remarkPluginFrontmatter`
 */
export function getOutlinks(frontmatter: unknown): OutlinkRecord[] {
	const links = (frontmatter as { wikilinks?: OutlinkRecord[] } | undefined)
		?.wikilinks;
	return Array.isArray(links) ? links : [];
}

/**
 * 全站 slug → { 标题, 小节标题 }，remark 插件靠它把 `[[slug]]` 换成标题文字。
 *
 * 直接复用 `getSortedPosts()`：prod 下 draft 已被过滤，所以双链指向草稿会自然
 * 变成断链，这正是想要的行为。标题列表同时也用来校验 `[[slug#锚点]]` 是否写错。
 */
export async function getWikiTargets(): Promise<Map<string, WikiTarget>> {
	if (cacheEnabled && targetsCache) return targetsCache;

	const posts = await getSortedPosts();
	const map = new Map<string, WikiTarget>();
	for (const post of posts) {
		const { headings } = await post.render();
		map.set(post.slug, {
			title: post.data.title,
			headings: headings.map((heading: { text: string }) => heading.text),
		});
	}

	if (cacheEnabled) targetsCache = map;
	return map;
}

/** 文章 → 卡片字段的裁剪，出链和反链共用。 */
function toBacklinkPost(entry: CollectionEntry<"posts">): BacklinkPost {
	return {
		slug: entry.slug,
		title: entry.data.title,
		description: entry.data.description,
		published: entry.data.published,
		url: postPathBySlug(entry.slug),
	};
}

/**
 * 全站反向索引：目标 slug → 引用了它的文章。
 *
 * 反转、去重、自引用过滤、断链过滤全在纯函数 `buildBacklinkIndex` 里，
 * 这里只负责喂数据 + 排序。排序按发布时间倒序，新的排前面；同一天按 slug
 * 兜底，保证每次构建结果稳定。
 */
async function getBacklinkIndex(): Promise<Map<string, BacklinkPost[]>> {
	if (cacheEnabled && backlinkIndexCache) return backlinkIndexCache;

	const posts = await getSortedPosts();
	const outlinksBySlug = new Map<
		string,
		Array<OutlinkRecord & { target: string; source: BacklinkPost }>
	>();

	for (const post of posts) {
		// 出链清单要等 render 之后才存在；这里只为数据，不关心产物
		const { remarkPluginFrontmatter } = await post.render();
		const source = toBacklinkPost(post);
		outlinksBySlug.set(
			post.slug,
			getOutlinks(remarkPluginFrontmatter).map((outlink) => ({
				...outlink,
				target: outlink.slug,
				source,
			})),
		);
	}

	const index = buildBacklinkIndex(outlinksBySlug);
	for (const [target, sources] of index) {
		index.set(
			target,
			sources.sort(
				(a, b) =>
					b.published.getTime() - a.published.getTime() ||
					a.slug.localeCompare(b.slug),
			),
		);
	}

	if (cacheEnabled) backlinkIndexCache = index;
	return index;
}

/** 引用了 `entry` 的文章列表（已过滤自引用 / 重复 / 断链）。 */
export async function getBacklinks(
	entry: CollectionEntry<"posts">,
	limit = 20,
): Promise<BacklinkPost[]> {
	const index = await getBacklinkIndex();
	return (index.get(entry.slug) ?? []).slice(0, limit);
}
