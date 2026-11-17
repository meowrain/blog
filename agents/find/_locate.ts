/**
 * url / slug → 语料里的文章 + 文档号。
 *
 * 正文块端点的路径是 `/search-index/body/{doc}/{group}.json`，doc 就是 `/posts-index.json`
 * 里每条 `posts[i].id`（见 src/pages/posts-index.json.ts）。这个号**只能从语料里查出来**：
 * 猜错一个数字就会把别人的正文递回给模型，性质等同数据泄露。所以查不到就返回 null，
 * 由调用方如实报错，绝不做「差不多就行」的匹配。
 *
 * 本文件刻意没有任何 import：纯函数，能被 `pnpm test` 直接跑。
 */

export interface LocatablePost {
	slug: string;
	/** 文档号，与倒排表、正文块文件路径一致；缺失时按「找不到」处理，不退化成数组下标 */
	id?: number;
}

export interface PostRef<T extends LocatablePost> {
	post: T;
	id: number;
}

/**
 * 从站内链接、带域名的完整链接或纯 slug 里取出 slug（不含 `/posts/` 前缀与首尾斜杠）。
 * 认这几种写法：`/posts/合集/ssm/`、`https://blog.meowrain.cn/posts/pin/`、`合集/ssm`、
 * 带查询串或 hash 的链接、中文被百分号编码过的链接。
 */
export function slugFromUrl(input: string): string {
	let raw = input.trim();
	if (!raw) return '';
	raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, ''); // 去协议 + 域名
	raw = raw.replace(/[?#].*$/, ''); // 去查询串 / hash
	try {
		raw = decodeURIComponent(raw);
	} catch {
		// 坏掉的百分号编码（比如 slug 里本来就有 %）：按原样再比一次
	}
	raw = raw.replace(/^\/+|\/+$/g, '');
	raw = raw.replace(/^posts\//, '');
	raw = raw.replace(/\/index\.html$/, '');
	raw = raw.replace(/\/+$/, '');
	// `/posts/` 这种只有前缀的输入，取出来是空的 —— 那是「没给文章」，不是一篇叫 posts 的文章
	return raw === 'posts' ? '' : raw;
}

function docIdOf(post: LocatablePost): number | null {
	const id = post.id;
	return typeof id === 'number' && Number.isInteger(id) && id >= 0 ? id : null;
}

/**
 * 在语料里按 url / slug 找文章。精确匹配优先；大小写不一致的手敲链接再宽容一次，
 * 但只认「唯一命中」—— 两篇只差大小写的文章宁可返回找不到，也不能二选一碰运气。
 */
export function locatePost<T extends LocatablePost>(
	posts: T[],
	input: string,
): PostRef<T> | null {
	const slug = slugFromUrl(input);
	if (!slug) return null;

	const exact = posts.find((post) => post.slug === slug);
	const hit = exact ?? uniqueIgnoreCase(posts, slug);
	if (!hit) return null;

	const id = docIdOf(hit);
	return id === null ? null : { post: hit, id };
}

function uniqueIgnoreCase<T extends LocatablePost>(
	posts: T[],
	slug: string,
): T | null {
	const wanted = slug.toLowerCase();
	const matches = posts.filter((post) => post.slug.toLowerCase() === wanted);
	return matches.length === 1 ? matches[0] : null;
}
