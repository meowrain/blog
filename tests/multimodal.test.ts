import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	OMITTED_IMAGE_NOTE,
	buildImageNote,
	buildUserContent,
	fetchImageAsDataUrl,
	isVisionRejection,
	pickModelForTurn,
	stripImagesFromText,
} from "../agents/_multimodal.ts";

const IMG = "data:image/png;base64,AAAA";
const IMG2 = "data:image/png;base64,BBBB";

describe("buildUserContent", () => {
	it("无图时严格返回入参字符串（字节级不变）", () => {
		const text = "  解释一下 CAP\n定理 ";
		const out = buildUserContent({ text });
		assert.equal(out, text);
		assert.equal(typeof out, "string");
	});

	it("images 传空数组也走无图分支", () => {
		assert.equal(buildUserContent({ text: "hi", images: [] }), "hi");
	});

	it("有图时顺序正确：text 在前，图片按传入顺序", () => {
		const out = buildUserContent({ text: "看图", images: [IMG, IMG2] });
		assert.ok(Array.isArray(out));
		assert.deepEqual(out, [
			{ type: "text", text: "看图" },
			{ type: "image_url", image_url: { url: IMG } },
			{ type: "image_url", image_url: { url: IMG2 } },
		]);
	});

	it("没视觉能力时退成纯文本，带链接与说明", () => {
		const out = buildUserContent({
			text: "看图",
			images: ["https://img/a.jpg"],
			visionOk: false,
		});
		assert.equal(typeof out, "string");
		assert.ok((out as string).includes("https://img/a.jpg"));
		assert.ok((out as string).includes("不能读图"));
	});

	it("纯图（无文字）在能读图时不塞空 text part", () => {
		const out = buildUserContent({ text: "  ", images: [IMG] });
		assert.deepEqual(out, [{ type: "image_url", image_url: { url: IMG } }]);
	});
});

describe("buildImageNote", () => {
	it("逐条编号列出链接", () => {
		const note = buildImageNote(["https://a.jpg", "https://b.jpg"]);
		assert.ok(note.includes("1. https://a.jpg"));
		assert.ok(note.includes("2. https://b.jpg"));
	});

	it("空输入返回空串", () => {
		assert.equal(buildImageNote([]), "");
	});
});

describe("stripImagesFromText", () => {
	it("历史轮次的图片替换成占位文本", () => {
		const out = stripImagesFromText(
			"看图\n![图片](https://img/a.jpg)\n![图片](https://img/b.jpg)",
		);
		assert.equal(out, `看图\n${OMITTED_IMAGE_NOTE}\n${OMITTED_IMAGE_NOTE}`);
	});

	it("无图原文返回", () => {
		assert.equal(stripImagesFromText("plain"), "plain");
	});
});

describe("pickModelForTurn", () => {
	it("配了 AI_GATEWAY_VISION_MODEL 就换模型", () => {
		assert.deepEqual(
			pickModelForTurn({ AI_GATEWAY_VISION_MODEL: "vision-x" }),
			{
				model: "vision-x",
				visionOk: true,
			},
		);
	});

	it("没配时乐观发送（不假设支持，也不假设不支持）", () => {
		const d = pickModelForTurn({});
		assert.equal(d.visionOk, true);
		assert.equal(d.model, undefined);
	});

	it("AI_GATEWAY_VISION=0 强制关掉，且不再换模型", () => {
		assert.deepEqual(
			pickModelForTurn({
				AI_GATEWAY_VISION: "0",
				AI_GATEWAY_VISION_MODEL: "vision-x",
			}),
			{
				visionOk: false,
			},
		);
	});

	it("进程内记住的 visionOk=false 优先于 model 配置", () => {
		const d = pickModelForTurn(
			{ AI_GATEWAY_VISION_MODEL: "vision-x" },
			{ visionOk: false },
		);
		assert.deepEqual(d, { visionOk: false });
	});

	it("AI_GATEWAY_VISION=1 覆盖进程内记忆", () => {
		const d = pickModelForTurn(
			{ AI_GATEWAY_VISION: "true" },
			{ visionOk: false },
		);
		assert.equal(d.visionOk, true);
	});
});

describe("isVisionRejection", () => {
	it("认得图片相关的 400", () => {
		assert.equal(
			isVisionRejection(400, "invalid content: image_url is not supported"),
			true,
		);
		assert.equal(
			isVisionRejection(400, "multimodal is not enabled for this model"),
			true,
		);
		assert.equal(isVisionRejection(422, "unsupported vision input"), true);
	});

	it("别的不相关 400 不当视觉问题", () => {
		assert.equal(isVisionRejection(400, "temperature must be <= 2"), false);
		assert.equal(isVisionRejection(400, ""), false);
	});

	it("5xx / 429 不触发降级（那是暂时性错误）", () => {
		assert.equal(isVisionRejection(500, "image_url boom"), false);
		assert.equal(isVisionRejection(429, "image_url rate limit"), false);
	});
});

describe("fetchImageAsDataUrl", () => {
	const realFetch = globalThis.fetch;

	it("正常图片转成 data URL", async () => {
		globalThis.fetch = (async () =>
			new Response(new Uint8Array([1, 2, 3]), {
				status: 200,
				headers: { "content-type": "image/png" },
			})) as typeof fetch;
		const url = await fetchImageAsDataUrl("https://img/a.png");
		assert.equal(
			url,
			`data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`,
		);
		globalThis.fetch = realFetch;
	});

	it("非 2xx / 非 http 协议 / 超体积都返回 null", async () => {
		globalThis.fetch = (async () =>
			new Response("nope", { status: 404 })) as typeof fetch;
		assert.equal(await fetchImageAsDataUrl("https://img/a.png"), null);
		assert.equal(await fetchImageAsDataUrl("data:image/png;base64,AA"), null);

		globalThis.fetch = (async () =>
			new Response(new Uint8Array(16), {
				status: 200,
				headers: { "content-type": "image/png", "content-length": "16" },
			})) as typeof fetch;
		assert.equal(
			await fetchImageAsDataUrl("https://img/a.png", { maxBytes: 8 }),
			null,
		);
		globalThis.fetch = realFetch;
	});

	it("网络异常不抛，返回 null", async () => {
		globalThis.fetch = (async () => {
			throw new Error("network down");
		}) as typeof fetch;
		assert.equal(await fetchImageAsDataUrl("https://img/a.png"), null);
		globalThis.fetch = realFetch;
	});
});
