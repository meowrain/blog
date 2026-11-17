import {
	type HighlightPart,
	type SearchDoc,
	highlightTokens,
	parseSearchIndex,
	rankFullText,
	snippetFromChunks,
	tokenize,
} from '../../src/utils/search-core';
import { chunkGroupOf, collectQueryPostings, shardsForTokens } from '../../src/utils/search-index';
import { clampArticleBody } from '../_article';
import type { ToolDef, ToolResult } from '../_agent-loop';
import { createLogger } from '../_shared';
import { type NoteCorpus, type PostRecord, loadBodyChunks, loadShards } from './_corpus';
import { locatePost } from './_locate';
import { collectPostBody } from './_post-body';
import { matchSeriesName, readSeries, summarizeSeries } from './_series';

const logger = createLogger('find');

/**
 * `/find` 的工具注册表 —— 胶囊助手既能站内找文章，也能当当前这篇文章的学习助手，
 * 两边的能力都从这里挂上去。加新能力就往 TOOLS 里加一条，tool loop 和前端都不用动。
 *
 * 站内检索只有一条 `search`（keyword / categories / recent 三个模式），
 * `/assistant` 也复用这一个定义（见 SEARCH_TOOL）—— 两个 agent 不各玩一套。
 *
 * 返回体刻意做得瘦：模型上下文里最贵的就是工具结果，所以条数、每条带什么字段、
 * 回灌进上下文的长度都卡死了（见 _agent-loop.ts 的预算常量，以及下面 read_article 的覆盖）。
 */

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 8;
const MAX_TAGS = 4;
const MAX_MATCHED_HEADINGS = 3;
const SNIPPET_CHARS = 80;
const DEFAULT_RECENT = 6;
const MAX_RECENT = 10;
const MAX_CATEGORIES = 15;
/** 系列总览最多列几个：站内 14 个系列，留一格余量 */
const MAX_SERIES = 15;
/** 每个系列展示几个高频标签 */
const MAX_SERIES_TAGS = 3;
/** 命中分下限。分数已按 idf 加权，所以这里只需拦掉「几乎全站都有」的词带来的噪声 */
const MIN_SCORE = 1;

const FIELD_WEIGHTS = { title: 3, tags: 2, category: 1.5, headings: 1.5, excerpt: 1 } as const;

/** 单次 read_article 读进模型的正文 token 上限。超了只给前半部分，剩下的按小节补读。 */
const ARTICLE_TOKENS_PER_CALL = 6_000;
/** read_article 结果回灌模型时的字符上限 —— 默认的 4k 装不下一篇正文 */
const ARTICLE_RESULT_CHARS = 16_000;

/**
 * read_post 的正文预算。正文块每块约 1800 字、每个 group 最多 4 块（≈7200 字，
 * 见 src/utils/search-index.ts 的 CHUNK_CHARS / CHUNKS_PER_FILE），所以默认预算大约
 * 两个 group 就打满。上限按「一篇正文塞进 64k 上下文还剩多少给对话」倒推，卡在 2 万字。
 */
const READ_POST_DEFAULT_CHARS = 12_000;
const READ_POST_MAX_CHARS = 20_000;
/**
 * 单次 read_post 最多发几个正文块请求。最长的《SSM》有 28 个 group —— 全打出去既拖慢
 * 又毫无意义（2 万字早就超了默认预算），4 个已经够把默认预算填满。
 * 这是硬上限，不随 maxChars 放大。
 */
const READ_POST_MAX_REQUESTS = 4;
/** read_post 结果回灌模型时的字符上限：正文上限 2 万 + JSON 外壳，留点余量 */
const READ_POST_RESULT_CHARS = 23_000;

/**
 * 站内检索工具需要的 ctx：三种模式只用得到语料和「本次已经给过谁」。
 * `/find` 的 FindCtx 和 `/assistant` 的 ChatCtx 都满足这个形状，所以工具定义两边共用。
 */
export interface SearchCtx {
	origin: string;
	loadPosts: () => Promise<PostRecord[]>;
	/** 本次请求里已经返回过的文章 —— 重复命中只给标题和链接 */
	seen: Set<string>;
}

export interface FindCtx extends SearchCtx {
	/** 访客当前正在阅读的文章（前端从页面 DOM 抽好随请求递上来）；不在文章页时为 null */
	article: ArticleCtx | null;
	/** 碎碎念索引（`/notes-index.json`，封存中的时间胶囊已被端点滤掉） */
	loadNotes: () => Promise<NoteCorpus>;
}

/** 文章按标题切出来的小节（前端切好递上来，服务端不解析 Markdown） */
export interface ArticleSection {
	heading: string;
	level: number;
	text: string;
}

/** 当前页面的文章上下文 */
export interface ArticleCtx {
	slug: string;
	title: string;
	text: string;
	sections: ArticleSection[];
}

interface Scored {
	post: PostRecord;
	score: number;
	terms: string[];
}

/**
 * 切词：英文/数字按词，中文按 2-gram，另外把整段中文（≥3 字）也当一个「词组」词条。
 * 词组只要能命中，idf 就会明显高于它的 2-gram 零件，「垃圾回收」这种原词命中会排到前面。
 */
