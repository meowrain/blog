import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildOgCardQuery,
	buildOgCardUrl,
} from "../src/utils/og-card.ts";

const parse = (query: string) => new URLSearchParams(query);

describe("buildOgCardQuery", () => {
	it("拼出 type 与标题，空字段不落进查询串", () => {
		const query = parse(buildOgCardQuery("playlist", { title: "我喜欢的音乐" }));
		assert.equal(query.get("type"), "playlist");
		assert.equal(query.get("title"), "我喜欢的音乐");
		assert.equal(query.has("subtitle"), false);
		assert.equal(query.has("date"), false);
	});

	it("指标用「标签:数值」并用 | 连接", () => {
		const query = parse(
			buildOgCardQuery("year", {
				title: "2025 年度报告",
				stats: [
					{ label: "篇文章", value: "112" },
					{ label: "总字数", value: "82.2 万字" },
				],
			}),
		);
		assert.equal(query.get("stats"), "篇文章:112|总字数:82.2 万字");
	});

	it("标签里的冒号与竖线会被剥掉，避免和分隔符混淆", () => {
		const query = parse(
			buildOgCardQuery("monitor", {
				title: "集群",
				stats: [{ label: "CPU:核|心", value: "12" }],
			}),
		);
		assert.equal(query.get("stats"), "CPU核心:12");
	});

	it("数值里的竖线同样剥掉，标签里的逗号不会被当成标签分隔", () => {
		const query = parse(
			buildOgCardQuery("bangumi", {
				title: "追番",
				stats: [{ label: "评分", value: "8|2" }],
				tags: ["轻小说改", "异世界,穿越", "恋爱"],
			}),
		);
		assert.equal(query.get("stats"), "评分:82");
		assert.equal(query.get("tags"), "轻小说改,恋爱");
	});

	it("标签最多 6 个、指标最多 6 格、柱条最多 12 根", () => {
		const query = parse(
			buildOgCardQuery("playlist", {
				title: "歌单",
				tags: Array.from({ length: 9 }, (_, i) => `tag${i}`),
				stats: Array.from({ length: 9 }, (_, i) => ({
					label: `l${i}`,
					value: `v${i}`,
				})),
				bars: Array.from({ length: 20 }, (_, i) => i),
			}),
		);
		assert.equal(query.get("tags")?.split(",").length, 6);
		assert.equal(query.get("stats")?.split("|").length, 6);
		assert.equal(query.get("bars")?.split(",").length, 12);
	});

	it("柱条只保留有限的非负数并取整", () => {
		const query = parse(
			buildOgCardQuery("year", {
				title: "年度",
				bars: [0, 1.4, -2, Number.NaN, Number.POSITIVE_INFINITY, 3],
			}),
		);
		assert.equal(query.get("bars"), "0,1,3");
	});

	it("空指标格与空标签会被丢掉", () => {
		const query = parse(
			buildOgCardQuery("monitor", {
				title: "集群",
				stats: [
					{ label: "", value: "1" },
					{ label: "CPU", value: "   " },
					{ label: "内存", value: "6 GB" },
				],
				tags: ["", "   "],
			}),
		);
		assert.equal(query.get("stats"), "内存:6 GB");
		assert.equal(query.has("tags"), false);
	});
});

describe("buildOgCardUrl", () => {
	it("拼到云函数路由下，去掉 base 末尾与 slug 首尾的斜杠", () => {
		const url = buildOgCardUrl(
			"https://blog-edgeone.meowrain.cn/",
			"year",
			"/year-2025/",
			{ title: "2025 年度报告" },
		);
		assert.ok(url.startsWith("https://blog-edgeone.meowrain.cn/api/og/year-2025?"));
		assert.ok(url.includes("type=year"));
	});

	it("slug 为空时退回 card，路径不会退化成 /api/og/", () => {
		// catch-all 只匹配 /api/og/(.*)，空路径会 404
		const url = buildOgCardUrl("https://example.com", "music", "", {
			title: "歌单",
		});
		assert.ok(url.startsWith("https://example.com/api/og/card?"));
	});
});
