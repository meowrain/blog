import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	createCollector,
	pushText,
	pushTool,
} from "../agents/_collector.ts";

/**
 * 回归：刷新页面后播放卡丢失。
 *
 * 工具结果原本只发 SSE、不入库，会话历史只有模型正文，恢复时自然画不出卡片。
 * 这里覆盖「文字与工具结果按顺序记录」的那点纯逻辑 —— agents/_agent-loop.ts
 * 用的是无扩展名 import，node --test 加载不了，所以逻辑拆到了 _collector.ts。
 */
describe("collector", () => {
	it("流式文字接在同一段，遇到工具结果才断开", () => {
		const c = createCollector();
		pushText(c, "好的，");
		pushText(c, "我去找歌。");
		pushTool(c, {
			id: "c1",
			name: "radio_play",
			args: "{}",
			summary: "7 首",
			content: '{"card":{}}',
			ok: true,
		});
		pushText(c, "播放卡出好了。");

		assert.deepEqual(
			c.parts.map((p) => p.kind),
			["text", "tool", "text"],
		);
		assert.equal(c.parts[0].kind === "text" && c.parts[0].content, "好的，我去找歌。");
		const tool = c.parts[1];
		assert.equal(tool.kind === "tool" && tool.name, "radio_play");
		assert.equal(tool.kind === "tool" && tool.content, '{"card":{}}');
	});

	it("空白片段不产生空 text 段", () => {
		const c = createCollector();
		pushText(c, "");
		assert.equal(c.parts.length, 0);
	});

	it("没有 collector 时调用不报错（find 等路由可以继续不传）", () => {
		assert.doesNotThrow(() => pushText(undefined, "x"));
		assert.doesNotThrow(() =>
			pushTool(undefined, {
				id: "c1",
				name: "t",
				args: "",
				summary: "",
				content: "",
				ok: true,
			}),
		);
	});
});