function splitTerms(query: string): string[] {
	const lower = query.toLowerCase();
	const terms = new Set<string>();
	for (const word of lower.match(/[a-z0-9][a-z0-9+#._-]*/g) ?? []) {
		if (word.length >= 2) terms.add(word);
	}
	for (const segment of lower.replace(/[a-z0-9+#._-]+/g, ' ').split(/[\s\p{P}\p{S}]+/u)) {
		if (!segment) continue;
		if (segment.length === 1) {
			terms.add(segment);
			continue;
		}
		if (segment.length >= 3) terms.add(segment);
		for (let i = 0; i < segment.length - 1; i++) terms.add(segment.slice(i, i + 2));
	}
	return [...terms];
}

/** 一个词在字段里出现几次（最多算 2 次，免得长字段靠堆次数盖过标题） */
function hits(field: string, term: string): number {
	if (!field || !term) return 0;
	let count = 0;
	let at = field.indexOf(term);
	while (at !== -1 && count < 2) {
		count += 1;
		at = field.indexOf(term, at + term.length);
	}
	return count;
}

/** 整篇的可检索文本（小写）。语料在进程内是同一批对象，所以缓存复用。 */
const haystackCache = new WeakMap<PostRecord, string>();
function haystack(post: PostRecord): string {
	let text = haystackCache.get(post);
	if (text === undefined) {
		text = [post.title, post.tags.join(' '), post.category, post.headings.join(' '), post.excerpt]
			.join('\n')
			.toLowerCase();
		haystackCache.set(post, text);
	}
	return text;
}

interface TermStat {
	term: string;
	/** 出现过这个词的文章数 */
	df: number;
	/** 越罕见的词越能定方向：「rust」有指向性，「内存」「没有」几乎没有 */
	idf: number;
}

function termStats(posts: PostRecord[], terms: string[]): TermStat[] {
	const total = Math.max(1, posts.length);
	return terms.map((term) => {
		let df = 0;
		for (const post of posts) if (haystack(post).includes(term)) df += 1;
		return { term, df, idf: Math.log(1 + total / (1 + df)) };
	});
}

function scorePost(post: PostRecord, stats: TermStat[]): Scored {
	const title = post.title.toLowerCase();
	const tags = post.tags.join(' ').toLowerCase();
	const category = post.category.toLowerCase();
	const headings = post.headings.join(' ').toLowerCase();
	const excerpt = post.excerpt.toLowerCase();

	let score = 0;
	const matched: string[] = [];
	for (const { term, idf } of stats) {
		const s =
			hits(title, term) * FIELD_WEIGHTS.title +
			hits(tags, term) * FIELD_WEIGHTS.tags +
			hits(category, term) * FIELD_WEIGHTS.category +
			hits(headings, term) * FIELD_WEIGHTS.headings +
			hits(excerpt, term) * FIELD_WEIGHTS.excerpt;
		if (s > 0) matched.push(term);
		score += s * idf; // 常见词按比例压低，罕见词给足权重
	}
	return { post, score, terms: matched };
}

/** 命中位置附近的一小段，而不是整段摘要 */
function snippetAround(post: PostRecord, terms: string[]): string {
	const haystack = post.excerpt;
	const lower = haystack.toLowerCase();
	let at = -1;
	let hitTerm = '';
	for (const term of terms) {
		const i = lower.indexOf(term);
		if (i !== -1 && (at === -1 || i < at)) {
			at = i;
			hitTerm = term;
		}
	}
	if (at === -1) return haystack.slice(0, SNIPPET_CHARS);
	const start = Math.max(0, at - Math.floor((SNIPPET_CHARS - hitTerm.length) / 2));
	const end = Math.min(haystack.length, start + SNIPPET_CHARS);
	return `${start > 0 ? '…' : ''}${haystack.slice(start, end)}${end < haystack.length ? '…' : ''}`;
}

function matchedHeadings(headings: readonly string[], terms: readonly string[]): string[] {
	const out: string[] = [];
	for (const heading of headings) {
		const lower = heading.toLowerCase();
		if (terms.some((t) => lower.includes(t))) out.push(heading);
		if (out.length >= MAX_MATCHED_HEADINGS) break;
	}
	return out;
}

/** 元信息检索的返回体（旧实现，保留作降级路径） */
async function keywordFromMetadata(
	state: SearchCtx,
	posts: PostRecord[],
	query: string,
	limit: number,
): Promise<ToolResult> {
	const terms = splitTerms(query);
	// 定方向的是最罕见的那个词（df 最小）：命中它、或同时命中两个词才算真的相关。
	// 否则「Rust 内存安全」会把所有讲「内存」的文章都当命中捞出来。
	const stats = termStats(posts, terms);
	const rarest = stats.filter((s) => s.df > 0).sort((a, b) => a.df - b.df)[0]?.term;

	const ranked = posts
		.map((post) => scorePost(post, stats))
		.filter(
			(s) =>
				s.score >= MIN_SCORE &&
				(s.terms.length >= 2 || (rarest !== undefined && s.terms.includes(rarest))),
		)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);

	if (!ranked.length) return emptyResult(query);

	const results = ranked.map(({ post, terms: matched }) => {
		if (state.seen.has(post.slug)) {
			// 已经给过这篇了：只留标题和链接，省掉摘要
			return { title: post.title, url: post.url, seen: true };
		}
		state.seen.add(post.slug);
		const headings = matchedHeadings(post.headings, matched);
		return {
			title: post.title,
			url: post.url,
			published: post.published,
			category: post.category,
			tags: post.tags.slice(0, MAX_TAGS),
			...(headings.length ? { matchedHeadings: headings } : {}),
			snippet: snippetAround(post, matched),
		};
	});

	return {
		summary: `「${query}」命中 ${ranked.length} 篇`,
		content: JSON.stringify({ query, count: ranked.length, posts: results }),
	};
}

function emptyResult(query: string): ToolResult {
	return {
		summary: `「${query}」没有命中`,
		content: JSON.stringify({
			query,
			count: 0,
			hint: '没有匹配到文章。换更具体的关键词（术语、英文名、具体技术名），或用 search({mode:"categories"}) 看看站内有哪些方向。',
		}),
	};
}

/** 高亮片段 → 纯文本（前端只吃 string） */
function plainSnippet(parts: readonly HighlightPart[]): string {
	const text = parts
		.map((part) => part.text)
		.join('')
		.replace(/\s+/g, ' ')
		.trim();
	if (text.length <= SNIPPET_CHARS) return text;
	return `${text.slice(0, SNIPPET_CHARS)}…`;
}

/**
 * 摘要三级兜底：
 * 1. `hit.snippet` 非空 —— 元信息字段命中了，`rankFullText` 已经切好片段；
 * 2. 纯正文命中（`snippet` 为空但 `chunks` 有值）—— 按第一个命中块去拉正文块；
 *    `rankFullText` 刻意把这种情况留给调用方，不拉就是「搜到了但没摘要」；
 * 3. 正文块拉不到 —— 退回首段摘要。
 */
async function snippetFor(hit: { snippet: HighlightPart[]; chunks?: number[] }, origin: string, query: string, doc: SearchDoc): Promise<string> {
	if (hit.snippet.length) return plainSnippet(hit.snippet);

	const chunk = hit.chunks?.[0];
	if (chunk !== undefined) {
		try {
			const group = await loadBodyChunks(origin, doc.id, chunkGroupOf(chunk));
			const text = group?.chunks[chunk - group.start];
			if (text) return plainSnippet(snippetFromChunks([text], highlightTokens(query)));
		} catch (e) {
			logger.error('正文块拉取失败 doc=%d chunk=%d：%s', doc.id, chunk, (e as Error).message);
		}
	}

	return doc.excerpt.slice(0, SNIPPET_CHARS);
}

/** `parseSearchIndex` 的产物按语料数组缓存一份：同一批语料上反复搜索不用重建 142 个 doc */
const docsCache = new WeakMap<PostRecord[], SearchDoc[]>();
function searchDocs(posts: PostRecord[]): SearchDoc[] {
	let docs = docsCache.get(posts);
	if (!docs) {
		docs = parseSearchIndex({ posts });
		docsCache.set(posts, docs);
	}
	return docs;
}

/**
 * 全文检索：拉查询词命中的那几片倒排表，交给 `rankFullText` 打分。
 * 返回 null 表示分片没拉全（或查询词切不出来），调用方走元信息检索。
 */
async function keywordFromFullText(
	state: SearchCtx,
	posts: PostRecord[],
	query: string,
	limit: number,
): Promise<ToolResult | null> {
	const tokens = tokenize(query);
	if (!tokens.length) return null;

	const shards = await loadShards(state.origin, shardsForTokens(tokens));
	if (!shards) return null;

	const docs = searchDocs(posts);
	if (!docs.length) return null;

	const response = rankFullText(docs, query, collectQueryPostings(tokens, shards), { limit });
	if (!response.total) return null; // 正文里也没有：让旧实现按「最罕见词」再宽松试一次

	const results = await Promise.all(
		response.hits.map(async (hit) => {
			const doc = hit.doc;
			if (state.seen.has(doc.slug)) {
				return { title: doc.title, url: doc.url, seen: true };
			}
			state.seen.add(doc.slug);
			const headings = matchedHeadings(doc.headings, tokens);
			return {
				title: doc.title,
				url: doc.url,
				published: doc.published,
				category: doc.category,
				tags: doc.tags.slice(0, MAX_TAGS),
				...(headings.length ? { matchedHeadings: headings } : {}),
				snippet: await snippetFor({ snippet: hit.snippet, chunks: hit.chunks }, state.origin, query, doc),
			};
		}),
	);

	logger.log('全文检索 query=%s tokens=%d hits=%d/%d', query, tokens.length, response.hits.length, response.total);

	return {
		summary: `「${query}」命中 ${results.length} 篇`,
		content: JSON.stringify({ query, count: results.length, posts: results }),
	};
}

async function searchByKeyword(args: Record<string, unknown>, ctx: unknown): Promise<ToolResult> {
	const state = ctx as SearchCtx;
	const query = typeof args.query === 'string' ? args.query.trim() : '';
	if (!query) {
		return { summary: '缺少 query 参数', content: JSON.stringify({ error: 'query 不能为空' }) };
	}
	const limitRaw = Number(args.limit);
	const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.trunc(limitRaw), MAX_LIMIT) : DEFAULT_LIMIT;

	const posts = await state.loadPosts();
	if (!splitTerms(query).length) {
		return { summary: '关键词全是标点', content: JSON.stringify({ count: 0, hint: '换几个实词再试' }) };
	}

	// 先走全文：正文覆盖率远高于元信息（元信息只有 3%，摘要还在 220 字符处被截断）。
	// 分片拉取失败、或正文里也没有这个词组 → 退回元信息检索。
	try {
		const fullText = await keywordFromFullText(state, posts, query, limit);
		if (fullText) return fullText;
	} catch (e) {
		logger.error('全文检索异常，降级元信息检索：%s', (e as Error).message);
	}

	return keywordFromMetadata(state, posts, query, limit);
}

async function listCategories(_args: Record<string, unknown>, ctx: unknown): Promise<ToolResult> {
	const state = ctx as SearchCtx;
	const posts = await state.loadPosts();

	const buckets = new Map<string, { count: number; tags: Map<string, number> }>();
	for (const post of posts) {
		const name = post.category || '未分类';
		if (!buckets.has(name)) buckets.set(name, { count: 0, tags: new Map() });
		const bucket = buckets.get(name)!;
		bucket.count += 1;
		for (const tag of post.tags) bucket.tags.set(tag, (bucket.tags.get(tag) ?? 0) + 1);
	}

	const categories = [...buckets.entries()]
		.sort((a, b) => b[1].count - a[1].count)
		.slice(0, MAX_CATEGORIES)
		.map(([name, bucket]) => ({
			name,
			count: bucket.count,
			topTags: [...bucket.tags.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 4)
				.map(([tag]) => tag),
		}));

	return {
		summary: `站内 ${posts.length} 篇，${buckets.size} 个分类`,
		content: JSON.stringify({ totalPosts: posts.length, categories }),
	};
}

async function listRecentPosts(args: Record<string, unknown>, ctx: unknown): Promise<ToolResult> {
	const state = ctx as SearchCtx;
	const posts = await state.loadPosts();
	const limitRaw = Number(args.limit);
	const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.trunc(limitRaw), MAX_RECENT) : DEFAULT_RECENT;

	const recent = [...posts].sort((a, b) => (a.published < b.published ? 1 : -1)).slice(0, limit);
	for (const post of recent) state.seen.add(post.slug);

	return {
		summary: `最新 ${recent.length} 篇：${recent[0]?.published ?? ''} 起`,
		content: JSON.stringify({
			count: recent.length,
			posts: recent.map((post) => ({
				title: post.title,
				url: post.url,
				published: post.published,
				category: post.category,
			})),
		}),
	};
}

/**
 * 站内检索的统一入口 —— 三个模式原先各占一条工具，现在合成一条 `search`。
 * 模型的工具预算有限，一条带 mode 的工具比三条各自描述「什么时候该用我」更好选；
 * 前端也已经按工具名分支渲染，合并后只需要认识一个名字。
 *
 * 只做分发，检索逻辑仍在各自的实现里，互不影响。
 */
async function searchSite(args: Record<string, unknown>, ctx: unknown): Promise<ToolResult> {
	const mode = typeof args.mode === 'string' ? args.mode.trim().toLowerCase() : 'keyword';

	if (mode === 'categories') return listCategories(args, ctx);
	if (mode === 'recent') return listRecentPosts(args, ctx);
	if (mode === 'keyword' || mode === '') return searchByKeyword(args, ctx);

	return {
		summary: `未知的 mode：${mode}`,
		content: JSON.stringify({
			error: `mode 只能是 keyword / categories / recent，收到的是「${mode}」`,
			hint: '按关键词找文章用 mode:"keyword"（可省略）；看分类用 "categories"；看最新用 "recent"。',
		}),
	};
}

/** 按序号（1 起）或标题（全等优先，其次包含）找小节 */
function matchArticleSection(article: ArticleCtx, wanted: string): ArticleSection | null {
	const index = Number(wanted);
	if (Number.isInteger(index) && index >= 1 && index <= article.sections.length) {
		return article.sections[index - 1];
	}
	const needle = wanted.toLowerCase();
	return (
		article.sections.find((section) => section.heading.toLowerCase() === needle) ??
		article.sections.find((section) => section.heading.toLowerCase().includes(needle)) ??
		null
	);
}

/**
 * 读访客正在阅读的这篇文章的正文。
 * 讲解 / 出题 / 批改都必须从这一步开始 —— 正文只在前端手上，服务端没有别的途径拿到它。
 */
function readArticle(args: Record<string, unknown>, ctx: unknown): ToolResult {
	const { article } = ctx as FindCtx;
	if (!article) {
		return {
			summary: '当前不在文章页',
			content: JSON.stringify({
				error:
					'拿不到文章正文：访客现在不在文章页（或刚换了页）。要讲文章先用 search 找到它、' +
					'让访客点开阅读；其余问题按普通问答回答即可。',
			}),
		};
	}

	const outline = article.sections.map((section, index) => `${index + 1}. ${section.heading}`);
	const wanted = typeof args.section === 'string' ? args.section.trim() : '';

	if (wanted) {
		const hit = matchArticleSection(article, wanted);
		if (!hit) {
			return {
				summary: `没有「${wanted}」这一节`,
				content: JSON.stringify({
					title: article.title,
					outline,
					hint: '没有匹配的小节。从 outline 里挑一个标题（或它的片段、序号）再读。',
				}),
			};
		}
		const text = clampArticleBody(hit.text, ARTICLE_TOKENS_PER_CALL);
		return {
			summary: `读了小节「${hit.heading}」`,
			content: JSON.stringify({
				title: article.title,
				slug: article.slug,
				section: hit.heading,
				text,
				truncated: text.length < hit.text.trim().length,
			}),
		};
	}

	const full = article.text.trim() || article.sections.map((s) => `${s.heading}\n${s.text}`).join('\n\n');
	const text = clampArticleBody(full, ARTICLE_TOKENS_PER_CALL);
	const truncated = text.length < full.length;
	return {
		summary: `读了《${article.title || '当前文章'}》正文${truncated ? '（前半部分）' : ''}`,
		content: JSON.stringify({
			title: article.title,
			slug: article.slug,
			outline,
			text,
			truncated,
			...(truncated
				? { hint: '正文太长，只给了前半部分。用 read_article({section}) 按小节标题把剩下的读回来。' }
				: {}),
		}),
	};
}

const DEFAULT_NOTE_LIMIT = 5;
/** 碎碎念一共十来条，一次给满也吃不掉多少上下文 */
const MAX_NOTE_LIMIT = 10;
const NOTE_EXCERPT_CHARS = 200;

/** 关键词模糊匹配：忽略大小写与空白，「南京」能命中「南京 · 玄武湖」 */
function fuzzyHit(value: string, needle: string): boolean {
	if (!needle) return true;
	const loose = (s: string) => s.toLowerCase().replace(/\s+/g, '');
	return loose(value).includes(loose(needle));
}

function paramText(args: Record<string, unknown>, key: string): string {
	return typeof args[key] === 'string' ? (args[key] as string).trim() : '';
}

/**
 * 读碎碎念（`/notes/` 时间线）。用户问「最近在干嘛」「最近心情怎么样」「去过哪」时用它 ——
 * 这些答案不在文章里，search 找不到。
 *
 * 封存中的时间胶囊端点已经滤掉，这里只把 sealedCount 如实交出去：模型能说「还有 N 条封存中」，
 * 手上却没有任何内容可讲 —— 想编也没有素材。
 */
async function readNotes(args: Record<string, unknown>, ctx: unknown): Promise<ToolResult> {
	const state = ctx as FindCtx;
	const { notes, sealedCount } = await state.loadNotes();

	const limitRaw = Number(args.limit);
	const limit =
		Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.trunc(limitRaw), MAX_NOTE_LIMIT) : DEFAULT_NOTE_LIMIT;

	const tag = paramText(args, 'tag');
	const mood = paramText(args, 'mood');
	const location = paramText(args, 'location');
	const since = paramText(args, 'since').slice(0, 10);

	const matched = notes.filter(
		(note) =>
			(!tag || note.tags.some((name) => fuzzyHit(name, tag))) &&
			fuzzyHit(note.mood, mood) &&
			fuzzyHit(note.location, location) &&
			(!since || note.published >= since),
	);

	// 端点已按「置顶优先 + 发布时间倒序」排好，这里只截断
	const picked = matched.slice(0, limit);
	const sealedNote =
		sealedCount > 0
			? `另外还有 ${sealedCount} 条碎碎念封存在时间胶囊里，到 unlockAt 才解锁。` +
				`索引里没有它们的内容：只能告诉访客「有 ${sealedCount} 条还在封存中」，不要猜、不要编。`
			: '';

	return {
		summary: picked.length
			? `读过 ${picked.length} 条碎碎念${sealedCount > 0 ? `（另有 ${sealedCount} 条封存中）` : ''}`
			: `没有匹配的碎碎念${sealedCount > 0 ? `（${sealedCount} 条封存中）` : ''}`,
		content: JSON.stringify({
			count: picked.length,
			sealedCount,
			notes: picked.map((note) => ({
				published: note.published,
				title: note.title,
				excerpt: note.excerpt.slice(0, NOTE_EXCERPT_CHARS),
				mood: note.mood,
				location: note.location,
				tags: note.tags,
				url: note.url,
			})),
			...(sealedNote ? { sealedNote } : {}),
			...(picked.length
				? {}
				: { hint: '没有匹配的条目。去掉筛选条件再读一次，或按用户问的时间范围调整 since。' }),
		}),
	};
}

