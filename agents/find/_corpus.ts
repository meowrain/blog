import { createLogger } from '../_shared';
import { parseIndexVersion } from '../../src/utils/search-core';
import { SHARD_COUNT, type ChunkGroup, type ShardPayload } from '../../src/utils/search-index';

const logger = createLogger('find');

export interface PostRecord {
	/**
	 * 文档号。`/posts-index.json` 里每条都带，与倒排表、正文块文件路径
	 * `/search-index/body/{id}/{group}.json` 用的是同一个号（见 src/pages/posts-index.json.ts）。
	 * read_post 靠它拉正文，所以类型上标成必需：缺了就当「找不到这篇文章」，不许拿数组下标顶上。
	 */
	id: number;
	title: string;
	slug: string;
	url: string;
	category: string;
	/** 系列名，空串表示不属于任何系列 */
	series: string;
	/** 章节序号，没写的按发布时间排 */
	seriesOrder?: number;
	/** 只到天，展示用 */
	published: string;
	/** 完整时间戳，系列章节排序用（同日发布靠它分先后） */
	publishedAt?: string;
	tags: string[];
	headings: string[];
	excerpt: string;
}

/** 一次索引拉取的完整结果：文章元信息 + 这份索引的构建版本 */
export interface CorpusSnapshot {
	posts: PostRecord[];
	version: string;
}

/**
 * 站内索引由构建期端点 `/posts-index.json` 生成（约 110KB / 140 篇）。
 * 工具在服务端用它做检索，模型永远看不到整份索引 —— 只有工具挑出来的几条会被回灌。
 *
 * 索引放模块内存缓存：同一实例上的后续请求不再重复拉。
 */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** 分片全量 128 片、gzip 后每片几 KB，常驻内存约 1MB，直接按分片数封顶 */
const SHARD_CACHE_LIMIT = SHARD_COUNT;
/** 正文块是摘要用的临时数据，按最近用过的若干组封顶，别让它无限涨 */
const BODY_CACHE_LIMIT = 256;

/** 单次请求超时：卡住比报错更糟，超时至少能让工具降级到元信息检索 */
const FETCH_TIMEOUT_MS = 20_000;

let cache: { at: number; snapshot: CorpusSnapshot } | null = null;
let inflight: Promise<CorpusSnapshot> | null = null;

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

/** 带超时的 JSON 拉取；失败返回 null 并记一条日志，调用方负责降级 */
async function fetchJson(url: string): Promise<unknown | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const resp = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
		if (!resp.ok) {
			logger.error('拉取 %s 失败：HTTP %d', url, resp.status);
			return null;
		}
		return (await resp.json()) as unknown;
	} catch (e) {
		const error = e as Error;
		logger.error('拉取 %s 失败：%s', url, error.name === 'AbortError' ? `超时 ${FETCH_TIMEOUT_MS / 1000}s` : error.message);
		return null;
	} finally {
		clearTimeout(timer);
	}
}

async function loadSnapshot(origin: string): Promise<CorpusSnapshot> {
	if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.snapshot;
	if (inflight) return inflight; // 冷启动时并发请求共用一个 fetch

	inflight = (async () => {
		const url = `${origin}/posts-index.json`;
		const payload = await fetchJson(url);
		if (!payload) throw new Error(`拉取 ${url} 失败`);
		const data = payload as { posts?: PostRecord[] };
		const posts = Array.isArray(data?.posts) ? data.posts : [];
		if (!posts.length) throw new Error(`${url} 里没有文章`);
		const version = parseIndexVersion(payload);
		const snapshot = { posts, version };
		cache = { at: Date.now(), snapshot };
		logger.log('corpus loaded posts=%d version=%s', posts.length, version || '-');
		return snapshot;
	})();

	try {
		return await inflight;
	} finally {
		inflight = null;
	}
}

export async function loadCorpus(origin: string): Promise<PostRecord[]> {
	return (await loadSnapshot(origin)).posts;
}

