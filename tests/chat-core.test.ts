import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type ConversationMeta,
	deriveTitle,
	extractImageUrls,
	parseHistoryMessages,
	removeConversation,
	renameConversation,
	stripImageMarkdown,
	touchConversation,
	upsertConversation,
} from "../src/utils/chat-core.ts";

function meta(id: string, updatedAt: number, title = id): ConversationMeta {
	return { id, title, updatedAt };
}

describe("deriveTitle", () => {
	it("压掉换行与多余空白", () => {
		assert.equal(deriveTitle("  hello\n\n  world \t "), "hello world");
	});

	it("中文按字截到 24 个码点", () => {
		const text = "关".repeat(40);
		const title = deriveTitle(text);
		assert.equal(Array.from(title).length, 24);
		assert.equal(title, "关".repeat(24));
	});

	it("emoji 不会被切成半个（按码点而不是 UTF-16 单元）", () => {
		const text = "🎉".repeat(30);
		const title = deriveTitle(text);
		assert.equal(Array.from(title).length, 24);
		assert.equal(title, "🎉".repeat(24));
		assert.ok(!title.includes("\uFFFD"));
	});

	it("超长 ASCII 截断并保留可读前缀", () => {
		const title = deriveTitle("a".repeat(100));
		assert.equal(title.length, 24);
	});

	it("空输入回落，fallback 也遵守长度上限", () => {
		assert.equal(deriveTitle(""), "新对话");
		assert.equal(deriveTitle("   \n "), "新对话");
		assert.equal(deriveTitle("", "之前的对话"), "之前的对话");
		assert.equal(Array.from(deriveTitle("", "x".repeat(50))).length, 24);
	});
});

describe("upsertConversation", () => {
	it("返回新数组，不改入参", () => {
		const list = [meta("a", 1)];
		const next = upsertConversation(list, meta("b", 2));
		assert.notEqual(next, list);
		assert.equal(list.length, 1);
		assert.deepEqual(
			next.map((c) => c.id),
			["b", "a"],
		);
	});

	it("按 updatedAt 倒序", () => {
		const next = upsertConversation(
			upsertConversation([], meta("a", 1)),
			meta("b", 3),
		);
		assert.deepEqual(
			next.map((c) => c.id),
			["b", "a"],
		);
	});

	it("同 id 不重复，原位更新标题与时间", () => {
		const list = [meta("a", 5, "旧标题"), meta("b", 3)];
		const next = upsertConversation(list, meta("a", 9, "新标题"));
		assert.equal(next.length, 2);
		assert.equal(next[0].id, "a");
		assert.equal(next[0].title, "新标题");
	});

	it("超过上限淘汰最旧的一条", () => {
		let list: ConversationMeta[] = [];
		for (let i = 0; i < 5; i++)
			list = upsertConversation(list, meta(`c${i}`, i), 3);
		assert.deepEqual(
			list.map((c) => c.id),
			["c4", "c3", "c2"],
		);
	});

	it("默认上限 30", () => {
		let list: ConversationMeta[] = [];
		for (let i = 0; i < 40; i++)
			list = upsertConversation(list, meta(`c${i}`, i));
		assert.equal(list.length, 30);
		assert.equal(list[0].id, "c39");
		assert.equal(list[29].id, "c10");
	});
});

describe("removeConversation / renameConversation / touchConversation", () => {
	const list = [meta("a", 1, "甲"), meta("b", 2, "乙")];

	it("删除命中项，其余不动", () => {
		assert.deepEqual(
			removeConversation(list, "a").map((c) => c.id),
			["b"],
		);
		assert.equal(removeConversation(list, "zzz").length, 2);
	});

	it("重命名，空标题回落", () => {
		assert.equal(renameConversation(list, "a", "  新名字 ")[0].title, "新名字");
		assert.equal(renameConversation(list, "a", "   ")[0].title, "新对话");
		assert.equal(renameConversation(list, "b", "不动")[0].title, "甲");
	});

	it("touch 刷新时间并重排", () => {
		const next = touchConversation(list, "a", 100);
		assert.deepEqual(
			next.map((c) => c.id),
			["a", "b"],
		);
		assert.equal(next[0].updatedAt, 100);
	});
});

describe("extractImageUrls / stripImageMarkdown", () => {
	it("捞 Markdown 图片链接并去重", () => {
		const text =
			"看图\n![图片](https://img/a.jpg)\n![x](https://img/b.png)\n![again](https://img/a.jpg)";
		assert.deepEqual(extractImageUrls(text), [
			"https://img/a.jpg",
			"https://img/b.png",
		]);
	});

	it("没有图片时返回空数组", () => {
		assert.deepEqual(extractImageUrls("普通文本"), []);
	});

	it("去掉末尾的图片行，前面正文保留", () => {
		assert.equal(
			stripImageMarkdown(
				"这是什么？\n![图片](https://img/a.jpg)\n![图片](https://img/b.jpg)",
			),
			"这是什么？",
		);
	});

	it("正文中间的图片不动", () => {
		const text = "前 ![图片](https://img/a.jpg) 后";
		assert.equal(stripImageMarkdown(text), text);
	});
});

describe("parseHistoryMessages", () => {
	it("优先读 metadata.images，正文里的 Markdown 图片被剥掉", () => {
		const turns = parseHistoryMessages([
			{
				role: "user",
				content: "看图\n![图片](https://img/a.jpg)",
				metadata: { images: ["https://img/a.jpg"] },
			},
			{ role: "assistant", content: "这是一只猫" },
		]);
		assert.equal(turns.length, 2);
		assert.equal(turns[0].content, "看图");
		assert.deepEqual(turns[0].images, ["https://img/a.jpg"]);
		assert.deepEqual(turns[1].images, []);
	});

	it("没有 metadata 时用正则回捞", () => {
		const turns = parseHistoryMessages([
			{
				role: "user",
				content: "看图\n![图片](https://img/a.jpg)\n![图片](https://img/b.jpg)",
			},
		]);
		assert.deepEqual(turns[0].images, [
			"https://img/a.jpg",
			"https://img/b.jpg",
		]);
		assert.equal(turns[0].content, "看图");
	});

	it("老数据（纯文本、无图片）原样保留", () => {
		const turns = parseHistoryMessages([{ role: "user", content: "老消息" }]);
		assert.deepEqual(turns[0], { role: "user", content: "老消息", images: [] });
	});

	it("脏数据被跳过，读不到就返回空", () => {
		assert.deepEqual(parseHistoryMessages(null), []);
		assert.deepEqual(parseHistoryMessages("nope"), []);
		assert.deepEqual(
			parseHistoryMessages([
				null,
				1,
				{ role: "system", content: "x" },
				{ role: "user", content: "" },
			]),
			[],
		);
	});

	it("超出 limit 时保留最新的几条", () => {
		const raw = Array.from({ length: 10 }, (_, i) => ({
			role: i % 2 === 0 ? "user" : "assistant",
			content: `m${i}`,
		}));
		const turns = parseHistoryMessages(raw, 3);
		assert.deepEqual(
			turns.map((t) => t.content),
			["m7", "m8", "m9"],
		);
	});
});
