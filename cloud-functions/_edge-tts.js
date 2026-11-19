/**
 * 微软 Edge「大声朗读」神经语音客户端 —— 电台串词用。
 *
 * 站点原先用浏览器自带的 `speechSynthesis` 念串词，零配置，但音色取决于访客
 * 的操作系统：Linux / 部分安卓上只有一个机械音，中文停顿也怪。这里换成 Edge
 * 同款的在线神经语音，音色稳定（默认晓晓），代价是多一次服务端请求。
 *
 * ## 为什么是 WebSocket，不是 REST
 *
 * 这个接口（Edge 浏览器的朗读功能）没有公开的 REST 版本，浏览器里就是一条
 * `wss://speech.platform.bing.com/.../edge/v1`。握手要带两个东西：
 *   1. `TrustedClientToken`：Edge 扩展里写死的公开 token；
 *   2. `Sec-MS-GEC`：按当前时间（取整到 5 分钟）算出的签名。
 *
 * 签名是 v2 格式 `<CS64>-<SHA256>`，输入是
 * `"Copyright (C) Microsoft Corporation. All rights reserved." + WindowsFileTime + TOKEN`。
 * 微软靠它挡掉直接调用的脚本，算法来自 edge-tts 项目的逆向结论
 * （https://github.com/rany2/edge-tts/pull/492），随时可能失效 —— 失效时
 * `synthesize()` 会 reject，前端回落浏览器语音，不会把电台卡死。
 *
 * ## 为什么用 WebCrypto 而不是 node:crypto
 *
 * 与 `_wsa.ts` 同样的理由：云函数与 Edge 运行时共用这类内部模块，WebCrypto
 * 是全局可用的，不引任何包。唯一的 npm 依赖是 `ws`（Node 内置的 WebSocket
 * 客户端不能设自定义请求头，而握手必须要 Edge 的 UA）。
 */

import WebSocket from "ws";

const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_URL =
	"wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

/** 参与签名的版权行，一字都不能改 */
const COPYRIGHT = "Copyright (C) Microsoft Corporation. All rights reserved.";

/** 微软会校验 UA 像不像 Edge；用别的 UA 或带 Origin 的非 Edge UA 一律 403 */
const EDGE_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
const EDGE_VERSION = "143.0.3650.96";
const SEC_MS_GEC_VERSION = `2-${EDGE_VERSION}`;
const EDGE_ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";

const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

/**
 * 允许的音色白名单。接口本身能合成几十种语言，但这里是「给中文串词挑个柔和
 * 女声」，放开等于给了一个免费的多语言 TTS 代理，没必要。
 */
export const ALLOWED_VOICES = [
	"zh-CN-XiaoxiaoNeural",
	"zh-CN-XiaoyiNeural",
	"zh-CN-liaoning-XiaobeiNeural",
	"zh-CN-shaanxi-XiaoniNeural",
];

export const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
export const DEFAULT_RATE = "-4%";
export const DEFAULT_PITCH = "-2Hz";

/** 串词长度上限，和 agents/assistant/_radio.ts 的 MAX_INTRO_CHARS 对齐 */
export const MAX_TEXT_CHARS = 160;

/** 单次合成的硬超时；超过就放弃，别让前端干等 */
const BASE_TIMEOUT_MS = 12_000;
const MS_PER_CHAR = 400;
const MAX_TIMEOUT_MS = 25_000;

const RATE_RE = /^[+-]?\d{1,2}%$/;
const PITCH_RE = /^[+-]\d{1,2}Hz$/;

/** 只认白名单里的音色；非法输入回落到默认音色，而不是把错误抛给上游 */
export function normalizeVoice(raw) {
	const voice = typeof raw === "string" ? raw.trim() : "";
	return ALLOWED_VOICES.includes(voice) ? voice : DEFAULT_VOICE;
}

export function normalizeRate(raw) {
	const rate = typeof raw === "string" ? raw.trim() : "";
	return RATE_RE.test(rate) ? rate : DEFAULT_RATE;
}

export function normalizePitch(raw) {
	const pitch = typeof raw === "string" ? raw.trim() : "";
	return PITCH_RE.test(pitch) ? pitch : DEFAULT_PITCH;
}

const toUpperHex = (bytes) =>
	Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase();

