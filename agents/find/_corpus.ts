import { createLogger } from '../_shared';

const logger = createLogger('find');

export interface PostRecord {
	title: string;
	slug: string;
	url: string;
	category: string;
	tags: string[];
	published: string;
	headings: string[];
	excerpt: string;
}

/**
 * 站内索引由构建期端点 `/posts-index.json` 生成（约 110KB / 140 篇）。
 * 工具在服务端用它做检索，模型永远看不到整份索引 —— 只有工具挑出来的几条会被回灌。
 *
 * 索引放模块内存缓存：同一实例上的后续请求不再重复拉。
 */
const CACHE_TTL_MS = 10 * 60 * 1000;

let cache: { at: number; posts: PostRecord[] } | null = null;
let inflight: Promise<PostRecord[]> | null = null;

/** 从请求头推自己的站点源站 —— agent 直接拉自己站点的静态索引，不去猜域名 */
export function originOf(headers: Record<string, string | undefined> | undefined): string {
	const host = (headers?.['x-forwarded-host'] || headers?.host || '').trim();
	if (!host) throw new Error('拿不到 host，无法定位站内索引');
	// x-forwarded-proto 可能是逗号分隔的一串，只取第一段
	const forwardedProto = (headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
	const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
	return `${forwardedProto || (isLocal ? 'http' : 'https')}://${host}`;
}

export async function loadCorpus(origin: string): Promise<PostRecord[]> {
	if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.posts;
	if (inflight) return inflight; // 冷启动时并发请求共用一个 fetch

	inflight = (async () => {
		const url = `${origin}/posts-index.json`;
		const resp = await fetch(url, { headers: { Accept: 'application/json' } });
		if (!resp.ok) throw new Error(`拉取 ${url} 失败：HTTP ${resp.status}`);
		const data = (await resp.json()) as { posts?: PostRecord[] };
		const posts = Array.isArray(data?.posts) ? data.posts : [];
		if (!posts.length) throw new Error(`${url} 里没有文章`);
		cache = { at: Date.now(), posts };
		logger.log('corpus loaded posts=%d', posts.length);
		return posts;
	})();

	try {
		return await inflight;
	} finally {
		inflight = null;
	}
}
