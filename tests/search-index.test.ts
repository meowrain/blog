import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type SearchDoc,
	parseIndexVersion,
	rankFullText,
	snippetFromChunks,
} from "../src/utils/search-core.ts";
import {
	CHUNKS_PER_FILE,
	SHARD_COUNT,
	chunkGroupOf,
	collectQueryPostings,
	decodePostings,
	encodePostings,
	extractHeadings,
	shardForTerm,
	shardsForTokens,
	splitChunks,
	toPlainText,
	tokenizeDocument,
} from "../src/utils/search-index.ts";

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

function postingsOf(entries: Record<string, Record<number, number[]>>) {
	const map = new Map<string, Map<number, number[]>>();
	for (const [term, docs] of Object.entries(entries)) {
		map.set(
			term,
			new Map(Object.entries(docs).map(([id, chunks]) => [Number(id), chunks])),
		);
	}
	return map;
}

describe("tokenizeDocument", () => {
	it("中文切 bigram 并额外收录单字", () => {
		const tokens = tokenizeDocument("线程池");
		assert.ok(tokens.includes("线程"));
		assert.ok(tokens.includes("程池"));
		assert.ok(!tokens.includes("锁"));
		// 单字 run + 每个汉字都要能单独命中
		assert.deepEqual(tokenizeDocument("锁"), ["锁"]);
		for (const char of "线程池") assert.ok(tokens.includes(char));
	});

	it("英文整词小写，中英混排按书写系统拆开", () => {
		assert.deepEqual(tokenizeDocument("Redis缓存"), [
			"redis",
			"缓存",
			"缓",
			"存",
		]);
	});

	it("长中文 run 的每个单字都能被查到", () => {
		const tokens = new Set(tokenizeDocument("缓存过期"));
		for (const char of "缓存过期") assert.ok(tokens.has(char));
	});
});

describe("encodePostings / decodePostings", () => {
	it("往返编码保持文档号与块号", () => {
		const source = new Map<number, Set<number>>([
			[2, new Set([0, 3])],
			[7, new Set([1])],
			[9, new Set()],
		]);
		const decoded = decodePostings(encodePostings(source));
		assert.deepEqual([...decoded.keys()], [2, 7, 9]);
		assert.deepEqual(decoded.get(2), [0, 3]);
		assert.deepEqual(decoded.get(7), [1]);
		assert.deepEqual(decoded.get(9), []);
	});

	it("损坏的条目跳过而不是抛错", () => {
		const decoded = decodePostings("1.0,-,2.1");
		assert.deepEqual([...decoded.keys()], [1, 3]);
	});

	it("空值返回空表", () => {
		assert.equal(decodePostings(undefined).size, 0);
		assert.equal(decodePostings("").size, 0);
	});
});

describe("分片与倒排表拼装", () => {
	it("同一个词总是落在同一个分片", () => {
		assert.equal(shardForTerm("线程"), shardForTerm("线程"));
		assert.ok(shardForTerm("线程") < SHARD_COUNT);
	});

	it("多个词共用分片时只请求一次", () => {
		const shards = shardsForTokens(["redis", "缓存", "缓存"]);
		assert.equal(new Set(shards).size, shards.length);
	});

	it("collectQueryPostings 只取查询词，不碰同片其它词", () => {
		const token = "线程";
		const other = "无关";
		const shard = shardForTerm(token);
		const payload = new Map([
			[
				shard,
				{
					[token]: encodePostings(new Map([[0, new Set([1])]])),
					[other]: encodePostings(new Map([[5, new Set([9])]])),
				},
			],
		]);
		const postings = collectQueryPostings([token], payload);
		assert.deepEqual([...postings.get(token).keys()], [0]);
		assert.equal(postings.has(other), false);
	});
});

describe("splitChunks", () => {
	it("短文本只有一块", () => {
		assert.deepEqual(splitChunks("很短的一段话。"), ["很短的一段话。"]);
	});

	it("长文本按标点切块，块内不重复、拼接后内容完整", () => {
		const sentence = "这是一句用于测试切块的句子，长度足够。";
		const text = sentence.repeat(200);
		const chunks = splitChunks(text);
		assert.ok(chunks.length > 1);
		assert.equal(chunks.join(""), text);
	});

	it("块文件分组与 CHUNKS_PER_FILE 一致", () => {
		assert.equal(chunkGroupOf(0), 0);
		assert.equal(chunkGroupOf(CHUNKS_PER_FILE - 1), 0);
		assert.equal(chunkGroupOf(CHUNKS_PER_FILE), 1);
	});
});

