import { getSearchArtifacts } from "@utils/search-index-builder";
import type { APIContext } from "astro";

/**
 * 站内文章索引，有两个消费者：
 * - `/find` agent 的 `search_posts` 工具（服务端拉取）；
 * - 导航栏搜索面板（`src/components/Search.svelte`，客户端拉取）。
 * 搜索面板复用同一份索引，不再解析整份 `/rss.xml`。
 *
 * 为什么带 headings：全站 description 加起来不到 1k 字符（绝大多数文章没写摘要），
 * 而「ABA 问题」「插入屏蔽」这类主题只出现在小节标题里，光靠标题和首段找不到。
 *
 * 这里只放元信息（约 120KB / 141 篇）。正文词走 `/search-index/` 下的分片倒排表，
 * 两边由 `search-index-builder` 一次构建、共用文档号，不会错位。
 */
export async function GET(_context: APIContext) {
	const { generatedAt, posts } = await getSearchArtifacts();

	const payload = {
		generatedAt,
		count: posts.length,
		posts: posts.map(({ chunks: _chunks, ...post }) => post),
	};

	return new Response(JSON.stringify(payload), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			// 和文章一样是构建期产物：短暂缓存即可，改了文章要重新构建
			"Cache-Control": "public, max-age=600",
		},
	});
}
