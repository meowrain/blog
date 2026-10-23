import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type BacklinkSource,
	ESCAPED_WIKILINK_PLACEHOLDER,
	type ResolvedOutlink,
	buildBacklinkIndex,
	parseWikiLinks,
	protectEscapedWikiLinks,
	restoreEscapedWikiLinks,
} from "../src/utils/wikilink-core.ts";

describe("parseWikiLinks", () => {
	it("解析最简单的一层链接", () => {
		assert.deepEqual(parseWikiLinks("看 [[java-basics]] 那篇"), [
			{ target: "java-basics", start: 2, end: 17, raw: "[[java-basics]]" },
		]);
	});

	it("支持 | 自定义显示文字", () => {
		const [token] = parseWikiLinks("[[java-basics|Java 入门]]");
		assert.equal(token.target, "java-basics");
		assert.equal(token.text, "Java 入门");
	});

	it("支持 # 锚点，锚点保留原始中文", () => {
		const [token] = parseWikiLinks("[[java-basics#集合框架]]");
		assert.equal(token.target, "java-basics");
		assert.equal(token.anchor, "集合框架");
		assert.equal(token.text, undefined);
	});

	it("锚点和自定义文字可以同时出现", () => {
		const [token] = parseWikiLinks("[[java-basics#集合框架|看这里]]");
		assert.equal(token.target, "java-basics");
		assert.equal(token.anchor, "集合框架");
		assert.equal(token.text, "看这里");
	});

	it("首尾空格全部 trim，slug 里的空格也去掉", () => {
		const [token] = parseWikiLinks(
			"[[  java-basics  #  集合框架  |  看这里  ]]",
		);
		assert.equal(token.target, "java-basics");
		assert.equal(token.anchor, "集合框架");
		assert.equal(token.text, "看这里");
	});

	it("空 slug 不产生节点", () => {
		assert.deepEqual(parseWikiLinks("[[]]"), []);
		assert.deepEqual(parseWikiLinks("[[   ]]"), []);
		assert.deepEqual(parseWikiLinks("[[|只有文字]]"), []);
		assert.deepEqual(parseWikiLinks("[[#只有锚点]]"), []);
	});

	it("一段文本里的多个链接各自成节点，位置正确", () => {
		const tokens = parseWikiLinks("[[a]] 和 [[b|c]]");
		assert.equal(tokens.length, 2);
		assert.equal(tokens[0].target, "a");
		assert.equal(tokens[1].target, "b");
		assert.equal(tokens[1].text, "c");
	});

	it("没有双链时返回空数组", () => {
		assert.deepEqual(parseWikiLinks("普通的一段话，没有链接"), []);
		assert.deepEqual(parseWikiLinks("[[未闭合"), []);
		assert.deepEqual(parseWikiLinks("[[a]b]]"), []);
	});

	it("不把 shell 片段 [[ $a -lt 100 ]] 当链接", () => {
		// 正文里真写了 bash 的话，不能因为「不像 slug」就变成断链
		assert.deepEqual(parseWikiLinks("[[ $a -lt 100 ]]"), []);
		assert.deepEqual(parseWikiLinks("if [[ ! -f foo ]]; then"), []);
	});

	it("中文 / 带层级的 slug 都认", () => {
		assert.equal(
			parseWikiLinks("[[开发日记/uv-使用]]")[0].target,
			"开发日记/uv-使用",
		);
		assert.equal(parseWikiLinks("[[合集/Java.md]]")[0].target, "合集/Java.md");
	});

	it("转义：\\[[a]] 不算链接", () => {
		assert.deepEqual(parseWikiLinks("\\[[a]]"), []);
		// 双反斜杠是「转义的转义」，链接照常生效
		assert.equal(parseWikiLinks("\\\\[[a]]").length, 1);
	});

	it("转义经过 placeholder 处理后仍能识别真正的双链", () => {
		// micromark 会吃掉 \[ 里的反斜杠，插件看到的是保护后的文本
		const source = protectEscapedWikiLinks("\\[[escaped]] 但 [[real]] 是链接");
		assert.equal(source.includes("[[escaped]]"), false);

		const tokens = parseWikiLinks(source);
		assert.equal(tokens.length, 1);
		assert.equal(tokens[0].target, "real");

		// 还原后占位符变回一个字面量 [
		assert.equal(
			restoreEscapedWikiLinks(source.replace("[[real]]", "")),
			"[escaped]] 但  是链接",
		);
	});

	it("可以通过 isEscaped 注入「源码级」转义判断", () => {
		// micromark 吃掉反斜杠后，节点文本和源码对不上，插件会传一个
		// 基于源码 offset 的 isEscaped 进来；这里模拟它的语义。
		const text = "第一处 [[a]] 第二处 [[b]]";
		const escaped = new Set(["b"]);
		const tokens = parseWikiLinks(text, {
			isEscaped: ({ start }) => escaped.has(text.slice(start + 2, start + 3)),
		});
		assert.deepEqual(
			tokens.map((token) => token.target),
			["a"],
		);
	});

	it("占位符本身不含方括号，不会被后续解析吃掉", () => {
		assert.equal(ESCAPED_WIKILINK_PLACEHOLDER.includes("["), false);
		assert.equal(ESCAPED_WIKILINK_PLACEHOLDER.includes("]"), false);
	});
});