/**
 * 当前索引的构建版本（`/posts-index.json` 的 `generatedAt`）。
 *
 * 文档号是「按发布时间排序后的数组下标」，加一篇新文章会让它后面的文章整体位移，
 * 所以分片和正文块的请求都要带上版本号，缓存也必须按版本分桶。
 */
export async function loadIndexVersion(origin: string): Promise<string> {
	return (await loadSnapshot(origin)).version;
}

interface VersionedCache<T> {
	version: string;
	entries: Map<string, { at: number; value: T }>;
	inflight: Map<string, Promise<T | null>>;
}

/** 按 build version 分桶的缓存：版本一变整桶作废，旧缓存不会指向错位的文档 */
function createVersionedCache<T>(): VersionedCache<T> {
	return { version: '\u0000', entries: new Map(), inflight: new Map() };
}

function remember<T>(bucket: VersionedCache<T>, key: string, value: T, limit: number): void {
	bucket.entries.set(key, { at: Date.now(), value });
	while (bucket.entries.size > limit) {
		const oldest = bucket.entries.keys().next();
		if (oldest.done) break;
		bucket.entries.delete(oldest.value);
	}
}

const shardCache = createVersionedCache<ShardPayload>();
const bodyCache = createVersionedCache<ChunkGroup>();

/** 把缓存切到指定版本；版本变了就把旧内容整份丢掉 */
function useVersion<T>(bucket: VersionedCache<T>, version: string): void {
	if (bucket.version === version) return;
	if (bucket.entries.size) {
		logger.log('索引版本变更 %s → %s，丢弃 %d 项缓存', bucket.version, version, bucket.entries.size);
	}
	bucket.version = version;
	bucket.entries.clear();
	bucket.inflight.clear();
}

interface CacheStats {
	hit: number;
	miss: number;
}

interface CachedLoader<T> {
	/** 缓存命中直接返回；未命中走 fetch，失败不缓存 */
	get(key: string, url: string, version: string): Promise<T | null>;
	stats: CacheStats;
}

function cachedLoader<T>(bucket: VersionedCache<T>, limit: number, parse: (payload: unknown) => T | null): CachedLoader<T> {
	const stats: CacheStats = { hit: 0, miss: 0 };
	return {
		stats,
		async get(key: string, url: string, version: string): Promise<T | null> {
			const hit = bucket.entries.get(key);
			if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
				stats.hit += 1;
				return hit.value;
			}
			stats.miss += 1;
			const running = bucket.inflight.get(key);
			if (running) return running;
			const task = (async () => {
				const payload = await fetchJson(url);
				if (payload === null) return null;
				const value = parse(payload);
				if (value === null) {
					logger.error('%s 内容格式不对，跳过', url);
					return null;
				}
				// 请求在途时版本可能已经变了（重新构建过），旧版本的数据不能写进新桶
				if (bucket.version === version) remember(bucket, key, value, limit);
				return value;
			})();
			bucket.inflight.set(key, task);
			try {
				return await task;
			} finally {
				bucket.inflight.delete(key);
			}
		},
	};
}

function versionSuffix(version: string): string {
	return version ? `?v=${version}` : '';
}

/** 分片 / 正文块的 URL 都要带版本号，版本号统一从（已缓存的）索引里取 */
async function versionOf(origin: string): Promise<string> {
	try {
		return await loadIndexVersion(origin);
	} catch {
		return ''; // 索引都没拉到就别谈分片了，请求照样发出去让它自己失败
	}
}

const shardLoader = cachedLoader<ShardPayload>(shardCache, SHARD_CACHE_LIMIT, (payload) =>
	payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as ShardPayload) : null,
);

const bodyLoader = cachedLoader<ChunkGroup>(bodyCache, BODY_CACHE_LIMIT, (payload) => {
	const data = payload as Partial<ChunkGroup> | null;
	if (!data || !Array.isArray(data.chunks) || typeof data.start !== 'number') return null;
	return { start: data.start, chunks: data.chunks.filter((c): c is string => typeof c === 'string') };
});

