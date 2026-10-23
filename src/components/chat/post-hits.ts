/**
 * 工具结果 → 文章卡片数据。
 *
 * `search_posts` / `list_recent_posts` 都把命中放在 `posts` 数组里，字段不完全一样：
 * - search_posts：title / url / published / category / tags / snippet（+ 可选的 matchedHeadings）
 * - list_recent_posts：title / url / published / category
 * - 本次请求里已经返回过的命中：只有 title / url / seen: true —— 那篇的卡片前面已经渲染过，跳过
 */

export interface ChatPostHit {
	title: string;
	url: string;
	published?: string;
	category?: string;
	tags: string[];
	snippet?: string;
}

export function toolPostHits(content?: string): ChatPostHit[] {
	if (!content) return [];
	try {
		const parsed = JSON.parse(content);
		if (!Array.isArray(parsed?.posts)) return [];

		const seen = new Set<string>();
		const hits: ChatPostHit[] = [];
		for (const post of parsed.posts) {
			const url = String(post?.url ?? "");
			if (!url || seen.has(url)) continue;
			seen.add(url);
			if (post?.seen) continue;
			hits.push({
				title: String(post?.title ?? "") || url,
				url,
				published: post?.published ? String(post.published) : undefined,
				category: post?.category ? String(post.category) : undefined,
				tags: Array.isArray(post?.tags) ? post.tags.map(String) : [],
				snippet: post?.snippet ? String(post.snippet) : undefined,
			});
		}
		return hits;
	} catch {
		// 解析不了就不出卡片，原始内容在「查看返回内容」里
		return [];
	}
}
