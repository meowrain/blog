import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type BackgroundSource,
	appendCacheBuster,
	buildBackgroundPlan,
	resolveSourceUrl,
	shuffleSources,
} from "../src/utils/background-core.ts";

const sources: BackgroundSource[] = [
	{ name: "a", url: "https://a.example/pc?w={width}" },
	{
		name: "b",
		url: "https://b.example/pc/",
		mobileUrl: "https://b.example/mp/",
	},
	{ name: "c", url: "https://c.example/pc/" },
];

/** 固定序列的随机源，让洗牌结果可预测。 */
function seeded(values: number[]) {
	let index = 0;
	return () => values[index++ % values.length];
}

describe("shuffleSources", () => {
	it("不改动入参，且元素不增不减", () => {
		const input = [1, 2, 3, 4];
		const output = shuffleSources(input, () => 0);
		assert.deepEqual(input, [1, 2, 3, 4]);
		assert.deepEqual([...output].sort(), [1, 2, 3, 4]);
	});

	it("随机序列固定时结果是确定的", () => {
		const first = shuffleSources(sources, seeded([0.9, 0.1, 0.5]));
		const second = shuffleSources(sources, seeded([0.9, 0.1, 0.5]));
		assert.deepEqual(
			first.map((item) => item.name),
			second.map((item) => item.name),
		);
	});
});

describe("resolveSourceUrl", () => {
	it("桌面端用 url，不替换占位符时保持原样", () => {
		assert.equal(
			resolveSourceUrl(sources[0]),
			"https://a.example/pc?w={width}",
		);
	});

	it("按 width 替换 {width} 占位符并取整", () => {
		assert.equal(
			resolveSourceUrl(sources[0], { width: 1920.4 }),
			"https://a.example/pc?w=1920",
		);
	});

	it("移动端优先用 mobileUrl，没有则回落到 url", () => {
		assert.equal(
			resolveSourceUrl(sources[1], { mobile: true }),
			"https://b.example/mp/",
		);
		assert.equal(
			resolveSourceUrl(sources[2], { mobile: true }),
			"https://c.example/pc/",
		);
	});

	it("width 非法时不替换", () => {
		assert.equal(
			resolveSourceUrl(sources[0], { width: 0 }),
			"https://a.example/pc?w={width}",
		);
	});
});

describe("buildBackgroundPlan", () => {
	it("按 maxAttempts 截断，默认 3 个", () => {
		assert.equal(buildBackgroundPlan(sources, { random: () => 0.5 }).length, 3);
		assert.equal(
			buildBackgroundPlan(sources, { random: () => 0.5, maxAttempts: 1 })
				.length,
			1,
		);
	});

	it("源比 maxAttempts 少时全部返回", () => {
		assert.equal(
			buildBackgroundPlan(sources.slice(0, 2), { random: () => 0.5 }).length,
			2,
		);
	});

	it("每次调用都会重新洗牌，顺序不固定", () => {
		const first = buildBackgroundPlan(sources, {
			random: seeded([0.1, 0.2, 0.3]),
			maxAttempts: 3,
		});
		const second = buildBackgroundPlan(sources, {
			random: seeded([0.9, 0.8, 0.7]),
			maxAttempts: 3,
		});
		assert.notDeepEqual(first, second);
	});

	it("返回的是完整 URL：占位符已替换、移动端已切换", () => {
		const plan = buildBackgroundPlan(sources, {
			random: () => 0.5,
			width: 1280,
			mobile: true,
			maxAttempts: 3,
		});
		assert.ok(plan.every((url) => !url.includes("{width}")));
		assert.ok(plan.some((url) => url.includes("/mp/")) || plan.length < 3);
	});
});

describe("appendCacheBuster", () => {
	it("给带查询串的 URL 追加参数", () => {
		assert.equal(
			appendCacheBuster("https://a.example/pc?w=1920", "42"),
			"https://a.example/pc?w=1920&_bg=42",
		);
	});

	it("给没有查询串的 URL 起一个新参数", () => {
		assert.equal(
			appendCacheBuster("https://a.example/pc/", "42"),
			"https://a.example/pc/?_bg=42",
		);
	});

	it("保留 hash", () => {
		assert.equal(
			appendCacheBuster("https://a.example/pc/#top", "42"),
			"https://a.example/pc/?_bg=42#top",
		);
	});

	it("支持相对路径", () => {
		assert.equal(appendCacheBuster("/x.jpg", "42"), "/x.jpg?_bg=42");
	});

	it("token 为空时原样返回", () => {
		assert.equal(appendCacheBuster("/x.jpg", ""), "/x.jpg");
	});
});