/** 正文块文件的结构（见 src/pages/search-index/body/[doc]/[group].json.ts） */
interface BodyFile {
	chunks?: unknown;
}

/**
 * 拉一个正文块文件。null 表示越界（404）—— 这是「这篇拉完了」的正常终点；
 * 其余非 2xx 照旧抛，真正的故障不该被悄悄当成读完了。
 */
async function fetchBodyGroup(origin: string, doc: number, group: number): Promise<string[] | null> {
	const url = `${origin}/search-index/body/${doc}/${group}.json`;
	const resp = await fetch(url, { headers: { Accept: 'application/json' } });
	if (resp.status === 404) return null;
	if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
	const data = (await resp.json()) as BodyFile;
	return Array.isArray(data?.chunks) ? data.chunks.filter((c): c is string => typeof c === 'string' && !!c) : [];
}

function truncationHint(
	post: PostRecord,
	result: { nextGroup: number; requests: number; failed: string; stop: string },
): string {
	const resume = `read_post({url:"${post.url}", group:${result.nextGroup}}) 接着读（返回 text 为空说明已经到结尾）`;
	if (result.stop === 'failed') {
		return `第 ${result.requests} 个正文块拉取失败（${result.failed}），只给了已经拿到的部分。${resume}。`;
	}
	if (result.stop === 'requests') {
		return `单次最多 ${READ_POST_MAX_REQUESTS} 个正文块请求，这次已经用完，后面还有没读到的部分：${resume}。`;
	}
	if (result.stop === 'ceiling') {
		return `单次最多返回 ${READ_POST_MAX_CHARS} 字，再多就装不进上下文了，后面还有没读到的部分：${resume}。`;
	}
	return `已经达到本次 maxChars 预算，后面还有没读到的部分：${resume}；想一次读更多就调大 maxChars，上限 ${READ_POST_MAX_CHARS}。`;
}

