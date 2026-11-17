import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type SeriesPostMeta,
	groupSeries,
	matchSeriesName,
	readSeries,
	seriesSlug,
	sortChapters,
	summarizeSeries,
} from "../agents/find/_series.ts";

function post(
	overrides: Partial<SeriesPostMeta> & { title: string },
): SeriesPostMeta {
	const slug = overrides.slug ?? overrides.title;
	return {
		slug,
		url: `/posts/${slug}/`,
		series: "JUC",
		published: "2026-01-01",
		tags: [],
		...overrides,
	};
}

describe("seriesSlug", () => {
	it("小写、空格转连字符、去标点", () => {
		assert.equal(seriesSlug("JUC"), "juc");
		assert.equal(seriesSlug("Python 面向对象"), "python-面向对象");
		assert.equal(seriesSlug("  C++ 面试 "), "c-面试");
	});

	it("纯标点得到空串", () => {
		assert.equal(seriesSlug("!!!"), "");
	});
});

describe("sortChapters", () => {
	it("seriesOrder 优先于发布时间", () => {
		const chapters = sortChapters([
			post({ title: "第三章", seriesOrder: 3, published: "2026-01-01" }),
			post({ title: "第一章", seriesOrder: 1, published: "2026-03-01" }),
			post({ title: "第二章", seriesOrder: 2, published: "2026-02-01" }),
		]);
		assert.deepEqual(
			chapters.map((c) => c.title),
			["第一章", "第二章", "第三章"],
		);
		assert.deepEqual(
			chapters.map((c) => c.index),
			[1, 2, 3],
		);
	});

	it("没写 seriesOrder 的排在后面，按发布时间升序", () => {
		const chapters = sortChapters([
			post({ title: "无序号后发", published: "2026-05-01" }),
			post({ title: "有序号", seriesOrder: 9, published: "2026-01-01" }),
			post({ title: "无序号先发", published: "2026-02-01" }),
		]);
		assert.deepEqual(
			chapters.map((c) => c.title),
			["有序号", "无序号先发", "无序号后发"],
		);
	});

	it("同一天发布按完整时间戳分先后，不是并列", () => {
		// JUC 有 10 章都发在 2026-02-18，只靠到天的 published 会退化成按标题排
		const chapters = sortChapters([
			post({
				title: "晚",
				published: "2026-02-18",
				publishedAt: "2026-02-18T21:15:17.000Z",
			}),
			post({
				title: "早",
				published: "2026-02-18",
				publishedAt: "2026-02-18T13:28:28.000Z",
			}),
			post({
				title: "中",
				published: "2026-02-18",
				publishedAt: "2026-02-18T18:44:10.000Z",
			}),
		]);
		assert.deepEqual(
			chapters.map((c) => c.title),
			["早", "中", "晚"],
		);
	});

	it("时间完全相同时用标题兜底，结果稳定", () => {
		const input = [
			post({
				title: "b",
				published: "2026-01-01",
				publishedAt: "2026-01-01T00:00:00.000Z",
			}),
			post({
				title: "a",
				published: "2026-01-01",
				publishedAt: "2026-01-01T00:00:00.000Z",
			}),
		];
		const once = sortChapters(input).map((c) => c.title);
		const twice = sortChapters([...input].reverse()).map((c) => c.title);
		assert.deepEqual(once, twice);
	});

	it("不改动入参", () => {
		const input = [
			post({ title: "b", published: "2026-02-01" }),
			post({ title: "a", published: "2026-01-01" }),
		];
		const snapshot = input.map((p) => p.title);
		sortChapters(input);
		assert.deepEqual(
			input.map((p) => p.title),
			snapshot,
		);
	});
});

describe("groupSeries", () => {
	it("series 为空或纯空白的文章不进任何系列", () => {
		const groups = groupSeries([
			post({ title: "在系列里" }),
			post({ title: "无系列", series: "" }),
			post({ title: "空白系列", series: "   " }),
		]);
		assert.deepEqual([...groups.keys()], ["JUC"]);
		assert.equal(groups.get("JUC")?.length, 1);
	});

	it("按系列分组并各自排好序", () => {
		const groups = groupSeries([
			post({ title: "JUC 2", series: "JUC", published: "2026-02-01" }),
			post({ title: "Spring 1", series: "Spring", published: "2026-01-01" }),
			post({ title: "JUC 1", series: "JUC", published: "2026-01-01" }),
		]);
		assert.deepEqual(
			groups.get("JUC")?.map((c) => c.title),
			["JUC 1", "JUC 2"],
		);
		assert.deepEqual(
			groups.get("Spring")?.map((c) => c.title),
			["Spring 1"],
		);
	});
});

