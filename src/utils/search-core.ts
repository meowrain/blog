/**
 * 站内搜索核心：纯函数、零依赖，方便在 Node 里直接跑单元测试。
 *
 * 分两层：
 * - 元信息检索：`/posts-index.json`（标题、分类、标签、小节标题、首段），
 *   只覆盖短字段，但一次请求就能拿到全部文章；
 * - 全文检索：正文切词后按哈希分片，客户端只拉查询词命中的那几片倒排表，
 *   再按命中结果取正文块生成摘要。不再拉整份 `/rss.xml`，
 *   也不用把 1MB 正文一次性交给浏览器。
 *
 * 两层共用同一套切词规则：
 * - 中文按 bigram 切分，避免 `includes` 只能匹配连续子串；
 * - 建索引时额外收录单字，保证「锁」这类单字查询也能命中；
 * - 多个关键词按 AND 组合，标题/标签/分类/小节/正文分层加权；
 * - 输出结构化的高亮片段，组件端不再用 `{@html}` 拼字符串。
 */

import type { QueryPostings } from "./search-index";

/** 站内文档。`id` 与 `/posts-index.json` 的数组下标、倒排表里的文档号一致。 */
export interface SearchDoc {
	id: number;
	title: string;
	slug: string;
	url: string;
	category: string;
	tags: string[];
	published: string;
	headings: string[];
	excerpt: string;
}

export interface SearchFilters {
	category?: string;
	tag?: string;
}

export interface SearchOptions extends SearchFilters {
	/** 最多返回多少条，默认 30；`total` 仍是过滤后的总数。 */
	limit?: number;
}

export interface HighlightPart {
	text: string;
	match: boolean;
}

export interface SearchHit {
	doc: SearchDoc;
	score: number;
	titleParts: HighlightPart[];
	snippet: HighlightPart[];
	/**
	 * 正文命中的块号，按「同时命中的关键词数」降序。
	 * 组件据此按需拉正文块生成摘要；只命中标题/标签时为空数组。
	 */
	chunks?: number[];
}

export interface SearchResponse {
	hits: SearchHit[];
	total: number;
}

export interface FilterOption {
	value: string;
	count: number;
}

export interface FilterOptions {
	categories: FilterOption[];
	tags: FilterOption[];
}

interface MappedText {
	text: string;
	/** 归一化后的每个字符对应原文的下标，用于把匹配位置映射回原串。 */
	map: number[];
}

interface PreparedDoc {
	doc: SearchDoc;
	title: string;
	tags: string;
	category: string;
	headings: string;
	slug: string;
	excerpt: string;
}