/**
 * 读**任意**一篇文章的正文 —— 靠 url 定位，不依赖访客当前在哪个页面。
 *
 * 和 read_article 并存而不是合并：那边读的是访客正在看的那篇，正文由前端从 DOM 抽好
 * 递上来，零网络开销、还带前端切好的 sections；这边读的是「搜到了但访客没在看」的文章，
 * 服务端只能按块拉。合并只会把前端递上来的数据白扔掉。
 *
 * 预算的卡口全部在拉取过程中生效，不是先拉完再截（实现在 _post-body.ts）：
 * 1. 文档号必须从语料里查到。查不到直接报错 —— 猜号会把别人的正文递给模型；
 * 2. 累计字符触到 maxChars 就停手，不再发下一个请求；
 * 3. 请求数硬上限 READ_POST_MAX_REQUESTS，不随 maxChars 放大（最长那篇有 28 个正文块）。
 */
async function readPost(args: Record<string, unknown>, ctx: unknown): Promise<ToolResult> {
	const state = ctx as SearchCtx;
	const input = typeof args.url === 'string' ? args.url.trim() : '';
	if (!input) {
		return {
			summary: '缺少 url 参数',
			content: JSON.stringify({
				error: 'url 不能为空',
				hint: '先用 search 找到文章，再把结果里的 url（或 slug）原样传进来。',
			}),
		};
	}

	const wantedChars = Number(args.maxChars);
	const maxChars =
		Number.isFinite(wantedChars) && wantedChars > 0
			? Math.min(Math.trunc(wantedChars), READ_POST_MAX_CHARS)
			: READ_POST_DEFAULT_CHARS;
	const wantedGroup = Number(args.group);
	const startGroup = Number.isInteger(wantedGroup) && wantedGroup > 0 ? wantedGroup : 0;

	const posts = await state.loadPosts();
	const found = locatePost(posts, input);
	if (!found) {
		// 找不到就直说。绝不退化成「拿数组下标当文档号」这种猜测 —— 猜错了就是把别人的文章递出去
		return {
			summary: `站内没有「${input}」这篇`,
			content: JSON.stringify({
				error: `站内找不到这篇文章：${input}`,
				hint: 'url 要用 search 结果里给出的站内链接（形如 /posts/分类/slug/）或它的 slug，不要自己拼。还没搜到就先 search 一次。',
			}),
		};
	}

	const { post, id } = found;
	const result = await collectPostBody((group) => fetchBodyGroup(state.origin, id, group), {
		startGroup,
		maxChars,
		hardMaxChars: READ_POST_MAX_CHARS,
		maxRequests: READ_POST_MAX_REQUESTS,
	});

	if (!result.text) {
		// 续读时 group 已经越界：这不是错误，只是这篇读完了
		if (result.complete && startGroup > 0) {
			return {
				summary: `《${post.title}》已经读到结尾`,
				content: JSON.stringify({
					title: post.title,
					url: post.url,
					chars: 0,
					truncated: false,
					text: '',
					hint: `group ${startGroup} 及之后没有内容了，这篇正文已经读完。`,
				}),
			};
		}
		return {
			summary: `《${post.title}》没有可读正文`,
			content: JSON.stringify({
				title: post.title,
				url: post.url,
				error: result.failed
					? `拉正文失败：${result.failed}`
					: '这篇文章没有可提取的正文（可能是纯图片或空文章）',
				hint: result.failed
					? '过一会儿再试一次；访客正开着这篇时也可以用 read_article。'
					: '这篇没有文字正文，只能按标题和标签回答，别编造内容。',
			}),
		};
	}

	const truncated = !result.complete || !!result.failed;

	return {
		summary: `读了《${post.title}》正文 ${result.text.length} 字${truncated ? '（已截断）' : ''}`,
		content: JSON.stringify({
			title: post.title,
			slug: post.slug,
			url: post.url,
			published: post.published,
			category: post.category,
			tags: post.tags.slice(0, MAX_TAGS),
			chars: result.text.length,
			truncated,
			...(truncated ? { hint: truncationHint(post, result) } : {}),
			text: result.text,
		}),
	};
}

