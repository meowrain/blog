import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type SearchDoc,
	collectFilterOptions,
	extractPhrases,
	highlightParts,
	highlightTokens,
	normalizeText,
	parseSearchIndex,
	rankFullText,
	searchDocs,
	tokenize,
} from "../src/utils/search-core.ts";

function doc(overrides: Partial<SearchDoc> & { title: string }): SearchDoc {
	return {
		id: 0,
		slug: overrides.title,
		url: `/posts/${overrides.title}/`,
		category: "",
		tags: [],
		published: "2026-01-01",
		headings: [],
		excerpt: "",
		...overrides,
	};
}

const docs: SearchDoc[] = [
	doc({
		title: "Redis 缓存过期与删除策略",
		slug: "redis-cache-expire",
		category: "中间件 > Redis",
		tags: ["Redis", "缓存过期"],
		published: "2026-03-02",
		headings: ["惰性删除", "定期删除"],
		excerpt: "Redis 提供两种过期键删除策略，配合内存淘汰策略使用。",
	}),
	doc({
		title: "MySQL 索引原理",
		slug: "mysql-index",
		category: "中间件 > MySQL",
		tags: ["MySQL", "索引"],
		published: "2026-02-01",
		headings: ["B+ 树", "最左前缀"],
		excerpt: "InnoDB 的聚簇索引与二级索引结构不同。",
	}),
	doc({
		title: "Java 线程池源码",
		slug: "java-threadpool",
		category: "Java > JUC",
		tags: ["Java", "JUC"],
		published: "2025-12-20",
		headings: ["核心参数", "拒绝策略"],
		excerpt: "ThreadPoolExecutor 的七个构造参数。",
	}),
	doc({
		title: "Golang 切片扩容",
		slug: "golang-slice",
		category: "Go",
		tags: ["Go", "切片"],
		published: "2025-11-11",
		headings: ["扩容规则"],
		excerpt: "切片扩容时的容量增长策略。",
	}),
];

describe("normalizeText", () => {
	it("归一化全角字符和大小写", () => {
		assert.equal(normalizeText("ＲＥＤＩＳ"), "redis");
		assert.equal(normalizeText("Java"), "java");
	});
});

describe("tokenize", () => {
	it("英文保持整词并转小写", () => {
		assert.deepEqual(tokenize("Redis MySQL"), ["redis", "mysql"]);
	});

	it("中文长词切成 bigram，短词保留原样", () => {
		assert.deepEqual(tokenize("缓存过期"), ["缓存", "存过", "过期"]);
		assert.deepEqual(tokenize("缓存"), ["缓存"]);
	});

	it("中英混排按书写系统拆开", () => {
		assert.deepEqual(tokenize("redis缓存"), ["redis", "缓存"]);
	});

	it("忽略标点并去重", () => {
		assert.deepEqual(tokenize("Redis, Redis！！"), ["redis"]);
		assert.deepEqual(tokenize("   "), []);
	});
});

describe("extractPhrases", () => {
	it("按空白和标点切出短语", () => {
		assert.deepEqual(extractPhrases("Redis 缓存, 过期"), [
			"redis",
			"缓存",
			"过期",
		]);
	});
});

describe("highlightTokens", () => {
	it("短查询返回 bigram 与单字，长查询额外保留完整短语", () => {
		assert.deepEqual(highlightTokens("线程池"), ["线程池", "线程", "程池"]);
		assert.deepEqual(highlightTokens("缓存"), ["缓存"]);
	});

	it("长短语排在 bigram 前面，高亮区间能合并成整段", () => {
		const parts = highlightParts(
			"线程池的拒绝策略",
			highlightTokens("拒绝策略"),
		);
		assert.ok(parts.some((part) => part.match && part.text === "拒绝策略"));
	});
});

describe("highlightParts", () => {
	it("标出所有匹配位置且不改动原文大小写", () => {
		const parts = highlightParts("Redis 和 redis 都是缓存", ["redis"]);
		assert.deepEqual(parts, [
			{ text: "Redis", match: true },
			{ text: " 和 ", match: false },
			{ text: "redis", match: true },
			{ text: " 都是缓存", match: false },
		]);
	});

	it("合并重叠/相邻的匹配区间", () => {
		assert.deepEqual(highlightParts("缓存过期", ["缓存", "过期"]), [
			{ text: "缓存过期", match: true },
		]);
		assert.deepEqual(highlightParts("缓存过期", ["缓存", "存过"]), [
			{ text: "缓存过", match: true },
			{ text: "期", match: false },
		]);
	});

	it("无匹配时返回整段非高亮文本", () => {
		assert.deepEqual(highlightParts("无关内容", ["redis"]), [
			{ text: "无关内容", match: false },
		]);
	});

	it("返回的片段拼起来等于原文（不丢失字符）", () => {
		const source = "前文 Redis 中间缓存过期后文";
		const joined = highlightParts(source, ["redis", "过期"])
			.map((part) => part.text)
			.join("");
		assert.equal(joined, source);
	});
});

