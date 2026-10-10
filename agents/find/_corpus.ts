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

/** 主站 —— 索引就是它的静态文件，agent 直接去这里拉，不去猜域名 */
const DEFAULT_SITE_ORIGIN = 'https://blog.meowrain.cn';

/**
 * 站点源站。刻意不从请求头推：平台把请求转给 agent 时会把 Host / x-forwarded-host
 * 换成内部域名（线上实测 pages-pro-8-e0af.pages-scf-bj-pro.qcloudteo.com，那个域名下
 * 连 / 和 /robots.txt 都是 404），索引永远拉不到；而且这两个头客户端可以随便伪造，
 * 等于把「去哪个站拉索引」交给访客。想指到别的部署（比如本地 dev）用环境变量 SITE_ORIGIN。
 */
export function siteOrigin(env: Record<string, string | undefined> | undefined): string {
	const configured = env?.SITE_ORIGIN?.trim();
	return (configured || DEFAULT_SITE_ORIGIN).replace(/\/+$/, '');
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
