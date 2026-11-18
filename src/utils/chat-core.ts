/**
 * /chat/ 聊天页的纯逻辑：会话索引、标题推导、历史回放解析。
 * 零依赖、无 DOM，方便在 Node 里直接跑单测（见 tests/chat-core.test.ts）。
 *
 * 为什么不放服务端：`store.listConversations` 是账号级的，没有 userId 维度，
 * 放出去等于把这个 EdgeOne 项目下所有访客的会话标题一起列出来。所以列表索引
 * 只活在浏览器 localStorage 里，消息正文仍旧从 `/history` 拉。
 */

export interface ConversationMeta {
	id: string;
	title: string;
	/** 毫秒时间戳，列表按它倒序 */
	updatedAt: number;
}

/** 本地索引里最多留几条；超出只淘汰本地条目，不碰服务端数据 */
export const MAX_CONVERSATIONS = 30;

/** 标题最长多少个「字」（按码点算，emoji 不会被切一半） */
const TITLE_MAX_CHARS = 24;

/** 回放出来的一轮消息 */
export interface RestoredTurn {
	role: "user" | "assistant";
	content: string;
	/** 图片直链；老数据没有元信息时靠正文里的 Markdown 图片语法回捞 */
	images: string[];
}

function clampTitle(text: string): string {
	const chars = Array.from(text);
	return chars.length > TITLE_MAX_CHARS
		? chars.slice(0, TITLE_MAX_CHARS).join("")
		: text;
}

/**
 * 从第一条用户消息推会话标题：压空白 → 按码点截 24 字 → 空串回落。
 * 必须用 `Array.from` 截断，`slice` 会把 emoji 的代理对切成半个，存进
 * localStorage 后再读出来就是乱码。
 */
export function deriveTitle(
	firstUserText: string,
	fallback = "新对话",
): string {
	const flat = String(firstUserText ?? "")
		.replace(/\s+/g, " ")
		.trim();
	if (!flat) return clampTitle(fallback);
	return clampTitle(flat);
}

/** 按 updatedAt 倒序；同一时间戳时保持插入顺序稳定（sort 在 Node 与浏览器里都是稳定的） */
function sortByUpdatedAt(list: ConversationMeta[]): ConversationMeta[] {
	return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 写入或更新一条，返回**新数组**（Svelte 的 $state 依赖赋值才触发更新） */
export function upsertConversation(
	list: ConversationMeta[],
	item: ConversationMeta,
	max = MAX_CONVERSATIONS,
): ConversationMeta[] {
	const rest = list.filter((c) => c.id !== item.id);
	const cap = Math.max(1, Math.floor(max));
	return sortByUpdatedAt([item, ...rest]).slice(0, cap);
}

export function removeConversation(
	list: ConversationMeta[],
	id: string,
): ConversationMeta[] {
	return list.filter((c) => c.id !== id);
}

/** 重命名；空标题回落成「新对话」，id 不存在时原样返回新数组 */
export function renameConversation(
	list: ConversationMeta[],
	id: string,
	title: string,
): ConversationMeta[] {
	const next =
		clampTitle(
			String(title ?? "")
				.replace(/\s+/g, " ")
				.trim(),
		) || "新对话";
	return list.map((c) => (c.id === id ? { ...c, title: next } : c));
}

/** 刷新时间戳并重排 */
export function touchConversation(
	list: ConversationMeta[],
	id: string,
	now = Date.now(),
): ConversationMeta[] {
	return sortByUpdatedAt(
		list.map((c) => (c.id === id ? { ...c, updatedAt: now } : c)),
	);
}

const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/** 正文里有几张 Markdown 图片就捞几张（去重、保序） */
export function extractImageUrls(text: string): string[] {
	const out: string[] = [];
	for (const m of String(text ?? "").matchAll(MARKDOWN_IMAGE)) {
		const url = m[1];
		if (url && !out.includes(url)) out.push(url);
	}
	return out;
}

const TRAILING_IMAGE_BLOCK =
	/(?:\s*!\[[^\]]*\]\(\s*<?[^)\s>]+>?(?:\s+"[^"]*")?\s*\))+\s*$/;

/** 去掉正文末尾那几行 `![图片](url)` —— 图上已经单独显示了，正文里再来一遍就重复 */
export function stripImageMarkdown(text: string): string {
	return String(text ?? "")
		.replace(TRAILING_IMAGE_BLOCK, "")
		.trim();
}

function metaImages(meta: unknown): string[] {
	if (!meta || typeof meta !== "object") return [];
	const raw = (meta as { images?: unknown }).images;
	if (!Array.isArray(raw)) return [];
	return raw.filter(
		(u): u is string => typeof u === "string" && u.trim().length > 0,
	);
}

/**
 * 把 /history 返回的原始消息还原成可渲染的轮次。
 * 容错优先：字段缺了就跳过，metadata.images 优先，缺失时用正则从正文回捞。
 * 一条都读不出来就返回空数组（上层按「没有历史」处理）。
 */
export function parseHistoryMessages(raw: unknown, limit = 50): RestoredTurn[] {
	if (!Array.isArray(raw)) return [];
	const turns: RestoredTurn[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const m = item as { role?: unknown; content?: unknown; metadata?: unknown };
		if (m.role !== "user" && m.role !== "assistant") continue;
		if (typeof m.content !== "string" || !m.content.trim()) continue;
		const fromMeta = metaImages(m.metadata);
		const images = fromMeta.length ? fromMeta : extractImageUrls(m.content);
		const content = images.length ? stripImageMarkdown(m.content) : m.content;
		turns.push({ role: m.role, content, images });
	}
	const cap = Math.max(1, Math.floor(limit));
	return turns.length > cap ? turns.slice(turns.length - cap) : turns;
}