/**
 * 按需拉取若干分片倒排表。任何一片失败都返回 null —— 让调用方降级到元信息检索，
 * 而不是拿半份倒排表硬算（AND 语义下缺片等于把命中全丢掉，静默少结果比降级更坏）。
 */
export async function loadShards(
	origin: string,
	shardIds: readonly number[],
): Promise<Map<number, ShardPayload> | null> {
	const version = await versionOf(origin);
	useVersion(shardCache, version);
	const suffix = versionSuffix(version);
	const started = Date.now();
	const entries = await Promise.all(
		shardIds.map(async (shard) => {
			const payload = await shardLoader.get(
				`${origin}#${shard}`,
				`${origin}/search-index/shard/${shard}.json${suffix}`,
				version,
			);
			return payload ? ([shard, payload] as const) : null;
		}),
	);
	const failed = entries.filter((entry) => entry === null).length;
	if (failed > 0) {
		logger.error('分片拉取失败 %d/%d，本次搜索降级为元信息检索', failed, shardIds.length);
		return null;
	}
	logger.log(
		'分片 %d 片 version=%s %dms 累计命中/未命中 %d/%d',
		shardIds.length,
		version || '-',
		Date.now() - started,
		shardLoader.stats.hit,
		shardLoader.stats.miss,
	);
	return new Map(entries.filter((entry): entry is readonly [number, ShardPayload] => entry !== null));
}

/** 拉一组正文块（命中摘要用）。失败返回 null，该条结果用 excerpt 兜底。 */
export async function loadBodyChunks(origin: string, doc: number, group: number): Promise<ChunkGroup | null> {
	const version = await versionOf(origin);
	useVersion(bodyCache, version);
	const suffix = versionSuffix(version);
	return bodyLoader.get(
		`${origin}#${doc}/${group}`,
		`${origin}/search-index/body/${doc}/${group}.json${suffix}`,
		version,
	);
}

/** 碎碎念。`title` 已由端点做过回退（没写标题时用正文首句），工具直接用。 */
export interface NoteRecord {
	published: string;
	title: string;
	tags: string[];
	mood: string;
	location: string;
	pinned: boolean;
	excerpt: string;
	url: string;
}

export interface NoteCorpus {
	notes: NoteRecord[];
	/** 封存中（`unlockAt` 还没到）的条数 —— 这些条目在索引里根本不存在，只有这个数字 */
	sealedCount: number;
}

/**
 * 碎碎念索引 `/notes-index.json`（十来条，几 KB），和文章走的 `/posts-index.json` 是一套路子。
 * 封存中的时间胶囊由端点直接滤掉，服务端拿到的只有能公开讲的部分：
 * 红线留在构建期守一次，工具这边不用再判断日期。
 */
let noteCache: { at: number; data: NoteCorpus } | null = null;
let noteInflight: Promise<NoteCorpus> | null = null;

export async function loadNotes(origin: string): Promise<NoteCorpus> {
	if (noteCache && Date.now() - noteCache.at < CACHE_TTL_MS) return noteCache.data;
	if (noteInflight) return noteInflight;

	noteInflight = (async () => {
		const url = `${origin}/notes-index.json`;
		const resp = await fetch(url, { headers: { Accept: 'application/json' } });
		if (!resp.ok) throw new Error(`拉取 ${url} 失败：HTTP ${resp.status}`);
		const data = (await resp.json()) as { notes?: NoteRecord[]; sealedCount?: number };
		// 碎碎念可能真的是 0 条（新站），空数组不算失败
		const payload: NoteCorpus = {
			notes: Array.isArray(data?.notes) ? data.notes : [],
			sealedCount: Number.isFinite(data?.sealedCount) ? Number(data.sealedCount) : 0,
		};
		noteCache = { at: Date.now(), data: payload };
		logger.log('notes loaded notes=%d sealed=%d', payload.notes.length, payload.sealedCount);
		return payload;
	})();

	try {
		return await noteInflight;
	} finally {
		noteInflight = null;
	}
}