describe("searchDocs", () => {
	it("中文 bigram 能命中连续中文的一部分", () => {
		const { hits, total } = searchDocs(docs, "过期");
		assert.equal(total, 1);
		assert.equal(hits[0].doc.slug, "redis-cache-expire");
	});

	it("多个关键词按 AND 组合", () => {
		assert.equal(searchDocs(docs, "redis 缓存").total, 1);
		assert.equal(searchDocs(docs, "redis mysql").total, 0);
	});

	it("标题命中排在正文命中前面", () => {
		const { hits } = searchDocs(docs, "索引");
		assert.equal(hits[0].doc.slug, "mysql-index");
	});

	it("支持 URL slug 搜索", () => {
		const { hits } = searchDocs(docs, "threadpool");
		assert.equal(hits[0].doc.slug, "java-threadpool");
	});

	it("按分类过滤", () => {
		const { hits, total } = searchDocs(docs, "", {
			category: "中间件 > Redis",
		});
		assert.equal(total, 1);
		assert.equal(hits[0].doc.slug, "redis-cache-expire");
	});

	it("父分类筛选包含子分类（与分类页口径一致）", () => {
		const { hits, total } = searchDocs(docs, "", { category: "中间件" });
		assert.equal(total, 2);
		assert.deepEqual(hits.map((hit) => hit.doc.slug).sort(), [
			"mysql-index",
			"redis-cache-expire",
		]);
	});

	it("父分类筛选不会跨到同名前缀的其他分类", () => {
		// "Java" 只应命中 "Java > JUC"，不应命中 "JavaScript" 之类
		const { hits, total } = searchDocs(
			[
				doc({ title: "a", slug: "a", category: "Java > JUC" }),
				doc({ title: "b", slug: "b", category: "JavaScript" }),
			],
			"",
			{ category: "Java" },
		);
		assert.equal(total, 1);
		assert.equal(hits[0].doc.slug, "a");
	});

	it("按标签过滤", () => {
		const { hits } = searchDocs(docs, "缓存", { tag: "缓存过期" });
		assert.equal(hits.length, 1);
		assert.equal(hits[0].doc.slug, "redis-cache-expire");
	});

	it("筛选无查询时按发布时间倒序", () => {
		const { hits } = searchDocs(docs, "", { category: "Java > JUC" });
		assert.equal(hits.length, 1);
		assert.equal(hits[0].doc.slug, "java-threadpool");
	});

	it("无查询无筛选时返回空结果", () => {
		assert.deepEqual(searchDocs(docs, ""), { hits: [], total: 0 });
	});

	it("total 反映过滤后的命中总数，limit 只截断返回条目", () => {
		const { hits, total } = searchDocs(docs, "a", { limit: 1 });
		assert.ok(total > 1);
		assert.equal(hits.length, 1);
	});

	it("标题高亮保留原始大小写", () => {
		const { hits } = searchDocs(docs, "redis");
		assert.equal(
			hits[0].titleParts.map((part) => part.text).join(""),
			"Redis 缓存过期与删除策略",
		);
		assert.ok(hits[0].titleParts.some((part) => part.match));
	});

	it("摘要优先展示命中上下文", () => {
		const { hits } = searchDocs(docs, "B+ 树");
		const snippet = hits[0].snippet.map((part) => part.text).join("");
		assert.match(snippet, /B\+ 树/);
	});
});