/** 32 位循环左移 16（即交换高低半字） */
const swapHalves = (value) => ((value << 16) | (value >>> 16)) >>> 0;

const SWAP_FIRST = { word: 0xef0569fb, sum: 0x76f50f34, product: 0xc3efea97 };
const SWAP_SECOND = { word: 0xc31713db, sum: 0x1881ce3c, product: 0x35bd1ec9 };
const MIX_FIRST = [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83];
const MIX_SECOND = [0xa27416f5, 0xd38396ff, 0x7c932b89, 0xbfa49f69];

function swapTerm(word, key, multipliers) {
	const sum = Math.imul(word, key) + Math.imul(swapHalves(word), multipliers.word);
	const product = Math.imul(swapHalves(sum), multipliers.sum) >>> 0;
	return (Math.imul(swapHalves(product), multipliers.product) + product) >>> 0;
}

function swapAndMultiply(value, multipliers) {
	let result = value;
	for (const multiplier of multipliers) {
		result = Math.imul(swapHalves(result), multiplier) >>> 0;
	}
	return result;
}

/**
 * 生成 Sec-MS-GEC v2。`unixSeconds` 只为测试留口，线上不传。
 * 时间按 5 分钟取整 —— 别以为可以省掉，微软校验的就是这个粒度。
 */
export async function secMsGec(unixSeconds = Date.now() / 1000) {
	const ticks =
		((BigInt(Math.floor(unixSeconds)) + 11644473600n) / 300n) * 300n * 10000000n;
	const message = new TextEncoder().encode(`${COPYRIGHT}${ticks}${TOKEN}`);
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", message));

	const view = new DataView(digest.buffer);
	const firstKey = (view.getUint32(0, true) | 1) >>> 0;
	const secondKey = (view.getUint32(4, true) | 1) >>> 0;

	// 消息按小端 32 位字两两读取，末尾不足一对补零
	const padded = new Uint8Array(Math.ceil(message.length / 8) * 8);
	padded.set(message);
	const words = new DataView(padded.buffer);

	let swapSum = 0;
	let lastSwap = 0;
	let mix = 0;
	let mixSum = 0;
	for (let offset = 0; offset < padded.length; offset += 8) {
		const first = words.getUint32(offset, true);
		const second = words.getUint32(offset + 4, true);
		lastSwap = swapTerm(second, secondKey, SWAP_SECOND);
		swapSum = (swapSum + swapTerm(first, firstKey, SWAP_FIRST) + lastSwap) >>> 0;
		mix = swapAndMultiply(Math.imul(mix + first, firstKey), MIX_FIRST);
		mixSum = (mixSum + mix) >>> 0;
		mix = swapAndMultiply(Math.imul(mix + second, secondKey), MIX_SECOND);
		mixSum = (mixSum + mix) >>> 0;
	}

	const checksum = new Uint8Array(8);
	const checksumView = new DataView(checksum.buffer);
	checksumView.setUint32(0, lastSwap ^ mix, true);
	checksumView.setUint32(4, swapSum ^ mixSum, true);
	return `${toUpperHex(checksum)}-${toUpperHex(digest)}`;
}

/** 去掉模型偶尔塞进来的控制字符，压平换行，按码点截断 */
export function cleanText(raw) {
	const text = typeof raw === "string" ? raw : "";
	const cleaned = text
		// 服务端对 0x00–0x1f 这类控制字符会直接不返回音频
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	const chars = Array.from(cleaned);
	return chars.length > MAX_TEXT_CHARS
		? chars.slice(0, MAX_TEXT_CHARS).join("")
		: cleaned;
}

