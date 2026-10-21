import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	compareNotes,
	compareProjects,
	formatContentDate,
	formatContentDateTime,
	noteAnchor,
	noteHeading,
	toPlainText,
	topTagsOf,
	writingYearsSince,
} from "../src/utils/personal-core.ts";

const at = (iso: string) => new Date(iso);

describe("formatContentDate", () => {
	it("按 UTC 取 frontmatter 里写的日期", () => {
		assert.equal(
			formatContentDate(new Date("2026-01-05T23:59:00Z")),
			"2026-01-05",
		);
	});

	it("跨时区不会把日期挪到前一天", () => {
		// YAML 里不带时区的时间会被当成 UTC，显示时也必须按 UTC 还原
		assert.equal(
			formatContentDate(new Date("2026-10-20T23:40:00Z")),
			"2026-10-20",
		);
	});
});

describe("formatContentDateTime", () => {
	it("输出日期和时分", () => {
		assert.equal(
			formatContentDateTime(new Date("2026-03-09T08:07:00Z")),
			"2026-03-09 08:07",
		);
	});
});

describe("toPlainText", () => {
	it("去掉代码块、图片、链接语法和多余空白", () => {
		const markdown = [
			"# 标题",
			"",
			"看这个 [链接](https://example.com) 和 ![图](./a.png)。",
			"",
			"```js",
			"const a = 1;",
			"```",
		].join("\n");
		assert.equal(toPlainText(markdown), "标题 看这个 链接 和 。");
	});
});

describe("noteHeading", () => {
	it("有 title 时直接用 title", () => {
		assert.equal(
			noteHeading({
				title: "  今天的雨  ",
				published: at("2026-01-01"),
				body: "正文",
			}),
			"今天的雨",
		);
	});

	it("没 title 时取正文第一句", () => {
		assert.equal(
			noteHeading({
				title: "",
				published: at("2026-01-01"),
				body: "第一句在这里。第二句不该出现。",
			}),
			"第一句在这里。",
		);
	});

	it("第一句过长时截断并加省略号", () => {
		const heading = noteHeading(
			{ title: "", published: at("2026-01-01"), body: "长".repeat(100) },
			10,
		);
		assert.equal(heading, `${"长".repeat(10)}…`);
	});

	it("正文为空时回退到发布日期", () => {
		assert.equal(
			noteHeading({
				title: "",
				published: new Date("2026-03-09T08:00:00Z"),
				body: "",
			}),
			"2026-03-09",
		);
	});
});

describe("noteAnchor", () => {
	it("斜杠和空白变成连字符，中文保留", () => {
		assert.equal(noteAnchor("生活/随手 一拍"), "生活-随手-一拍");
	});
});

describe("compareNotes", () => {
	it("置顶优先，其余按时间倒序", () => {
		const notes = [
			{ pinned: false, published: at("2026-01-01") },
			{ pinned: false, published: at("2026-03-01") },
			{ pinned: true, published: at("2025-01-01") },
		].sort(compareNotes);
		assert.deepEqual(
			notes.map((note) => note.published.getFullYear()),
			[2025, 2026, 2026],
		);
		assert.equal(notes[1].published.getMonth(), 2);
	});
});

describe("compareProjects", () => {
	it("order 小的在前；没写 order 的按精选和时间兜底", () => {
		const projects = [
			{ order: undefined, featured: false, published: at("2026-01-01") },
			{ order: 2, featured: true, published: at("2024-01-01") },
			{ order: 1, featured: false, published: at("2023-01-01") },
			{ order: undefined, featured: true, published: at("2025-01-01") },
		].sort(compareProjects);
		assert.deepEqual(
			projects.map((project) => project.order ?? "none"),
			[1, 2, "none", "none"],
		);
		assert.equal(projects[2].featured, true);
	});
});

describe("writingYearsSince", () => {
	it("头尾都算一年", () => {
		assert.equal(
			writingYearsSince(new Date(2024, 11, 31), new Date(2026, 0, 1)),
			3,
		);
	});

	it("没有文章时是 0", () => {
		assert.equal(writingYearsSince(null), 0);
	});
});

describe("topTagsOf", () => {
	it("按数量倒序、同数量按名称排序，并截断", () => {
		const tags = topTagsOf(
			[["Java", "Redis"], ["Java", "MySQL"], ["Redis"]],
			2,
		);
		assert.deepEqual(tags, [
			{ name: "Java", count: 2 },
			{ name: "Redis", count: 2 },
		]);
	});
});
