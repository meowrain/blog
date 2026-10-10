import { getSortedPosts } from "@utils/content-utils";
import { getPostUrlBySlug } from "@utils/url-utils";
import type { APIContext } from "astro";

/**
 * 站内文章索引，给 `/find` agent 的 `search_posts` 工具当数据源。
 *
 * 为什么带 headings：全站 description 加起来不到 1k 字符（绝大多数文章没写摘要），
 * 而「ABA 问题」「插入屏蔽」这类主题只出现在小节标题里，光靠标题和首段找不到。
 * 正文全文有 1MB，不可能整份交给工具，所以索引取「元信息 + 小节标题 + 首段」，
 * 合计约 75KB（140 篇），服务端拉一次就够。
 */

const EXCERPT_CHARS = 220;
const MAX_HEADINGS = 30;
const MAX_HEADING_CHARS = 60;

/** Markdown → 单行纯文本。只用于索引里的首段摘要，不追求排版还原。 */
function toPlainText(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/~~~[\s\S]*?~~~/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/<[^>]+>/g, " ")
		.replace(/^\s{0,3}>\s?/gm, " ")
		.replace(/^#{1,6}\s+/gm, " ")
		.replace(/[*_`~|]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function extractHeadings(markdown: string): string[] {
	const headings: string[] = [];
	for (const match of markdown.matchAll(/^#{2,4}\s+(.+)$/gm)) {
		const heading = match[1].replace(/[*_`#]/g, "").trim();
		if (!heading) continue;
		headings.push(
			heading.length > MAX_HEADING_CHARS
				? heading.slice(0, MAX_HEADING_CHARS)
				: heading,
		);
		if (headings.length >= MAX_HEADINGS) break;
	}
	return headings;
}

function toCategories(category: string | string[] | undefined): string {
	if (Array.isArray(category)) return category.filter(Boolean).join(" / ");
	return category ?? "";
}

export async function GET(_context: APIContext) {
	const posts = await getSortedPosts();

	const payload = {
		generatedAt: new Date().toISOString(),
		count: posts.length,
		posts: posts.map((post) => ({
			title: post.data.title,
			slug: post.slug,
			url: getPostUrlBySlug(post.slug),
			category: toCategories(post.data.category),
			tags: post.data.tags ?? [],
			published: post.data.published.toISOString().slice(0, 10),
			headings: extractHeadings(post.body ?? ""),
			excerpt: toPlainText(post.body ?? "").slice(0, EXCERPT_CHARS),
		})),
	};

	return new Response(JSON.stringify(payload), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			// 和文章一样是构建期产物：短暂缓存即可，改了文章要重新构建
			"Cache-Control": "public, max-age=600",
		},
	});
}
