// 图片进上下文、视觉能力判定与降级。
//
// 刻意不引任何三方包（原因见 _model.ts 顶部说明：线上 agent 运行时裁剪过外部依赖，
// 顶层 import 解析不到会让整个 agent bundle 在加载期崩掉）。这里只依赖全局 fetch。
//
// 三条硬约束：
// 1. 无图时必须原样返回入参字符串（不是 content array），现有纯文本对话字节级不变；
// 2. 只有最后一轮带图，历史轮次换成占位文本 —— 否则多轮下来 base64 会撑爆上下文预算；
// 3. 模型视觉能力未知（@makers/deepseek-v4-flash 文档没声明多模态），所以默认乐观发送，
//    失败再降级，不能假设它一定支持。

export type UserContent = string | ContentPart[];

export type ContentPart =
	| { type: 'text'; text: string }
	| { type: 'image_url'; image_url: { url: string } };

export const OMITTED_IMAGE_NOTE = '[历史消息中的图片已省略]';

/** 单张图的下载超时与体积上限（超限直接不发，宁可少一张也别拖垮整轮） */
export const IMAGE_FETCH_TIMEOUT_MS = 15_000;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
	avif: 'image/avif',
};

export interface BuildUserContentOptions {
	/** 本轮用户输入的文字 */
	text: string;
	/** 已转成 data URL 的图片；为空等价于「无图」 */
	images?: string[];
	/** 模型能不能读图 */
	visionOk?: boolean;
}

/**
 * 组装本轮 user content。
 *
 * - 无图：返回 string，与改造前完全一致；
 * - 有图且能读图：1×text + N×image_url（**data URL**，base64 内联）；
 * - 有图但不能读图：纯文本 + 图片链接 + 一句说明，仍然能顺着链接讲。
 */
export function buildUserContent(opts: BuildUserContentOptions): UserContent {
	const text = String(opts.text ?? '');
	const images = (opts.images ?? []).filter((u): u is string => typeof u === 'string' && !!u);
	if (!images.length) return text;
	if (opts.visionOk === false) {
		return `${text}\n\n${buildImageNote(images)}`.trim();
	}
	const parts: ContentPart[] = [];
	if (text.trim()) parts.push({ type: 'text', text });
	for (const url of images) parts.push({ type: 'image_url', image_url: { url } });
	return parts;
}

/** 不能读图 / 图没取到时，把链接与说明拼成纯文本，让模型至少能说「我看不到，链接在这」 */
export function buildImageNote(urls: string[]): string {
	const list = urls.filter((u) => typeof u === 'string' && u.trim());
	if (!list.length) return '';
	const lines = [
		'（当前模型不能读图，以下是图片链接，可以顺着链接描述或让访客换个问题）：',
		...list.map((u, i) => `${i + 1}. ${u}`),
	];
	return lines.join('\n');
}

/** 老消息里只剩图片时，给占位提示用的一句话 */
export function isOmittedImageNote(content: unknown): boolean {
	return typeof content === 'string' && content.includes(OMITTED_IMAGE_NOTE);
}

function extOf(url: string): string {
	const clean = url.split(/[?#]/)[0];
	const dot = clean.lastIndexOf('.');
	return dot === -1 ? '' : clean.slice(dot + 1).toLowerCase();
}

/**
 * 去掉 url 里的图片，压成一句占位。用于历史轮次：只保留最后一轮的图。
 */
export function stripImagesFromText(text: string): string {
	return String(text ?? '')
		.replace(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, OMITTED_IMAGE_NOTE)
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export interface VisionDecision {
	/** 本轮该用的模型名；undefined 表示沿用默认模型 */
	model?: string;
	/** 模型能否读图 */
	visionOk: boolean;
}

/**
 * 视觉能力判定，顺序固定：
 * 1. `AI_GATEWAY_VISION_MODEL` 配了 → 图片轮换到该模型；
 * 2. `AI_GATEWAY_VISION=1/0` → 强制开/关；
 * 3. 都没有 → 乐观发送（visionOk=true），等上游报错再降级。
 */
export function pickModelForTurn(
	env: Record<string, string | undefined> | undefined,
	state?: { visionOk?: boolean },
): VisionDecision {
	const source = env ?? {};
	const visionModel = source.AI_GATEWAY_VISION_MODEL?.trim();
	const flag = source.AI_GATEWAY_VISION?.trim().toLowerCase();
	const forced = flag === '1' || flag === 'true' ? true : flag === '0' || flag === 'false' ? false : undefined;
	const known = state?.visionOk;
	const visionOk = forced ?? known ?? true;
	// 已经在本次进程里确认不支持时，就别再换模型了，直接走纯文本
	if (!visionOk) return { visionOk: false };
	if (visionModel) return { model: visionModel, visionOk: true };
	return { visionOk: true };
}

/**
 * 上游 400 是不是「这条消息里带了图，我不认识」。
 * 只认这几种关键词，别的 400（参数写错、上下文超长）不该被当成视觉问题静默重试。
 */
export function isVisionRejection(status: number, detail: string): boolean {
	if (status !== 400 && status !== 422) return false;
	const text = String(detail ?? '').toLowerCase();
	if (!text) return false;
	if (/image_url|multimodal|multi-modal|vision|image input/.test(text)) return true;
	// 有的网关只说 "content must be a string"
	return /content/.test(text) && /(image|array|string|invalid|unsupported)/.test(text);
}

export interface FetchImageOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
	maxBytes?: number;
}

/**
 * 把图床上的图片抓回来转成 data URL。
 *
 * 不给模型传外链：图床对第三方抓取没有保证，远程 URL 抓取失败时错误也被上游吞掉，
 * 排查不了。服务端抓一次、按 base64 内联，失败就如实返回 null 让上层记一条说明。
 */
export async function fetchImageAsDataUrl(url: string, opts: FetchImageOptions = {}): Promise<string | null> {
	if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) return null;
	const timeoutMs = opts.timeoutMs ?? IMAGE_FETCH_TIMEOUT_MS;
	const maxBytes = opts.maxBytes ?? MAX_IMAGE_BYTES;

	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), timeoutMs);
	const onAbort = () => ctl.abort();
	opts.signal?.addEventListener('abort', onAbort);

	try {
		const resp = await fetch(url, { signal: ctl.signal });
		if (!resp.ok) return null;
		const declared = Number(resp.headers.get('content-length') ?? '');
		if (Number.isFinite(declared) && declared > maxBytes) return null;

		const type = (resp.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
		const buf = new Uint8Array(await resp.arrayBuffer());
		if (!buf.byteLength || buf.byteLength > maxBytes) return null;

		const mime = type.startsWith('image/') ? type : (MIME_BY_EXT[extOf(url)] ?? 'image/jpeg');
		return `data:${mime};base64,${toBase64(buf)}`;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
		opts.signal?.removeEventListener('abort', onAbort);
	}
}

function toBase64(bytes: Uint8Array): string {
	// 运行时是 Node 20+，Buffer 一定在；没有就退回分段 btoa，避免大数组爆栈
	const B = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }).Buffer;
	if (B) return B.from(bytes).toString('base64');
	let binary = '';
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

/** 本轮所有历史消息里的图片 URL（用于日志与失败说明，不参与上下文长度） */
export function collectImageUrls(messages: { images?: string[] }[]): string[] {
	const out: string[] = [];
	for (const m of messages) for (const u of m.images ?? []) if (!out.includes(u)) out.push(u);
	return out;
}