describe("summarizeSeries", () => {
	const posts: SeriesPostMeta[] = [
		post({
			title: "JUC 1",
			series: "JUC",
			published: "2026-01-01",
			tags: ["并发", "Java"],
		}),
		post({
			title: "JUC 2",
			series: "JUC",
			published: "2026-02-01",
			tags: ["并发"],
		}),
		post({
			title: "JUC 3",
			series: "JUC",
			published: "2026-03-01",
			tags: ["并发"],
		}),
		post({
			title: "Spring 1",
			series: "Spring",
			published: "2026-05-01",
			tags: ["Spring"],
		}),
		post({ title: "零散", series: "" }),
	];

	it("按篇数降序，篇数相同时新的在前", () => {
		const { totalSeries, totalPosts, series } = summarizeSeries(posts, 15, 3);
		assert.equal(totalSeries, 2);
		assert.equal(totalPosts, 4);
		assert.deepEqual(
			series.map((s) => s.name),
			["JUC", "Spring"],
		);
		assert.deepEqual(series[0], {
			name: "JUC",
			slug: "juc",
			count: 3,
			latestPublished: "2026-03-01",
			tags: ["并发", "Java"],
		});
	});

	it("最多返回 maxSeries 个，但 totalSeries 仍是全量", () => {
		const { totalSeries, series } = summarizeSeries(posts, 1, 3);
		assert.equal(totalSeries, 2);
		assert.equal(series.length, 1);
	});

	it("topTags 按出现次数截断", () => {
		const { series } = summarizeSeries(posts, 15, 1);
		assert.deepEqual(series[0].tags, ["并发"]);
	});

	it("没有系列时返回空表", () => {
		const { totalSeries, totalPosts, series } = summarizeSeries(
			[post({ title: "x", series: "" })],
			15,
			3,
		);
		assert.equal(totalSeries, 0);
		assert.equal(totalPosts, 0);
		assert.deepEqual(series, []);
	});
});

describe("matchSeriesName", () => {
	const names = [
		"JUC",
		"Java 基础",
		"Java 集合",
		"Python 面向对象",
		"笔记合集",
	];

	it("精确匹配（大小写、全半角不敏感）", () => {
		assert.deepEqual(matchSeriesName("juc", names), {
			kind: "exact",
			name: "JUC",
		});
		assert.deepEqual(matchSeriesName(" Python  面向对象 ", names), {
			kind: "exact",
			name: "Python 面向对象",
		});
	});

	it("按锚点也能精确命中", () => {
		assert.deepEqual(matchSeriesName("python-面向对象", names), {
			kind: "exact",
			name: "Python 面向对象",
		});
	});

	it("模糊命中唯一时返回那一个", () => {
		assert.deepEqual(matchSeriesName("面向对象", names), {
			kind: "fuzzy",
			name: "Python 面向对象",
		});
	});

	it("模糊命中多条时返回候选，不瞎猜", () => {
		const matched = matchSeriesName("Java", names);
		assert.equal(matched.kind, "ambiguous");
		assert.deepEqual(matched.kind === "ambiguous" ? matched.candidates : [], [
			"Java 基础",
			"Java 集合",
		]);
	});

	it("完全对不上时 kind 为 none", () => {
		assert.deepEqual(matchSeriesName("Rust", names), {
			kind: "none",
			candidates: [],
		});
	});

	it("空串不匹配任何系列", () => {
		assert.deepEqual(matchSeriesName("   ", names), {
			kind: "none",
			candidates: [],
		});
	});
});

describe("readSeries", () => {
	const posts: SeriesPostMeta[] = [
		post({ title: "JUC 2", slug: "juc-2", published: "2026-02-01" }),
		post({ title: "JUC 1", slug: "juc-1", published: "2026-01-01" }),
	];

	it("给出锚点 URL 和排好序的章节", () => {
		const detail = readSeries(posts, "JUC");
		assert.equal(detail.slug, "juc");
		assert.equal(detail.url, "/series/#juc");
		assert.equal(detail.count, 2);
		assert.deepEqual(detail.chapters, [
			{
				index: 1,
				title: "JUC 1",
				slug: "juc-1",
				url: "/posts/juc-1/",
				published: "2026-01-01",
			},
			{
				index: 2,
				title: "JUC 2",
				slug: "juc-2",
				url: "/posts/juc-2/",
				published: "2026-02-01",
			},
		]);
	});
});
