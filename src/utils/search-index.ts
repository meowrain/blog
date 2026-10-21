/**
 * 全文倒排索引的分片编码 / 解码，构建期（Node）和浏览器共用。
 *
 * 为什么自己做而不是上 Pagefind：Pagefind 对中日韩是字符级 OR 匹配
 * （`k8s` 会命中 KNN、`线程池` 命中所有「线程」），而且 `data()` 会把整篇正文
 * 拉回浏览器（本站有单篇 180KB 的合集，实测一次搜索能到 1MB）。
 *
 * 这里的做法：
 * - 建索引时同一套切词（中文 bigram + 词 + 单字，英文整词）；
 * - 词表按 FNV-1a 哈希分到 `SHARD_COUNT` 个分片，客户端只拉查询词命中的分片；
 * - 每个词的倒排表记「文档号 → 命中的正文块号」，摘要在浏览器里按块拉原文；
 * - 文档号就是 `/posts-index.json` 里 `posts` 的数组下标，两个端点由同一函数生成。
 *
 * 编码格式（尽量短，gzip 后每片几 KB）：
 * 倒排表 = `docDelta[.chunk.chunk...],docDelta...`，数字一律 base36。
 */

/**
 * 分片数：越多每片越小，但查询时的请求数会变多。
 * 128 片下本站（141 篇）每片 gzip 后不超过 8KB，一次查询通常只拉 2～5 片。
 */
export const SHARD_COUNT = 128;

/**
 * 正文分块长度（字符）。块是「按需拉取摘要」的最小单位：
 * 太大摘要请求变重，太小倒排表里的块号变多。
 */
export const CHUNK_CHARS = 1800;

/**
 * 每个正文文件装几块。块文件是对外暴露的最小请求单位：
 * 4 块约 7KB 原文，gzip 后 3KB 左右，只拉命中结果所在的那一组。
 * 合集类长文会被切成多组，摘要通常落在第一组，不会连带整篇。
 */
export const CHUNKS_PER_FILE = 4;

/** 块号 → 块文件号。 */
export function chunkGroupOf(chunkIndex: number): number {
	return Math.floor(chunkIndex / CHUNKS_PER_FILE);
}

/** 单个分片的 JSON：term -> 编码后的倒排表。 */
export type ShardPayload = Record<string, string>;

/** 解码后的倒排表：文档号 -> 命中的块号（升序，可能为空表示只命中标题）。 */
export type DecodedPostings = Map<number, number[]>;

/** 一次查询从若干分片里拼出的倒排表：term -> 文档号 -> 块号。 */
export type QueryPostings = Map<string, DecodedPostings>;

/** 一个正文块文件：`start` 是第一块的全局块号。 */
export interface ChunkGroup {
	start: number;
	chunks: string[];
}

