import { createLogger } from './_shared';

const logger = createLogger('music');

/**
 * 音乐搜索客户端 —— 打的是本站的 `/api/music/search` 与 `/api/music/artist`
 * （见 cloud-functions/api/music/[[default]].js）。
 *
 * ## 为什么绕自己站点一圈
 *
 * 网易云的上游接口要 UA / Referer / Cookie，还不返回 CORS 头，agent 运行时直接
 * 打过去拿不到数据（也不能把 NETEASE_COOKIE 散到 agent 里）。站点的云函数已经
 * 处理好了这些，agent 只需要一个 HTTP 请求 —— 和 `_corpus.ts` 拉 `/posts-index.json`
 * 是同一条路。
 *
 * ## 两个曲库
 *
 * 默认 `source=all`：网易云 + QQ 音乐各问一遍再合并。不是重复劳动 ——
 * 实测两家的免费曲库不重合：
 *
 *   网易云完全空（一首能放的都没有）：毛不易、梁博、郭顶
 *   QQ 完全空（整页要会员）：周杰伦、许嵩、陈奕迅、林俊杰
 *   两边都行的（花粥、房东的猫、陈鸿宇）曲目也只是部分重叠
 *
 * 只问一家就会漏掉另一家独有的歌手，让模型白白「搜不到、如实告诉访客」。
 *
 * ## 这个搜索能干什么、不能干什么
 *
 * 实测：搜歌手名、歌名很准（花粥 12 首里 11 首能播）；搜题材（"适合写代码"）
 * 基本是字面匹配，捞回来一堆歌名里带这些字的歌。所以语义那一步交给模型
 * （先用 web_search 查"深夜写代码听什么"，拿到歌手/歌名再回这里精确取歌），
 * 别指望这个接口自己懂意图。
 *
 * 返回的每一首都已经探过可播放性 —— 同名翻唱、无版权的一大堆，
 * 不滤的话访客点下去没声音。
 */

const TIMEOUT_MS = 15_000;
/** 同一次会话里，同样的查询没必要重打一遍站点；搜索结果的能播率也会变，所以不能缓存太久 */
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 40;

export interface MusicHit {
	id: string;
	name: string;
	artists: string;
	album: string;
	/** 毫秒 */
	duration: number;
	cover: string;
	/** 曲库：网易云 id 是纯数字，QQ 是 base62 的 songmid，播放/歌词接口按它分流 */
	source?: 'netease' | 'qq';
	/** 会员曲目在没配 Cookie 时只能试听 30 秒 */
	trial?: boolean;
	/** 开头几行歌词（只有请求了 lyric 才带） */
	lyric?: string;
	/** 同一批结果里有同名不同版（翻唱 / Live / DJ 版） */
	sameName?: boolean;
}

export interface MusicSearchResponse {
	query?: string;
	count: number;
	/** 上游搜到多少条（滤掉不能播的之前） */
	found?: number;
	results: MusicHit[];
	artist?: { id: string; name: string; pic: string } | null;
}

interface CacheEntry {
	at: number;
	value: MusicSearchResponse;
}

const cache = new Map<string, CacheEntry>();

function cached(key: string): MusicSearchResponse | null {
	const entry = cache.get(key);
	if (!entry) return null;
	if (Date.now() - entry.at > CACHE_TTL_MS) {
		cache.delete(key);
		return null;
	}
	return entry.value;
}

function remember(key: string, value: MusicSearchResponse): MusicSearchResponse {
	// 简单淘汰：Map 保持插入顺序，超了就从最旧的开始删
	if (cache.size >= CACHE_MAX_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(key, { at: Date.now(), value });
	return value;
}

function toHit(raw: Record<string, unknown>): MusicHit | null {
	const id = String(raw?.id ?? '').trim();
	const name = String(raw?.name ?? '').trim();
	if (!id || !name) return null;
	const source = raw?.source === 'qq' ? 'qq' : raw?.source === 'netease' ? 'netease' : undefined;
	return {
		id,
		name,
		artists: String(raw?.artists ?? '').trim() || '未知歌手',
		album: String(raw?.album ?? '').trim(),
		duration: Number(raw?.duration) || 0,
		cover: String(raw?.cover ?? '').trim(),
		...(source ? { source } : {}),
		...(raw?.trial ? { trial: true } : {}),
		...(typeof raw?.lyric === 'string' && raw.lyric ? { lyric: raw.lyric } : {}),
		...(raw?.sameName ? { sameName: true } : {}),
	};
}

/** 把站点返回的原样 JSON 收成工具能用的形状；解析失败当作一次失败而不是空结果 */
function normalize(data: unknown): MusicSearchResponse {
	const root = (data ?? {}) as Record<string, unknown>;
	const list = Array.isArray(root.results) ? root.results : [];
	const results = list
		.map((item) => toHit(item as Record<string, unknown>))
		.filter((hit): hit is MusicHit => hit !== null);
	const artist = root.artist as { id?: string; name?: string; pic?: string } | null | undefined;
	return {
		...(typeof root.query === 'string' && root.query ? { query: root.query } : {}),
		count: results.length,
		...(Number.isFinite(Number(root.found)) ? { found: Number(root.found) } : {}),
		results,
		...(artist
			? { artist: { id: String(artist.id ?? ''), name: String(artist.name ?? ''), pic: String(artist.pic ?? '') } }
			: {}),
	};
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, TIMEOUT_MS);
	const onAbort = () => controller.abort();
	if (signal) {
		if (signal.aborted) onAbort();
		else signal.addEventListener('abort', onAbort, { once: true });
	}

	try {
		const resp = await fetch(url, {
			headers: { Accept: 'application/json' },
			signal: controller.signal,
		});
		if (!resp.ok) {
			const detail = await resp.text().catch(() => '');
			throw new Error(`HTTP ${resp.status}${detail ? `：${detail.slice(0, 120)}` : ''}`);
		}
		return await resp.json();
	} catch (e) {
		if (timedOut) throw new Error(`音乐接口超时（${TIMEOUT_MS / 1000}s）`);
		throw e;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
	}
}