/** SSML 文本节点只需要转义这三个；引号不是标记的一部分，转了反而会被念出来 */
export function escapeXml(text) {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export function buildSsml({ text, voice, rate, pitch }) {
	return (
		`<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
		`<voice name='${voice}'><prosody rate='${rate}' pitch='${pitch}'>` +
		`${escapeXml(text)}</prosody></voice></speak>`
	);
}

/**
 * 解析一条二进制帧。
 *
 * 帧格式：2 字节大端「头长度」+ 头（`\r\n` 分隔的 key:value）+ `\r\n\r\n` + 负载。
 * 只有 `Path:audio` 的帧带 mp3 数据，其余（turn.start / 元数据等）一律忽略。
 * 头里没有 `Path` 的直接当坏帧丢掉。
 */
export function parseFrame(buffer) {
	if (!buffer || buffer.length < 2) return null;
	const headerLength = buffer.readUInt16BE(0);
	if (headerLength <= 0 || 2 + headerLength > buffer.length) return null;
	const header = buffer.subarray(2, 2 + headerLength).toString("latin1");
	const path = /Path:([^\r\n]+)/.exec(header)?.[1] ?? "";
	// 头之后固定是 \r\n\r\n；截图/抓包也验证过，不用再猜偏移
	const audioStart = 2 + headerLength + 2;
	const audio =
		path === "audio" && audioStart <= buffer.length
			? buffer.subarray(audioStart)
			: null;
	return { path, audio };
}

function sanitizeOptions({ voice, rate, pitch }) {
	return {
		voice: normalizeVoice(voice),
		rate: normalizeRate(rate),
		pitch: normalizePitch(pitch),
	};
}

const SPEECH_CONFIG =
	"Content-Type:application/json; charset=utf-8\r\n" +
	"Path:speech.config\r\n\r\n" +
	JSON.stringify({
		context: {
			synthesis: {
				audio: {
					metadataoptions: {
						sentenceBoundaryEnabled: "false",
						wordBoundaryEnabled: "false",
					},
					outputFormat: OUTPUT_FORMAT,
				},
			},
		},
	});

/** 单条合成：连一次、念一句、断开。一条新路径（含取地址）约 1–3 秒。 */
async function synthesizeOnce(text, options, deadline) {
	const gec = await secMsGec();
	const url =
		`${WSS_URL}?TrustedClientToken=${TOKEN}` +
		`&Sec-MS-GEC=${encodeURIComponent(gec)}` +
		`&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}` +
		`&ConnectionId=${crypto.randomUUID().replace(/-/g, "")}`;

	return new Promise((resolve, reject) => {
		const chunks = [];
		let settled = false;
		let timer;

		let socket;
		const finish = (error, value) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			try {
				socket?.terminate();
			} catch {
				/* 已经关了 */
			}
			if (error) reject(error);
			else resolve(value);
		};

		try {
			socket = new WebSocket(url, {
				headers: { "User-Agent": EDGE_UA, Origin: EDGE_ORIGIN },
			});
		} catch (error) {
			reject(error);
			return;
		}

		timer = setTimeout(() => finish(new Error("语音合成超时")), deadline);

		socket.on("open", () => {
			// speech.config 告诉服务端要什么封装格式，缺了它服务端会回空
			socket.send(SPEECH_CONFIG);
			const requestId = crypto.randomUUID().replace(/-/g, "");
			socket.send(
				`X-RequestId:${requestId}\r\n` +
					"Content-Type:application/ssml+xml\r\n" +
					`X-Timestamp:${new Date().toISOString()}\r\n` +
					`Path:ssml\r\n\r\n${buildSsml({ text, ...options })}`,
			);
		});

		socket.on("message", (data, isBinary) => {
			if (!isBinary) {
				if (data.toString().includes("Path:turn.end")) {
					if (!chunks.length) {
						finish(new Error("上游没有返回音频"));
						return;
					}
					finish(null, Buffer.concat(chunks));
				}
				return;
			}
			const frame = parseFrame(Buffer.from(data));
			if (frame?.audio?.length) chunks.push(frame.audio);
		});

		socket.on("error", (error) => finish(error));
		socket.on("close", (code) => {
			// turn.end 之后我们主动 terminate，此时已经 settled
			if (!settled) finish(new Error(`语音连接被关闭（${code}）`));
		});
	});
}

/**
 * 把一段文字合成为 mp3，返回 Uint8Array。失败一律 reject，调用方负责降级。
 *
 * 注意 `ws` 是 CommonJS 包，这里用默认导入，bundler 会处理互操作。
 */
export async function synthesize(
	rawText,
	{ voice, rate, pitch, timeoutMs } = {},
) {
	const text = cleanText(rawText);
	if (!text) throw new Error("没有可朗读的文字");
	const options = sanitizeOptions({ voice, rate, pitch });
	return synthesizeOnce(
		text,
		options,
		timeoutMs ??
			Math.min(
				MAX_TIMEOUT_MS,
				Math.max(BASE_TIMEOUT_MS, text.length * MS_PER_CHAR),
			),
	);
}