/** 造一篇「出链方」文章。 */
function source(slug: string, published = "2026-01-01"): BacklinkSource {
	return {
		slug,
		title: `${slug} 标题`,
		description: "",
		published: new Date(published),
		url: `/posts/${slug}/`,
	};
}

/** 造一条出链。 */
function outlink(
	target: string,
	owner: string,
	extra: Partial<ResolvedOutlink> = {},
): ResolvedOutlink {
	return { target, resolved: true, source: source(owner), ...extra };
}

describe("buildBacklinkIndex", () => {
	it("把出链反转成反向链接", () => {
		const index = buildBacklinkIndex(new Map([["a", [outlink("b", "a")]]]));
		assert.deepEqual(
			index.get("b")?.map((post) => post.slug),
			["a"],
		);
	});

	it("同一篇文章多次链接同一目标只算一条", () => {
		const index = buildBacklinkIndex(
			new Map([
				["a", [outlink("b", "a"), outlink("b", "a"), outlink("b", "a")]],
			]),
		);
		assert.equal(index.get("b")?.length, 1);
	});

	it("自引用被过滤", () => {
		const index = buildBacklinkIndex(
			new Map([["a", [outlink("a", "a"), outlink("b", "a")]]]),
		);
		assert.equal(index.get("a"), undefined);
		assert.equal(index.get("b")?.length, 1);
	});

	it("只保留已解析的目标，断链不产生反向链接", () => {
		const index = buildBacklinkIndex(
			new Map([
				["a", [outlink("b", "a"), outlink("ghost", "a", { resolved: false })]],
			]),
		);
		assert.equal(index.get("ghost"), undefined);
		assert.equal(index.get("b")?.length, 1);
	});

	it("多篇文章指向同一目标时按出现顺序收集", () => {
		const index = buildBacklinkIndex(
			new Map([
				["a", [outlink("c", "a")]],
				["b", [outlink("c", "b")]],
			]),
		);
		assert.deepEqual(
			index.get("c")?.map((post) => post.slug),
			["a", "b"],
		);
	});

	it("按 maxPerTarget 截断", () => {
		const index = buildBacklinkIndex(
			new Map([
				["a", [outlink("z", "a")]],
				["b", [outlink("z", "b")]],
				["c", [outlink("z", "c")]],
			]),
			2,
		);
		assert.equal(index.get("z")?.length, 2);
	});

	it("空输入得到空索引", () => {
		assert.equal(buildBacklinkIndex(new Map()).size, 0);
	});
});