/**
 * 系列总览：站内有哪些成套的连载、各多少篇。只给名字、篇数和高频标签，
 * 章节列表留给 read_series —— 14 个系列全展开会把上下文一次吃光。
 */
async function listSeries(_args: Record<string, unknown>, ctx: unknown): Promise<ToolResult> {
	const state = ctx as SearchCtx;
	const posts = await state.loadPosts();
	const { totalSeries, totalPosts, series } = summarizeSeries(posts, MAX_SERIES, MAX_SERIES_TAGS);

	if (!totalSeries) {
		return {
			summary: '站内还没有系列',
			content: JSON.stringify({ totalSeries: 0, totalPosts: 0, series: [] }),
		};
	}

	return {
		summary: `${totalSeries} 个系列、${totalPosts} 篇`,
		content: JSON.stringify({ totalSeries, totalPosts, series }),
	};
}

/**
 * 读一个系列的完整章节表。章节顺序与 `/series/` 页面一致（排序规则见 _series.ts），
 * 所以可以放心说「第 3 章是某某」。
 */
async function readSeriesTool(args: Record<string, unknown>, ctx: unknown): Promise<ToolResult> {
	const state = ctx as SearchCtx;
	const wanted = typeof args.name === 'string' ? args.name.trim() : '';
	if (!wanted) {
		return {
			summary: '缺少 name 参数',
			content: JSON.stringify({
				error: 'name 不能为空',
				hint: '先用 list_series 看站内有哪些系列。',
			}),
		};
	}

	const posts = await state.loadPosts();
	const names = [...new Set(posts.filter((post) => (post.series ?? '').trim()).map((post) => post.series.trim()))];
	const matched = matchSeriesName(wanted, names);

	if (matched.kind === 'none') {
		return {
			summary: `没有「${wanted}」这个系列`,
			content: JSON.stringify({
				error: `站内没有名字匹配「${wanted}」的系列`,
				hint: '换更短的关键词，或先用 list_series 看全部系列。',
			}),
		};
	}

	if (matched.kind === 'ambiguous') {
		return {
			summary: `「${wanted}」命中 ${matched.candidates.length} 个系列`,
			content: JSON.stringify({
				query: wanted,
				ambiguous: true,
				candidates: matched.candidates,
				hint: '有多个系列匹配，从 candidates 里挑一个再调用 read_series({name})，不要自己猜。',
			}),
		};
	}

	const detail = readSeries(posts, matched.name);
	return {
		summary: `${detail.name}：${detail.count} 章`,
		content: JSON.stringify(detail),
	};
}

