import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanText, parseFrame } from "../cloud-functions/_edge-tts.js";

/**
 * 回归：帧头的长度字段已经包含结尾的 \r\n，音频紧跟在头之后。
 * 早先按「头 + \r\n\r\n + 负载」多跳 2 字节，每帧都吃掉 mp3 的 `ff f3`
 * 同步字，整段音频在浏览器里放不出来（Header missing）。
 */
const HEADER = Buffer.from(
	"X-RequestId:a5318a877d394e52aed3f161ef5bbce6\r\n" +
		"Content-Type:audio/mpeg\r\n" +
		"X-StreamId:5274A81FD0F9413BBB43E721DC3C5425\r\n" +
		"Path:audio\r\n",
	"latin1",
);
const AUDIO = Buffer.from([0xff, 0xf3, 0x64, 0xc4, 0x00, 0x00]);

const frameOf = (header: Buffer, payload?: Buffer) =>
	Buffer.concat([
		Buffer.from([header.length >> 8, header.length & 0xff]),
		header,
		...(payload ? [payload] : []),
	]);

describe("parseFrame", () => {
	it("音频紧跟在头之后，不能多吃 2 字节", () => {
		const parsed = parseFrame(frameOf(HEADER, AUDIO));
		assert.equal(parsed?.path, "audio");
		assert.equal(
			parsed?.audio?.subarray(0, 4).toString("hex"),
			"fff364c4",
			"首字节必须是 mp3 同步字，否则整段音频废掉",
		);
		assert.equal(parsed?.audio?.length, AUDIO.length);
	});

	it("非 audio 路径不返回负载", () => {
		const header = Buffer.from("Path:turn.end\r\n", "latin1");
		const parsed = parseFrame(frameOf(header));
		assert.equal(parsed?.path, "turn.end");
		assert.equal(parsed?.audio, null);
	});

	it("截断 / 畸形帧返回 null", () => {
		assert.equal(parseFrame(Buffer.alloc(0)), null);
		assert.equal(parseFrame(Buffer.from([0, 200, 1, 2])), null);
	});
});

describe("cleanText", () => {
	it("压平空白并去掉会让上游拒绝的控制字符", () => {
		assert.equal(cleanText("  你好\u0000\n\n世界  "), "你好 世界");
	});

	it("按码点截断，不切坏 emoji", () => {
		const text = cleanText("🎵".repeat(200));
		assert.equal(Array.from(text).length, 160);
	});
});
