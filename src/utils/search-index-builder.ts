import { getSortedPosts } from "./content-utils";
import {
	CHUNKS_PER_FILE,
	SHARD_COUNT,
	type ShardPayload,
	encodePostings,
	extractHeadings,
	shardForTerm,
	splitChunks,
	toPlainText,
	tokenizeDocument,
} from "./search-index";
import { getPostTags, resolveTagNames, tagKey } from "./tag-utils";
import { getPostUrlBySlug } from "./url-utils";

/**
 * 构建期生成搜索索引。三个端点共用同一份结果：
 * - `/posts-index.json`：文章元信息（导航栏搜索、find agent）；
 * - `/search-index/shard/[shard].json`：分片倒排表；
 * - `/search-index/body/[doc]/[group].json`：正文块，用于生成命中位置的摘要。
 *
 * Astro 静态构建会在同一进程里依次调用这些端点，所以结果缓存在模块级 Promise 上：
 * 141 篇正文只读一次、只切一次词。索引与文档集合是构建期不变量，不需要 TTL。
 */

const EXCERPT_CHARS = 220;

export interface IndexedPostMeta {
	/** 与倒排表里的文档号一致；也是正文块文件路径里的一级。 */
	id: number;
	title: string;
	slug: string;
	url: string;
	category: string;
	series: string;
	/** 章节序号，没写的按发布时间排 —— agent 的 read_series 靠它复刻 /series/ 的顺序。 */
	seriesOrder?: number;
	tags: string[];
	/** 只到天，够展示用；排序要精确到秒，用 publishedAt。 */
	published: string;
	/**
	 * 完整发布时间戳（ISO）。`published` 砍到天后，同一天发的文章在索引里完全并列，
	 * 而 `/series/` 页面用的是带时分秒的 Date —— JUC 就有 10 章同日发布，
	 * 只靠 `published` 排出来的章节顺序会和站点对不上。
	 */
	publishedAt: string;
	headings: string[];
	excerpt: string;
	/** 正文块总数，客户端据此推算需要哪些正文文件。 */
	chunks: number;
}

export interface BodyFile {
	doc: number;
	group: number;
	/** 文件里第一块的全局块号；后续块依次 +1。 */
	start: number;
	chunks: string[];
}

export interface SearchArtifacts {
	generatedAt: string;
	posts: IndexedPostMeta[];
	shards: ShardPayload[];
	bodies: BodyFile[];
	stats: {
		documents: number;
		terms: number;
		chunks: number;
		bodyFiles: number;
	};
}

function toCategories(category: string | string[] | undefined): string {
	if (Array.isArray(category)) return category.filter(Boolean).join(" / ");
	return category ?? "";
}

function groupChunks(docId: number, chunks: string[]): BodyFile[] {
	const files: BodyFile[] = [];
	for (let group = 0; group * CHUNKS_PER_FILE < chunks.length; group++) {
		const start = group * CHUNKS_PER_FILE;
		files.push({
			doc: docId,
			group,
			start,
			chunks: chunks.slice(start, start + CHUNKS_PER_FILE),
		});
	}
	return files;
}

async function build(): Promise<SearchArtifacts> {
	const posts = await getSortedPosts();
	// 标签规范名：索引里统一写 Java / MySQL，客户端筛选下拉和搜索结果标签都靠它
	const tagNames = resolveTagNames(posts.map((post) => getPostTags(post)));

	const termPostings = new Map<string, Map<number, Set<number>>>();
	const metas: IndexedPostMeta[] = [];
	const bodies: BodyFile[] = [];
	let totalChunks = 0;

	for (const [docId, post] of posts.entries()) {
		const body = post.body ?? "";
		const plain = toPlainText(body);
		const chunks = splitChunks(plain);
		totalChunks += chunks.length;

		for (const [chunkIndex, chunk] of chunks.entries()) {
			for (const term of tokenizeDocument(chunk)) {
				let perDoc = termPostings.get(term);
				if (!perDoc) {
					perDoc = new Map();
					termPostings.set(term, perDoc);
				}
				let chunkIds = perDoc.get(docId);
				if (!chunkIds) {
					chunkIds = new Set();
					perDoc.set(docId, chunkIds);
				}
				chunkIds.add(chunkIndex);
			}
		}

		bodies.push(...groupChunks(docId, chunks));

		metas.push({
			id: docId,
			title: post.data.title,
			slug: post.slug,
			url: getPostUrlBySlug(post.slug),
			category: toCategories(post.data.category),
			series: post.data.series ?? "",
			seriesOrder: post.data.seriesOrder,
			tags: getPostTags(post).map(
				(tag) => tagNames.get(tagKey(tag)) ?? tag.trim(),
			),
			published: post.data.published.toISOString().slice(0, 10),
			publishedAt: post.data.published.toISOString(),
			headings: extractHeadings(body),
			excerpt: plain.slice(0, EXCERPT_CHARS),
			chunks: chunks.length,
		});
	}

	const shards: ShardPayload[] = Array.from(
		{ length: SHARD_COUNT },
		() => ({}),
	);
	for (const [term, perDoc] of termPostings) {
		shards[shardForTerm(term)][term] = encodePostings(perDoc);
	}

	return {
		generatedAt: new Date().toISOString(),
		posts: metas,
		shards,
		bodies,
		stats: {
			documents: metas.length,
			terms: termPostings.size,
			chunks: totalChunks,
			bodyFiles: bodies.length,
		},
	};
}

let artifacts: Promise<SearchArtifacts> | null = null;

/** 同一个构建进程里只算一次；失败的 Promise 不缓存，下一次调用会重试。 */
export function getSearchArtifacts(): Promise<SearchArtifacts> {
	if (!artifacts) {
		artifacts = build().catch((error) => {
			artifacts = null;
			throw error;
		});
	}
	return artifacts;
}