/**
 * 曲库。`all` 会让云函数把网易云和 QQ 都问一遍再合并 —— 两家的免费曲库不重合，
 * 「毛不易/梁博/郭顶」在网易云一首能放的都没有，QQ 能捞出几首；
 * 「周杰伦/许嵩/陈奕迅」反过来只在网易云有。见 cloud-functions/_qqmusic.js。
 */
export type MusicSource = 'netease' | 'qq' | 'all';

export interface SearchOptions {
	origin: string;
	query: string;
	limit?: number;
	/** 顺带取每首的开头几行歌词 —— 模型没听过歌，只给歌名写不出串词 */
	lyric?: boolean;
	source?: MusicSource;
	signal?: AbortSignal;
}

export async function searchMusic({ origin, query, limit = 8, lyric = false, source = 'all', signal }: SearchOptions): Promise<MusicSearchResponse> {
	const key = `search|${source}|${query}|${limit}|${lyric ? 1 : 0}`;
	const hit = cached(key);
	if (hit) return hit;

	// 路径尾斜杠不能省：astro dev 的 trailingSlash:"always" 会把无斜杠的 /api/music/search
	// 当成页面路由直接 404（线上云函数两种写法都认）。前端播放器也是这么拼的。
	const url = new URL('/api/music/search/', origin);
	url.searchParams.set('q', query);
	url.searchParams.set('limit', String(limit));
	if (source !== 'netease') url.searchParams.set('source', source);
	if (lyric) url.searchParams.set('lyric', '1');

	const value = normalize(await getJson(url.toString(), signal));
	logger.log(
		'search q=%s source=%s lyric=%s results=%d found=%s',
		query,
		source,
		lyric ? 'y' : 'n',
		value.count,
		value.found ?? '-',
	);
	return remember(key, value);
}

export interface ArtistOptions {
	origin: string;
	/** 歌手名（会先搜一次歌手，匹配不了就按关键词搜歌兜底） */
	name?: string;
	/** 歌手 id，确定时直接用，省一次搜索（只有网易云有） */
	id?: string;
	limit?: number;
	signal?: AbortSignal;
}

export async function artistMusic({ origin, name, id, limit = 8, signal }: ArtistOptions): Promise<MusicSearchResponse> {
	// QQ 那边只认歌手名，所以按名字取歌时顺带把两边都问一遍；给了 id 就只能问网易云。
	const source: MusicSource = !id && name ? 'all' : 'netease';
	const key = `artist|${source}|${id ?? ''}|${name ?? ''}|${limit}`;
	const hit = cached(key);
	if (hit) return hit;

	const url = new URL('/api/music/artist/', origin);
	if (id) url.searchParams.set('id', id);
	else if (name) url.searchParams.set('q', name);
	else throw new Error('artistMusic 需要 name 或 id');
	url.searchParams.set('limit', String(limit));
	if (source !== 'netease') url.searchParams.set('source', source);

	const value = normalize(await getJson(url.toString(), signal));
	logger.log('artist %s source=%s results=%d', id || name, source, value.count);
	return remember(key, value);
}

/**
 * `radio_play` 的 id 白名单。
 *
 * 模型拼错一个 id、或者从搜索结果里顺手套个别的数字，都会让访客点到一首
 * 根本没出现过的歌。这里只认「本次请求里真的搜出来过」的曲目 —— ctx 里
 * 存一份，工具按它校验，不合法的一律拒掉并如实回灌。
 */
export function rememberTracks(store: Map<string, MusicHit>, hits: MusicHit[]): void {
	for (const hit of hits) store.set(hit.id, hit);
}
