import type { PostRecord } from './_corpus';
import type { ToolDef, ToolResult } from '../_agent-loop';

/**
 * `/find` 的工具注册表。加新能力就往 TOOLS 里加一条，tool loop 和前端都不用动。
 *
 * 返回体刻意做得瘦：模型上下文里最贵的就是工具结果，所以条数、每条带什么字段、
 * 回灌进上下文的长度都卡死了（见 _agent-loop.ts 的预算常量）。
 */

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 8;
const MAX_TAGS = 4;
const MAX_MATCHED_HEADINGS = 3;
const SNIPPET_CHARS = 80;
/** 命中分下限。分数已按 idf 加权，所以这里只需拦掉「几乎全站都有」的词带来的噪声 */
const MIN_SCORE = 1;

const FIELD_WEIGHTS = { title: 3, tags: 2, category: 1.5, headings: 1.5, excerpt: 1 } as const;

export interface FindCtx {
	origin: string;
	loadPosts: () => Promise<PostRecord[]>;
	/** 本次请求里已经返回过的文章 —— 重复命中只给标题和链接 */
	seen: Set<string>;
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

function matchedHeadings(post: PostRecord, terms: string[]): string[] {
	const out: string[] = [];
	for (const heading of post.headings) {
		const lower = heading.toLowerCase();
		if (terms.some((t) => lower.includes(t))) out.push(heading);
		if (out.length >= MAX_MATCHED_HEADINGS) break;
	}
	return out;
}

async function searchPosts(args: Record<string, unknown>, ctx: unknown): Promise<ToolResult> {
	const state = ctx as FindCtx;
	const query = typeof args.query === 'string' ? args.query.trim() : '';
	if (!query) {
		return { summary: '缺少 query 参数', content: JSON.stringify({ error: 'query 不能为空' }) };
	}
	const limitRaw = Number(args.limit);
	const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.trunc(limitRaw), MAX_LIMIT) : DEFAULT_LIMIT;

	const posts = await state.loadPosts();
	const terms = splitTerms(query);
	if (!terms.length) {
		return { summary: '关键词全是标点', content: JSON.stringify({ count: 0, hint: '换几个实词再试' }) };
	}

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

	if (!ranked.length) {
		return {
			summary: `「${query}」没有命中`,
			content: JSON.stringify({
				query,
				count: 0,
				hint: '没有匹配到文章。换更具体的关键词（术语、英文名、具体技术名），或先用 list_categories 看看站内有哪些方向。',
			}),
		};
	}

	const results = ranked.map(({ post, terms: matched }) => {
		if (state.seen.has(post.slug)) {
			// 已经给过这篇了：只留标题和链接，省掉摘要
			return { title: post.title, url: post.url, seen: true };
		}
		state.seen.add(post.slug);
		const headings = matchedHeadings(post, matched);
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

async function listCategories(_args: Record<string, unknown>, ctx: unknown): Promise<ToolResult> {
	const state = ctx as FindCtx;
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
		.slice(0, 15)
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
	const state = ctx as FindCtx;
	const posts = await state.loadPosts();
	const limitRaw = Number(args.limit);
	const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.trunc(limitRaw), 10) : 6;

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

export const TOOLS: ToolDef[] = [
	{
		name: 'search_posts',
		description:
			'在本博客站内按关键词检索文章，返回标题、站内链接、发布日期和摘要片段。' +
			'可以换几种说法（中文关键词、英文术语、同义词）多调用几次，把不同角度都试一遍。' +
			'返回 count 为 0 说明这次没搜到，需要换关键词，或改用 list_categories / list_recent_posts。',
		parameters: {
			type: 'object',
			properties: {
				query: { type: 'string', description: '检索关键词，例如「JVM 垃圾回收」「Redis 持久化」' },
				limit: { type: 'integer', description: `返回条数，默认 ${DEFAULT_LIMIT}，最多 ${MAX_LIMIT}` },
			},
			required: ['query'],
		},
		run: searchPosts,
	},
	{
		name: 'list_categories',
		description:
			'列出站内所有分类（含篇数与代表性标签）。适合用户还没想好具体看什么、想问「站里都有些什么」的时候用。',
		parameters: { type: 'object', properties: {} },
		run: listCategories,
	},
	{
		name: 'list_recent_posts',
		description:
			'按发布时间列出最新的文章。用户问「最近写了什么」「有什么新文」这类跟时间有关、又没给主题的问题时用它。',
		parameters: {
			type: 'object',
			properties: {
				limit: { type: 'integer', description: '返回条数，默认 6，最多 10' },
			},
		},
		run: listRecentPosts,
	},
];