/**
 * 站内检索工具。`/find` 和 `/assistant` 共用同一份定义 —— 站内只有一套检索能力，
 * 两个 agent 不该各有各的玩法，也不该出现「一边能看分类、一边不能」这种偏差。
 */
export const SEARCH_TOOL: ToolDef = {
	name: 'search',
	description:
		'在本博客站内找文章，三种模式（默认 keyword）：\n' +
		'- keyword：按关键词检索，返回标题、站内链接、发布日期和摘要片段。' +
		'访客的问题里往往没有准确术语，换几种说法（中文关键词、英文术语、同义词、更小粒度的词）多调用几次，不要只搜一次就下结论。' +
		'count 为 0 说明这次没搜到，换关键词，或改用 mode:"categories" / mode:"recent"。\n' +
		'- categories：列出站内全部分类与篇数。访客没想好方向时，或几个关键词都搜不到时用它，据此给访客出选择题。\n' +
		'- recent：按发布时间列出最新的文章。访客问「最近写了什么」「有什么新文」这类跟时间有关、又没给主题的问题时用它，不要靠猜。',
	parameters: {
		type: 'object',
		properties: {
			mode: {
				type: 'string',
				enum: ['keyword', 'categories', 'recent'],
				description: 'keyword（默认）按关键词搜、categories 看分类、recent 看最新',
			},
			query: { type: 'string', description: 'mode=keyword 时的检索关键词，例如「JVM 垃圾回收」「Redis 持久化」' },
			limit: {
				type: 'integer',
				description: `keyword 默认 ${DEFAULT_LIMIT}（最多 ${MAX_LIMIT}），recent 默认 ${DEFAULT_RECENT}（最多 ${MAX_RECENT}）`,
			},
		},
	},
	run: searchSite,
};