const CJK_CHAR_RE = /[\p{Script=Han}]/u;
const HAN_RUN_RE = /[\p{Script=Han}]+|[^\p{Script=Han}]+/gu;
const SEPARATOR_RE = /[\s,，、;；:：|/\\。！？!?"'“”‘’]+/u;
const SENTENCE_END_RE = /[。！？!?；;\n]/;

/** FNV-1a（32 位）：分片归属和浏览器端一致即可，不需要加密强度。 */
export function hashTerm(term: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < term.length; i++) {
		hash ^= term.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
}

/** 词落到哪个分片。 */
export function shardForTerm(term: string): number {
	return hashTerm(term) % SHARD_COUNT;
}

function cleanLatinToken(run: string): string {
	return run
		.replace(/^[^\p{L}\p{N}+#]+/gu, "")
		.replace(/[^\p{L}\p{N}+#]+$/gu, "");
}

/**
 * 建索引用的切词，和查询端 `search-core.tokenize` 保持同一套规则，另外多收单字：
 *
 * - 中文 run 切成 bigram（"线程池" → 线程 / 程池），单字 run 保留；
 * - 另收中文单字，让「锁」这类单字查询也能命中；
 * - 英文/数字整词小写，中英混排按书写系统拆开。
 *
 * 单字只在建索引时收录；查询端仍然按 bigram 切，避免单字把结果放大。
 */
export function tokenizeDocument(text: string): string[] {
	const normalized = text.normalize("NFKC").toLowerCase();
	const seen = new Set<string>();

	const add = (term: string): void => {
		if (term) seen.add(term);
	};

	for (const part of normalized.split(SEPARATOR_RE)) {
		if (!part) continue;
		for (const run of part.match(HAN_RUN_RE) ?? [part]) {
			if (!run) continue;
			if (CJK_CHAR_RE.test(run)) {
				if (run.length <= 2) {
					add(run);
				} else {
					for (let i = 0; i < run.length - 1; i++) add(run.slice(i, i + 2));
				}
				for (const char of run) add(char);
			} else {
				add(cleanLatinToken(run));
			}
		}
	}

	return [...seen];
}

/**
 * 正文切块。优先在标点处断开，避免把词切成两半、也避免摘要从半句话开始。
 * 输入应当已经是单行纯文本。
 */
export function splitChunks(text: string): string[] {
	const chunks: string[] = [];
	let start = 0;

	while (start < text.length) {
		let end = Math.min(text.length, start + CHUNK_CHARS);
		if (end < text.length) {
			// 在块尾前 1/4 的范围里找最后一个句末标点，找不到就硬切
			const windowStart = start + Math.floor(CHUNK_CHARS * 0.75);
			for (let i = end; i > windowStart; i--) {
				if (SENTENCE_END_RE.test(text[i - 1])) {
					end = i;
					break;
				}
			}
			// 不要把代理对从中间切开
			if (end < text.length && /[\uDC00-\uDFFF]/.test(text[end])) end--;
		}
		const chunk = text.slice(start, end).trim();
		if (chunk) chunks.push(chunk);
		start = end;
	}

	return chunks;
}

function encodeNumber(value: number): string {
	return value.toString(36);
}

/** 倒排表编码：文档号用差值，块号升序逗号连接。 */
export function encodePostings(perDoc: Map<number, Set<number>>): string {
	const docIds = [...perDoc.keys()].sort((a, b) => a - b);
	const parts: string[] = [];
	let previous = 0;
	for (const docId of docIds) {
		const chunks = [...(perDoc.get(docId) ?? [])].sort((a, b) => a - b);
		const delta = docId - previous;
		previous = docId;
		if (chunks.length === 0) {
			parts.push(encodeNumber(delta));
		} else {
			parts.push(
				`${encodeNumber(delta)}.${chunks.map(encodeNumber).join(".")}`,
			);
		}
	}
	return parts.join(",");
}

/** 倒排表解码；格式不对的条目直接跳过，不让一条脏数据带崩整个搜索。 */
export function decodePostings(encoded: string | undefined): DecodedPostings {
	const result: DecodedPostings = new Map();
	if (!encoded) return result;

	let previous = 0;
	for (const entry of encoded.split(",")) {
		if (!entry) continue;
		const segments = entry.split(".");
		const delta = Number.parseInt(segments[0], 36);
		if (!Number.isFinite(delta)) continue;
		previous += delta;
		const chunks: number[] = [];
		for (let i = 1; i < segments.length; i++) {
			const chunk = Number.parseInt(segments[i], 36);
			if (Number.isFinite(chunk)) chunks.push(chunk);
		}
		result.set(previous, chunks);
	}

	return result;
}

/**
 * 从若干分片里取出一次查询需要的那几个词。
 * 分片是按词哈希存的，所以这里只解码命中的词，不碰同片上其它词。
 */
export function collectQueryPostings(
	tokens: readonly string[],
	shards: ReadonlyMap<number, ShardPayload>,
): QueryPostings {
	const postings: QueryPostings = new Map();
	for (const token of tokens) {
		const payload = shards.get(shardForTerm(token));
		postings.set(token, decodePostings(payload?.[token]));
	}
	return postings;
}

/** 某个查询词需要请求的分片列表（去重、升序）。 */
export function shardsForTokens(tokens: readonly string[]): number[] {
	return [...new Set(tokens.map(shardForTerm))].sort((a, b) => a - b);
}

/**
 * 正文纯文本化：去掉 frontmatter、代码块、图片、链接语法和行内标记。
 * 代码块整段丢掉 —— 搜「线程池」不该命中一段示例代码。
 */
export function toPlainText(markdown: string): string {
	return markdown
		.replace(/^---[\s\S]*?---\s*/, " ")
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/~~~[\s\S]*?~~~/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/<[^>]+>/g, " ")
		.replace(/^\s{0,3}>\s?/gm, " ")
		.replace(/^#{1,6}\s+/gm, " ")
		.replace(/\[!(NOTE|TIP|WARNING|CAUTION|IMPORTANT)\]/gi, " ")
		.replace(/[*_`~|]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** 从正文里抽小节标题（和索引里的 headings 同一套规则）。 */
export function extractHeadings(
	markdown: string,
	maxHeadings = 30,
	maxChars = 60,
): string[] {
	const headings: string[] = [];
	for (const match of markdown.matchAll(/^#{2,4}\s+(.+)$/gm)) {
		const heading = match[1].replace(/[*_`#]/g, "").trim();
		if (!heading) continue;
		headings.push(
			heading.length > maxChars ? heading.slice(0, maxChars) : heading,
		);
		if (headings.length >= maxHeadings) break;
	}
	return headings;
}
