import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	compareNotes,
	compareProjects,
	countdownTo,
	formatContentDate,
	formatContentDateTime,
	formatCountdown,
	isSealed,
	noteAnchor,
	noteHeading,
	sealedNoteHeading,
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

describe("isSealed", () => {
	it("没写 unlockAt 的碎碎念永远是已解锁", () => {
		assert.equal(isSealed(undefined), false);
		assert.equal(isSealed(null), false);
	});

	it("解锁时间之前封存，到点（含之后）解锁", () => {
		const unlockAt = at("2027-01-01T00:00:00Z");
		assert.equal(isSealed(unlockAt, at("2026-12-31T23:59:59Z")), true);
		assert.equal(isSealed(unlockAt, at("2027-01-01T00:00:00Z")), false);
		assert.equal(isSealed(unlockAt, at("2027-06-01T00:00:00Z")), false);
	});
});

describe("countdownTo", () => {
	it("拆成天时分秒", () => {
		assert.deepEqual(
			countdownTo(at("2027-01-02T03:04:05Z"), at("2027-01-01T00:00:00Z")),
			{ days: 1, hours: 3, minutes: 4, seconds: 5, totalMs: 97_445_000 },
		);
	});

	it("已到点时归零，不出现负数", () => {
		const parts = countdownTo(
			at("2027-01-01T00:00:00Z"),
			at("2027-02-01T00:00:00Z"),
		);
		assert.equal(parts.totalMs, 0);
		assert.deepEqual(
			[parts.days, parts.hours, parts.minutes, parts.seconds],
			[0, 0, 0, 0],
		);
	});
});

describe("formatCountdown", () => {
	it("超过一天带上天数", () => {
		assert.equal(
			formatCountdown(at("2027-01-02T03:04:05Z"), at("2027-01-01T00:00:00Z")),
			"1 天 03:04:05",
		);
	});

	it("不足一天只显示时钟", () => {
		assert.equal(
			formatCountdown(at("2027-01-01T01:02:03Z"), at("2027-01-01T00:00:00Z")),
			"01:02:03",
		);
	});
});

describe("sealedNoteHeading", () => {
	it("占位标题带上解锁日期", () => {
		assert.equal(
			sealedNoteHeading(at("2027-01-01T00:00:00Z")),
			"封存中的时间胶囊 · 2027-01-01 解锁",
		);
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