describe("parseSearchIndex", () => {
	it("解析 posts-index.json 的响应", () => {
		const docs = parseSearchIndex({
			count: 1,
			posts: [
				{
					title: "标题",
					slug: "slug",
					url: "/posts/slug/",
					category: "分类",
					tags: ["a", 1, "b"],
					published: "2026-01-01",
					headings: ["h1", null],
					excerpt: "摘要",
				},
			],
		});
		assert.deepEqual(docs, [
			{
				id: 0,
				title: "标题",
				slug: "slug",
				url: "/posts/slug/",
				category: "分类",
				tags: ["a", "b"],
				published: "2026-01-01",
				headings: ["h1"],
				excerpt: "摘要",
			},
		]);
	});

	it("跳过缺少 title/slug 的条目，并补默认值", () => {
		const docs = parseSearchIndex({
			posts: [
				{ slug: "no-title" },
				{ title: "no-slug" },
				{ title: "ok", slug: "ok" },
			],
		});
		assert.deepEqual(docs, [
			{
				// 文档号取原始下标（第 3 条），否则倒排表会指向别的文章
				id: 2,
				title: "ok",
				slug: "ok",
				url: "/posts/ok/",
				category: "",
				tags: [],
				published: "",
				headings: [],
				excerpt: "",
			},
		]);
	});

	it("响应结构不对时返回空数组", () => {
		assert.deepEqual(parseSearchIndex(null), []);
		assert.deepEqual(parseSearchIndex({}), []);
		assert.deepEqual(parseSearchIndex({ posts: "nope" }), []);
	});
});

describe("collectFilterOptions", () => {
	it("统计分类和标签数量并按数量倒序", () => {
		const options = collectFilterOptions(docs);
		// 父分类会被展开成独立选项：Go / Java / Java > JUC / 中间件 / 中间件 > MySQL / 中间件 > Redis
		assert.equal(options.categories.length, 6);
		assert.deepEqual(
			options.categories.map((option) => option.value).sort(),
			[
				"Go",
				"Java",
				"Java > JUC",
				"中间件",
				"中间件 > MySQL",
				"中间件 > Redis",
			].sort(),
		);
		const countOf = (value: string) =>
			options.categories.find((option) => option.value === value)?.count;
		assert.equal(countOf("中间件"), 2);
		assert.equal(countOf("中间件 > Redis"), 1);
		assert.equal(countOf("Java"), 1);
		assert.equal(options.tags.length, 8);
		assert.deepEqual(
			[...options.tags].sort((a, b) => a.value.localeCompare(b.value)),
			["Go", "JUC", "Java", "MySQL", "Redis", "切片", "缓存过期", "索引"]
				.sort((a, b) => a.localeCompare(b))
				.map((value) => ({ value, count: 1 })),
		);
	});

	it("重复标签累计数量并优先排序", () => {
		const options = collectFilterOptions([
			doc({ title: "a", tags: ["Redis", "缓存"] }),
			doc({ title: "b", tags: ["Redis"] }),
		]);
		assert.deepEqual(options.tags[0], { value: "Redis", count: 2 });
	});

	it("大小写不同的标签合并成一项，展示名取最常见的写法", () => {
		const options = collectFilterOptions([
			doc({ title: "a", tags: ["Java", "JAVA"] }),
			doc({ title: "b", tags: ["Java"] }),
			doc({ title: "c", tags: ["JAVA"] }),
			doc({ title: "d", tags: ["MySQL"] }),
		]);
		const java = options.tags.find(
			(option) => option.value.toLowerCase() === "java",
		);
		assert.deepEqual(java, { value: "Java", count: 3 });
		// 同一篇文章里的 Java + JAVA 只算一次
		assert.equal(
			options.tags.filter((option) => option.value.toLowerCase() === "java")
				.length,
			1,
		);
	});
});

describe("标签筛选的大小写归并", () => {
	it("筛选值大小写不一致也能命中文章", () => {
		const sample = [
			doc({ title: "a", slug: "a", tags: ["JAVA"] }),
			doc({ title: "b", slug: "b", tags: ["Java"] }),
			doc({ title: "c", slug: "c", tags: ["Go"] }),
		];
		for (const filter of ["Java", "JAVA", "java", " java "]) {
			const { total } = searchDocs(sample, "", { tag: filter });
			assert.equal(total, 2, `筛选 ${filter}`);
		}
	});

	it("全文检索时筛选同样归并大小写", () => {
		const sample = [
			doc({ title: "Redis 缓存", slug: "a", tags: ["MYSQL"], excerpt: "缓存" }),
			doc({
				title: "Redis 缓存二",
				slug: "b",
				tags: ["MySQL"],
				excerpt: "缓存",
			}),
			doc({ title: "Redis 缓存三", slug: "c", tags: ["Go"], excerpt: "缓存" }),
		];
		const postings = new Map<string, Map<number, number[]>>();
		const { total } = rankFullText(sample, "缓存", postings, { tag: "mysql" });
		assert.equal(total, 2);
	});
});
