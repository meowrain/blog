import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDsmlFilter, stripDsml } from "../agents/_shared.ts";

/**
 * 线上真实泄漏的形态：模型把工具调用写成双竖线、带属性的 DSML 标记当正文吐出来。
 * 单层 `<｜…｜>` 的正则匹配不到它（`｜>` 后面还跟着属性），整段就漏到访客眼前。
 */
const LEAKED = [
	"<｜｜DSML｜｜ calls>",
	'<｜｜DSML｜｜ invoke name="radio_play">',
	'<｜｜DSML｜｜ parameter name="tracks" string="false">["3440441479"]',
	"</｜｜DSML｜｜ parameter>",
	"</｜｜DSML｜｜ invoke>",
	"</｜｜DSML｜｜ calls>",
].join("\n");

describe("stripDsml", () => {
	it("清掉带属性的双层竖线标记", () => {
		const cleaned = stripDsml(LEAKED);
		assert.ok(!cleaned.includes("DSML"), `还残留标记：${cleaned}`);
		assert.ok(!cleaned.includes("invoke"), `还残留调用体：${cleaned}`);
	});

	it("原来的单竖线 token 照旧清掉", () => {
		assert.equal(
			stripDsml("<｜tool▁calls▁begin｜>ok<｜tool▁calls▁end｜>"),
			"ok",
		);
	});

	it("普通正文与代码里的尖括号不动", () => {
		const text = "这是一段 a < b 的代码，竖线 | 也正常。";
		assert.equal(stripDsml(text), text);
	});
});

describe("createDsmlFilter", () => {
	it("逐 token 到达时不会漏出半个标记", () => {
		const filter = createDsmlFilter();
		let output = "";
		for (const piece of [
			"<",
			"｜｜DSML｜｜",
			" calls",
			">",
			"\n",
			'<｜｜DSML｜｜ invoke name="radio_play">',
			"\n",
			"</｜｜DSML｜｜ invoke>",
			"\n",
			"</｜｜DSML｜｜ calls>",
		]) {
			output += filter.feed(piece);
		}
		output += filter.flush();
		assert.ok(!output.includes("DSML"), `漏出来了：${output}`);
	});

	it("正常文本照常吐出，被扣住的尾巴由 flush 补上", () => {
		const filter = createDsmlFilter();
		let output = filter.feed("这是一段 a < b 的代码。");
		output += filter.flush();
		assert.equal(output, "这是一段 a < b 的代码。");
	});

	it("命中次数可观测", () => {
		const filter = createDsmlFilter();
		filter.feed("<｜tool▁calls▁begin｜>");
		assert.ok(filter.hits > 0);
	});
});
