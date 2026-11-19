import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	formatDuration,
	toRadioQueue,
	toolRadioCard,
} from "../src/components/chat/radio-card.ts";

const payload = (tracks: unknown[], title?: string) =>
	JSON.stringify({ card: { title, tracks } });

describe("toolRadioCard", () => {
	it("解析出曲目与串词，缺字段的条目丢掉", () => {
		const card = toolRadioCard(
			payload([
				{
					id: "1",
					name: "出山",
					artists: "花粥 / 王胜娚",
					cover: "https://example.com/a.jpg",
					duration: 200,
					intro: "先来一首《出山》。",
				},
				{ id: "", name: "没有 id" },
				{ id: "2", name: "" },
			]),
		);
		assert.ok(card);
		assert.equal(card.tracks.length, 1);
		assert.equal(card.tracks[0].name, "出山");
		assert.equal(card.tracks[0].intro, "先来一首《出山》。");
		assert.equal(card.title, "电台");
	});

	it("同一首重复出现只留一次", () => {
		const card = toolRadioCard(
			payload([
				{ id: "1", name: "A" },
				{ id: "1", name: "A" },
			]),
		);
		assert.equal(card?.tracks.length, 1);
	});

	it("不是播放卡形状时返回 null（站内检索的结果不该被画成电台）", () => {
		assert.equal(
			toolRadioCard(JSON.stringify({ posts: [{ title: "x", url: "/y" }] })),
			null,
		);
		assert.equal(
			toolRadioCard(JSON.stringify({ card: { tracks: "nope" } })),
			null,
		);
		assert.equal(toolRadioCard("{"), null);
		assert.equal(toolRadioCard(undefined), null);
	});

	it("标题为空时回落成「电台」", () => {
		const card = toolRadioCard(payload([{ id: "1", name: "A" }], "   "));
		assert.equal(card?.title, "电台");
	});
});

describe("toRadioQueue", () => {
	it("秒转毫秒，串词按下标对齐", () => {
		const card = toolRadioCard(
			payload([
				{ id: "1", name: "A", duration: 200, intro: "第一首" },
				{ id: "2", name: "B", duration: 0, intro: "" },
			]),
		);
		assert.ok(card);
		const queue = toRadioQueue(card);
		assert.deepEqual(
			queue.tracks.map((track) => track.duration),
			[200_000, 0],
		);
		assert.deepEqual(queue.intros, ["第一首", ""]);
		// 歌手缺失时给个占位，播放器组件里直接显示它
		assert.equal(queue.tracks[0].artists, "未知歌手");
	});
});

describe("formatDuration", () => {
	it("秒转 m:ss，非法值给空串", () => {
		assert.equal(formatDuration(0), "");
		assert.equal(formatDuration(Number.NaN), "");
		assert.equal(formatDuration(65), "1:05");
		assert.equal(formatDuration(600), "10:00");
	});
});