const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/;
const SEPARATOR_RE = /[\s,，、;；:：|/\\。！？!?"'“”‘’]+/u;
const HAN_RUN_RE = /[\p{Script=Han}]+|[^\p{Script=Han}]+/gu;

const WEIGHT_TITLE = 12;
const WEIGHT_TAGS = 10;
const WEIGHT_CATEGORY = 8;
const WEIGHT_HEADINGS = 6;
const WEIGHT_SLUG = 5;
const WEIGHT_EXCERPT = 4;
/** 正文命中：只要命中了就比摘要高，避免正文里的词排到只有摘要命中的文章后面。 */
const WEIGHT_BODY = 5;

const SNIPPET_BEFORE = 50;
const SNIPPET_AFTER = 110;
const FALLBACK_SNIPPET_LENGTH = 150;

const preparedCache = new WeakMap<SearchDoc, PreparedDoc>();

/** NFKC + 小写：全角字母数字、大小写都归一到同一种写法。 */
export function normalizeText(value: string): string {
	return value.normalize("NFKC").toLowerCase();
}

function mapNormalized(value: string): MappedText {
	let text = "";
	const map: number[] = [];
	for (let i = 0; i < value.length; i++) {
		const normalized = value[i].normalize("NFKC").toLowerCase();
		for (let j = 0; j < normalized.length; j++) {
			text += normalized[j];
			map.push(i);
		}
	}
	return { text, map };
}

function cleanToken(run: string): string {
	return run
		.replace(/^[^\p{L}\p{N}+#]+/gu, "")
		.replace(/[^\p{L}\p{N}+#]+$/gu, "");
}

/**
 * 查询切词：
 * - 英文/数字保持整词，忽略大小写；
 * - 中文长度 >= 3 时切成 bigram（"缓存过期" → 缓存/存过/过期），
 *   这样不用词典也能匹配到连续中文的一部分，比整串 `includes` 稳；
 * - 中英混排按书写系统拆开（"redis缓存" → redis + 缓存）。
 */
export function tokenize(query: string): string[] {
	const normalized = normalizeText(query).trim();
	if (!normalized) return [];

	const tokens: string[] = [];
	for (const part of normalized.split(SEPARATOR_RE)) {
		if (!part) continue;
		const runs = part.match(HAN_RUN_RE) ?? [part];
		for (const run of runs) {
			if (!run) continue;
			if (CJK_RE.test(run)) {
				if (run.length <= 2) {
					tokens.push(run);
				} else {
					for (let i = 0; i < run.length - 1; i++) {
						tokens.push(run.slice(i, i + 2));
					}
				}
			} else {
				const cleaned = cleanToken(run);
				if (cleaned) tokens.push(cleaned);
			}
		}
	}

	return [...new Set(tokens)];
}

/** 整段查询词（按空白/标点切开）用于精确短语加权。 */
export function extractPhrases(query: string): string[] {
	const normalized = normalizeText(query).trim();
	if (!normalized) return [];
	return [...new Set(normalized.split(SEPARATOR_RE).filter(Boolean))];
}

/**
 * 高亮用的词：先放完整短语，再放 bigram。
 * 搜「线程池」时切词结果是 线程 / 程池，只按 token 高亮会把「线程池」标成「线程」，
 * 把原短语加进来后区间会合并成完整的一段。
 */
export function highlightTokens(query: string): string[] {
	const phrases = extractPhrases(query).filter((phrase) => phrase.length > 1);
	return [...new Set([...phrases, ...tokenize(query)])].sort(
		(a, b) => b.length - a.length,
	);
}

function prepare(doc: SearchDoc): PreparedDoc {
	const cached = preparedCache.get(doc);
	if (cached) return cached;

	const prepared: PreparedDoc = {
		doc,
		title: normalizeText(doc.title ?? ""),
		tags: normalizeText((doc.tags ?? []).join(" ")),
		category: normalizeText(doc.category ?? ""),
		headings: normalizeText((doc.headings ?? []).join(" ")),
		slug: normalizeText(doc.slug ?? ""),
		excerpt: normalizeText(doc.excerpt ?? ""),
	};
	preparedCache.set(doc, prepared);
	return prepared;
}

function scoreDoc(
	prepared: PreparedDoc,
	tokens: string[],
	phrases: string[],
): number | null {
	let score = 0;

	for (const token of tokens) {
		let weight = 0;
		if (prepared.title.includes(token)) {
			weight = WEIGHT_TITLE;
			if (prepared.title.startsWith(token)) weight += 3;
		} else if (prepared.tags.includes(token)) {
			weight = WEIGHT_TAGS;
		} else if (prepared.category.includes(token)) {
			weight = WEIGHT_CATEGORY;
		} else if (prepared.headings.includes(token)) {
			weight = WEIGHT_HEADINGS;
		} else if (prepared.slug.includes(token)) {
			weight = WEIGHT_SLUG;
		} else if (prepared.excerpt.includes(token)) {
			weight = WEIGHT_EXCERPT;
		} else {
			// 所有关键词都要命中（AND），避免长查询越搜越宽。
			return null;
		}
		score += weight;
	}

	for (const phrase of phrases) {
		if (prepared.title === phrase) score += 30;
		else if (prepared.title.includes(phrase)) score += 16;
		else if (prepared.tags.includes(phrase)) score += 12;
		else if (prepared.category.includes(phrase)) score += 8;
		else if (prepared.headings.includes(phrase)) score += 6;
		else if (prepared.excerpt.includes(phrase)) score += 3;
	}

	return score;
}

function matchesFilters(doc: SearchDoc, filters: SearchFilters): boolean {
	if (filters.category && doc.category !== filters.category) return false;
	if (filters.tag && !(doc.tags ?? []).includes(filters.tag)) return false;
	return true;
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
	if (ranges.length === 0) return [];
	ranges.sort((a, b) => a[0] - b[0]);
	const merged: Array<[number, number]> = [ranges[0]];
	for (let i = 1; i < ranges.length; i++) {
		const current = ranges[i];
		const last = merged[merged.length - 1];
		if (current[0] <= last[1]) {
			last[1] = Math.max(last[1], current[1]);
		} else {
			merged.push([current[0], current[1]]);
		}
	}
	return merged;
}

/**
 * 在原文中找出所有 token 出现的位置并切成交替的片段。
 * 返回纯文本片段 + match 标记，调用方按片段渲染 `<mark>`，不经过 innerHTML。
 */
export function highlightParts(
	source: string,
	tokens: readonly string[],
): HighlightPart[] {
	if (!source) return [];
	const mapped = mapNormalized(source);
	const ranges: Array<[number, number]> = [];

	for (const token of tokens) {
		if (!token) continue;
		let from = 0;
		while (from <= mapped.text.length - token.length) {
			const index = mapped.text.indexOf(token, from);
			if (index < 0) break;
			const start = mapped.map[index];
			const end = mapped.map[index + token.length - 1] + 1;
			ranges.push([start, end]);
			from = index + token.length;
		}
	}

	if (ranges.length === 0) return [{ text: source, match: false }];

	const parts: HighlightPart[] = [];
	let cursor = 0;
	for (const [start, end] of mergeRanges(ranges)) {
		if (start > cursor) {
			parts.push({ text: source.slice(cursor, start), match: false });
		}
		parts.push({ text: source.slice(start, end), match: true });
		cursor = end;
	}
	if (cursor < source.length) {
		parts.push({ text: source.slice(cursor), match: false });
	}
	return parts;
}

function firstMatchIndex(
	mapped: MappedText,
	tokens: readonly string[],
): number {
	let best = -1;
	for (const token of tokens) {
		if (!token) continue;
		const index = mapped.text.indexOf(token);
		if (index >= 0 && (best < 0 || index < best)) best = index;
	}
	return best;
}

function snippetAround(
	source: string,
	tokens: readonly string[],
	matchIndex: number,
	prefix: string,
): HighlightPart[] {
	const mapped = mapNormalized(source);
	const originalIndex = mapped.map[matchIndex] ?? 0;
	let start = Math.max(0, originalIndex - SNIPPET_BEFORE);
	let end = Math.min(source.length, originalIndex + SNIPPET_AFTER);

	// 不要把代理对从中间切开
	if (start > 0 && /[\uDC00-\uDFFF]/.test(source[start])) start--;
	if (end < source.length && /[\uDC00-\uDFFF]/.test(source[end])) end++;

	const text = source.slice(start, end).replace(/\s+/g, " ").trim();
	const parts: HighlightPart[] = [];

	if (prefix) parts.push({ text: prefix, match: false });
	if (start > 0) parts.push({ text: "…", match: false });
	if (text) parts.push(...highlightParts(text, tokens));
	if (end < source.length) parts.push({ text: "…", match: false });

	return parts;
}

function buildSnippet(
	doc: SearchDoc,
	tokens: readonly string[],
): HighlightPart[] {
	if (tokens.length === 0) return [];

	const candidates: Array<{ text: string; prefix: string }> = [];
	if (doc.excerpt) candidates.push({ text: doc.excerpt, prefix: "" });
	if (doc.headings && doc.headings.length > 0) {
		candidates.push({ text: doc.headings.join(" · "), prefix: "小节： " });
	}

	for (const candidate of candidates) {
		const mapped = mapNormalized(candidate.text);
		const index = firstMatchIndex(mapped, tokens);
		if (index >= 0) {
			return snippetAround(candidate.text, tokens, index, candidate.prefix);
		}
	}

	const fallback = doc.excerpt || (doc.headings ?? []).join(" · ");
	if (!fallback) return [];
	const cut =
		fallback.length > FALLBACK_SNIPPET_LENGTH
			? `${fallback.slice(0, FALLBACK_SNIPPET_LENGTH)}…`
			: fallback;
	return highlightParts(cut, tokens);
}

/**
 * 正文摘要：在命中的块里截取关键词附近的文字。
 * 块的边界在构建期就按句子切好了，这里只处理块内的窗口。
 */
export function snippetFromChunks(
	chunks: readonly string[],
	tokens: readonly string[],
): HighlightPart[] {
	if (tokens.length === 0) return [];

	for (const chunk of chunks) {
		const mapped = mapNormalized(chunk);
		const index = firstMatchIndex(mapped, tokens);
		if (index >= 0) return snippetAround(chunk, tokens, index, "");
	}

	// 倒排表说这块命中、但归一化后找不到（极少见的全角/大小写差异），退回块首
	const first = chunks[0];
	if (!first) return [];
	const cut =
		first.length > FALLBACK_SNIPPET_LENGTH
			? `${first.slice(0, FALLBACK_SNIPPET_LENGTH)}…`
			: first;
	return highlightParts(cut, tokens);
}

function readStrings(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

/**
 * 把 `/posts-index.json` 的响应规整成 `SearchDoc[]`。
 * 索引是构建期产物，字段理论上可控，但客户端仍做一次防御：缺字段的文章直接跳过，
 * 免得一条脏数据让整个搜索面板挂掉。
 */
export function parseSearchIndex(payload: unknown): SearchDoc[] {
	if (!payload || typeof payload !== "object") return [];
	const posts = (payload as { posts?: unknown }).posts;
	if (!Array.isArray(posts)) return [];

	const docs: SearchDoc[] = [];
	for (const [index, raw] of posts.entries()) {
		if (!raw || typeof raw !== "object") continue;
		const post = raw as Record<string, unknown>;
		const title = post.title;
		const slug = post.slug;
		if (typeof title !== "string" || typeof slug !== "string") continue;
		docs.push({
			// 文档号必须取原始下标，不能取 docs.length：跳过的脏条目会让两边错位，
			// 倒排表和正文块都是按这个号取的。
			id: typeof post.id === "number" ? post.id : index,
			title,
			slug,
			url:
				typeof post.url === "string" && post.url ? post.url : `/posts/${slug}/`,
			category: typeof post.category === "string" ? post.category : "",
			tags: readStrings(post.tags),
			published: typeof post.published === "string" ? post.published : "",
			headings: readStrings(post.headings),
			excerpt: typeof post.excerpt === "string" ? post.excerpt : "",
		});
	}
	return docs;
}

/**
 * 索引版本号（构建时间）。
 *
 * 文档号是「按发布时间排序后的数组下标」，加一篇新文章会让它后面的文章整体位移。
 * 所以分片和正文块的 URL 都带上版本号：新构建 = 新 URL，旧缓存不会指向错位的文档；
 * 同一个构建内的请求则能放心长缓存。
 */
export function parseIndexVersion(payload: unknown): string {
	if (!payload || typeof payload !== "object") return "";
	const generatedAt = (payload as { generatedAt?: unknown }).generatedAt;
	if (typeof generatedAt !== "string") return "";
	// 只取数字部分，避免 URL 里出现冒号等字符
	return generatedAt.replace(/[^0-9]/g, "").slice(0, 14);
}

/** 收集分类/标签筛选项，带文章数，按常用程度排序。 */
export function collectFilterOptions(
	docs: readonly SearchDoc[],
): FilterOptions {
	const categories = new Map<string, number>();
	const tags = new Map<string, number>();

	for (const doc of docs) {
		if (doc.category) {
			categories.set(doc.category, (categories.get(doc.category) ?? 0) + 1);
		}
		for (const tag of doc.tags ?? []) {
			if (!tag) continue;
			tags.set(tag, (tags.get(tag) ?? 0) + 1);
		}
	}

	const toOptions = (map: Map<string, number>): FilterOption[] =>
		[...map.entries()]
			.map(([value, count]) => ({ value, count }))
			.sort(
				(a, b) => b.count - a.count || a.value.localeCompare(b.value, "zh-CN"),
			);

	return { categories: toOptions(categories), tags: toOptions(tags) };
}

/**
 * 全文检索：元信息字段 + 分片倒排表一起打分。
 *
 * 倒排表里的块号只用来定位摘要，不会因为正文里出现次数多就把标题命中挤下去：
 * 标题/标签/分类/小节这些「人写的」字段权重仍然最高，正文命中按块数封顶后计入。
 *
 * AND 语义：每个查询词都得有下落（元信息字段或正文块命中）。
 */
export function rankFullText(
	docs: readonly SearchDoc[],
	query: string,
	postings: QueryPostings,
	options: SearchOptions = {},
): SearchResponse {
	const { category, tag, limit = 30 } = options;
	const tokens = tokenize(query);
	const phrases = extractPhrases(query);
	const highlights = highlightTokens(query);
	if (tokens.length === 0) return { hits: [], total: 0 };

	const filtered = docs.filter((doc) => matchesFilters(doc, { category, tag }));

	const scored: Array<{
		doc: SearchDoc;
		score: number;
		chunks: number[];
		metadataMatched: boolean;
	}> = [];

	for (const doc of filtered) {
		const prepared = prepare(doc);
		let score = 0;
		let metadataMatched = false;
		// 块号 -> 命中的关键词数，用于挑最像样的那块做摘要
		const chunkVotes = new Map<number, number>();

		let allTokensHit = true;
		for (const token of tokens) {
			let weight = 0;
			if (prepared.title.includes(token)) {
				weight = WEIGHT_TITLE;
				if (prepared.title.startsWith(token)) weight += 3;
			} else if (prepared.tags.includes(token)) {
				weight = WEIGHT_TAGS;
			} else if (prepared.category.includes(token)) {
				weight = WEIGHT_CATEGORY;
			} else if (prepared.headings.includes(token)) {
				weight = WEIGHT_HEADINGS;
			} else if (prepared.slug.includes(token)) {
				weight = WEIGHT_SLUG;
			} else if (prepared.excerpt.includes(token)) {
				weight = WEIGHT_EXCERPT;
			}

			// 元信息命中：摘要可以直接用首段/小节标题，不必再拉正文块
			if (weight > 0) metadataMatched = true;

			const chunks = postings.get(token)?.get(doc.id) ?? [];
			if (chunks.length > 0) {
				for (const chunk of chunks) {
					chunkVotes.set(chunk, (chunkVotes.get(chunk) ?? 0) + 1);
				}
				// 正文命中：基础分 + 覆盖的块数，封顶避免长文霸榜
				weight = Math.max(weight, WEIGHT_BODY + Math.min(chunks.length, 4));
			} else if (weight === 0) {
				allTokensHit = false;
				break;
			}

			score += weight;
		}

		if (!allTokensHit) continue;

		for (const phrase of phrases) {
			if (prepared.title === phrase) score += 30;
			else if (prepared.title.includes(phrase)) score += 16;
			else if (prepared.tags.includes(phrase)) score += 12;
			else if (prepared.category.includes(phrase)) score += 8;
			else if (prepared.headings.includes(phrase)) score += 6;
			else if (prepared.excerpt.includes(phrase)) score += 3;
		}

		// 同时命中越多关键词的块越靠前，其次才是命中次数
		const chunks = [...chunkVotes.entries()]
			.sort((a, b) => b[1] - a[1] || a[0] - b[0])
			.map(([chunk]) => chunk);

		scored.push({ doc, score, chunks, metadataMatched });
	}

	scored.sort(
		(a, b) =>
			b.score - a.score ||
			(b.doc.published ?? "").localeCompare(a.doc.published ?? ""),
	);

	return {
		hits: scored
			.slice(0, limit)
			.map(({ doc, score, chunks, metadataMatched }) => ({
				doc,
				score,
				// 只有元信息字段命中时才先用短摘要；纯正文命中把摘要留给正文块，
				// 否则用户看到的是首段，而关键词可能在第 5 块。
				titleParts: highlightParts(doc.title, highlights),
				snippet: metadataMatched ? buildSnippet(doc, highlights) : [],
				chunks,
			})),
		total: scored.length,
	};
}

/**
 * 元信息检索（不依赖分片索引）。
 *
 * - 有查询词：token AND 匹配，按相关度排序，命中条数写入 `total`；
 * - 只有筛选条件：按发布时间倒序返回筛选结果；
 * - 查询词和筛选条件都没有：返回空结果，避免面板一打开就铺满全部文章。
 *
 * 分片拉取失败、或用户刚输入还没拿到正文倒排表时用它兜底。
 */
export function searchDocs(
	docs: readonly SearchDoc[],
	query: string,
	options: SearchOptions = {},
): SearchResponse {
	const { category, tag, limit = 30 } = options;
	const filters: SearchFilters = { category, tag };
	const hasQuery = normalizeText(query).trim().length > 0;
	const tokens = tokenize(query);
	const phrases = extractPhrases(query);
	const highlights = highlightTokens(query);

	if (hasQuery && tokens.length === 0) {
		return { hits: [], total: 0 };
	}

	const filtered = docs.filter((doc) => matchesFilters(doc, filters));
	const hasFilters = Boolean(category || tag);

	if (!hasQuery) {
		if (!hasFilters) return { hits: [], total: 0 };
		return {
			hits: filtered
				.slice()
				.sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""))
				.slice(0, limit)
				.map((doc) => ({
					doc,
					score: 0,
					titleParts: [{ text: doc.title, match: false }],
					snippet: highlightParts(doc.excerpt, []),
				})),
			total: filtered.length,
		};
	}

	const scored: Array<{ doc: SearchDoc; score: number }> = [];
	for (const doc of filtered) {
		const score = scoreDoc(prepare(doc), tokens, phrases);
		if (score !== null) scored.push({ doc, score });
	}

	scored.sort(
		(a, b) =>
			b.score - a.score ||
			(b.doc.published ?? "").localeCompare(a.doc.published ?? ""),
	);

	return {
		hits: scored.slice(0, limit).map(({ doc, score }) => ({
			doc,
			score,
			titleParts: highlightParts(doc.title, highlights),
			snippet: buildSnippet(doc, highlights),
		})),
		total: scored.length,
	};
}