export const TOOLS: ToolDef[] = [
	{
		name: 'read_article',
		description:
			'读取访客当前正在阅读的这篇文章的正文（纯文本）。' +
			'讲解、出题、批改，以及任何涉及文章内容的回答，都必须先调用它拿到正文，不要凭标题猜文章讲了什么。' +
			'正文过长时结果会被截断，同时返回 outline（小节标题列表），可以用 section 参数按小节标题补读剩下的部分。' +
			'访客不在文章页时它会返回错误说明。',
		parameters: {
			type: 'object',
			properties: {
				section: {
					type: 'string',
					description: '只读某一小节时传它的标题（或标题片段、outline 里的序号）；省略则读全文',
				},
			},
		},
		maxResultChars: ARTICLE_RESULT_CHARS,
		run: readArticle,
	},
	SEARCH_TOOL,
	{
		name: 'read_notes',
		description:
			'读博主的碎碎念（`/notes/` 时间线里的短笔记）：生活小事、随手记、当下心情和去过的地方。' +
			'用户问「最近在干嘛」「最近心情怎么样」「去过哪」「最近有什么新鲜事」这类关于博主本人的问题时用它，' +
			'不要去搜文章 —— 这些内容不在文章里。' +
			'返回日期、标题（没写标题时是正文首句）、摘要、心情、地点、标签和站内链接。' +
			'封存中的时间胶囊不会出现在结果里：只能告诉用户「有 N 条还在封存中」，绝不能猜测或编造它们的内容。',
		parameters: {
			type: 'object',
			properties: {
				limit: {
					type: 'integer',
					description: `返回条数，默认 ${DEFAULT_NOTE_LIMIT}，最多 ${MAX_NOTE_LIMIT}`,
				},
				tag: { type: 'string', description: '只看带这个标签的（如「生活」「踩坑」）' },
				mood: { type: 'string', description: '按心情关键词模糊筛选（如「平静」「累」）' },
				location: { type: 'string', description: '按地点关键词模糊筛选（如「南京」「家」）' },
				since: { type: 'string', description: '只看这个日期之后（含）的，格式 YYYY-MM-DD' },
			},
		},
		run: readNotes,
	},
	{
		name: 'list_series',
		description:
			'列出站内所有系列（成套的连载，如 JUC、Spring、MySQL）以及各自的篇数和高频标签。' +
			'访客问「都有哪些系列」「有没有成套的笔记」「某某专题有几篇」时用它。' +
			'系列有先后顺序，要看某一系列的具体章节和阅读顺序，用 read_series。',
		parameters: {
			type: 'object',
			properties: {},
		},
		run: listSeries,
	},
	{
		name: 'read_series',
		description:
			'读一个系列的章节表：按站内 /series/ 页面的顺序列出每一章的序号、标题、链接和发布日期。' +
			'访客问「JUC 该从哪篇读起」「这个系列有几章」「下一章是什么」时用它，' +
			'系列名先用 list_series 查准，不要凭印象编。' +
			'系列名匹配到多个时会把候选列出来，此时从候选里挑一个再调用，不要自己猜。',
		parameters: {
			type: 'object',
			properties: {
				name: {
					type: 'string',
					description: '系列名，例如「JUC」「Spring」「Python 面向对象」',
				},
			},
			required: ['name'],
		},
		run: readSeriesTool,
	},
	// 追加在末尾（不是插到中间）：多条分支同时往 TOOLS 加工具，末尾追加最不容易撞车
	{
		name: 'read_post',
		description:
			'读取站内**任意一篇文章**的正文（纯文本），靠 url 定位，不要求访客正打开它。' +
			'search 找到文章后要对内容作具体回答（讲了什么、某个点怎么说的、对比几篇）时用它，不要只凭 220 字摘要答。' +
			'url 传 search 结果里的 url 或 slug，别自己拼。默认只返回前 12000 字，正文更长时 truncated 为 true 并给 hint，' +
			'按 hint 里的 group 续读即可。访客正在阅读的那篇优先用 read_article（更快、带小节切分）。',
		parameters: {
			type: 'object',
			properties: {
				url: { type: 'string', description: '文章的站内链接（如 /posts/Java/JUC/JUC-synchronized/）或 slug' },
				maxChars: {
					type: 'integer',
					description: `正文最多返回多少字符，默认 ${READ_POST_DEFAULT_CHARS}，上限 ${READ_POST_MAX_CHARS}`,
				},
				group: { type: 'integer', description: '从第几个正文块开始读（默认 0）。只在续读截断结果时用 hint 里给的值' },
			},
			required: ['url'],
		},
		maxResultChars: READ_POST_RESULT_CHARS,
		run: readPost,
	},
];