describe("toPlainText / extractHeadings", () => {
	it("去掉代码块、图片和行内标记", () => {
		const plain = toPlainText(
			"---\ntitle: x\n---\n# 标题\n\n```js\nconst a = 1;\n```\n\n正文 **加粗** [链接](https://a.b)\n![图](x.png)",
		);
		assert.ok(!plain.includes("const a"));
		assert.ok(!plain.includes("!["));
		assert.ok(!plain.includes("**"));
		assert.ok(plain.includes("正文"));
		assert.ok(plain.includes("链接"));
	});

	it("抽取 2~4 级小节标题", () => {
		const headings = extractHeadings(
			"# 一级\n## 二级\n### 三级\n#### 四级\n##### 五级",
		);
		assert.deepEqual(headings, ["二级", "三级", "四级"]);
	});
});

describe("rankFullText", () => {
	const docs: SearchDoc[] = [
		doc({
			id: 0,
			title: "Redis 缓存",
			tags: ["Redis"],
			published: "2026-03-01",
		}),
		doc({ id: 1, title: "Java 线程池", published: "2026-02-01" }),
		doc({ id: 2, title: "杂项合集", published: "2026-01-01" }),
	];

	it("正文命中能召回标题里没写的文章", () => {
		const postings = postingsOf({ 线程: { 2: [4] } });
		const { hits } = rankFullText(docs, "线程", postings);
		const target = hits.find((hit) => hit.doc.id === 2);
		assert.ok(target);
		assert.deepEqual(target.chunks, [4]);
	});

	it("标题命中排在纯正文命中前面", () => {
		const postings = postingsOf({ 线程: { 1: [0], 2: [4] } });
		const { hits } = rankFullText(docs, "线程", postings);
		assert.equal(hits[0].doc.id, 1);
	});

	it("多关键词按 AND 组合，缺一个就不算命中", () => {
		const postings = postingsOf({
			redis: { 0: [0] },
			线程: { 1: [0], 2: [1] },
		});
		assert.equal(rankFullText(docs, "redis 线程", postings).total, 0);
	});

	it("块号按同时命中的关键词数排序", () => {
		const postings = postingsOf({
			缓存: { 0: [2, 5] },
			过期: { 0: [5] },
		});
		const { hits } = rankFullText(docs, "缓存 过期", postings);
		assert.deepEqual(hits[0].chunks, [5, 2]);
	});

	it("筛选条件先过滤再打分", () => {
		const postings = postingsOf({ 线程: { 1: [0], 2: [1] } });
		const { hits } = rankFullText(docs, "线程", postings, { tag: "Redis" });
		assert.equal(hits.length, 0);
	});

	it("没有查询词时返回空结果", () => {
		assert.deepEqual(rankFullText(docs, "", new Map()), { hits: [], total: 0 });
	});

	it("只命中元信息时摘要用首段，纯正文命中把摘要留给正文块", () => {
		const withExcerpt = [
			doc({ id: 0, title: "缓存", excerpt: "这是首段。" }),
			doc({ id: 1, title: "杂项" }),
		];
		const postings = postingsOf({ 缓存: { 1: [0] } });
		const { hits } = rankFullText(withExcerpt, "缓存", postings);
		const self = hits.find((hit) => hit.doc.id === 0);
		const body = hits.find((hit) => hit.doc.id === 1);
		assert.ok(self && self.snippet.length > 0);
		assert.deepEqual(body?.snippet, []);
	});
});

describe("parseIndexVersion", () => {
	it("把构建时间压成数字，用作缓存版本号", () => {
		assert.equal(
			parseIndexVersion({ generatedAt: "2026-10-21T01:22:25.123Z" }),
			"20261021012225",
		);
	});

	it("缺少字段时返回空串，请求就不带版本号", () => {
		assert.equal(parseIndexVersion(null), "");
		assert.equal(parseIndexVersion({}), "");
		assert.equal(parseIndexVersion({ generatedAt: 1 }), "");
	});
});

describe("snippetFromChunks", () => {
	it("截取关键词附近的文字并高亮", () => {
		const chunk = `${"前".repeat(80)}线程池的拒绝策略${"后".repeat(80)}`;
		const parts = snippetFromChunks([chunk], ["线程池"]);
		assert.ok(parts.some((part) => part.match && part.text === "线程池"));
	});

	it("没有匹配时退回块首", () => {
		const parts = snippetFromChunks(["一段没有任何关键词的文字"], ["redis"]);
		assert.equal(
			parts.map((part) => part.text).join(""),
			"一段没有任何关键词的文字",
		);
	});

	it("没有块时返回空数组", () => {
		assert.deepEqual(snippetFromChunks([], ["redis"]), []);
	});
});
