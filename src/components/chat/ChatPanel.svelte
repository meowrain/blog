<script lang="ts">
import Icon from "@iconify/svelte";
import {
	type ConversationMeta,
	MAX_CONVERSATIONS,
	deriveTitle,
	parseHistoryMessages,
	removeConversation,
	renameConversation,
	touchConversation,
	upsertConversation,
} from "@utils/chat-core";
import MarkdownIt from "markdown-it";
import { tick } from "svelte";
import ChatHistory from "./ChatHistory.svelte";
import ChatPostCards from "./ChatPostCards.svelte";
import RadioCard from "./RadioCard.svelte";
import { toolCategories, toolPostHits } from "./post-hits";
import { toolRadioCard } from "./radio-card";

/**
 * /chat/ 聊天页的主体 —— 一个通用 AI 助手：什么都聊，需要时自己联网查、自己翻站内文章。
 *
 * 真正干活的是 /assistant（agents/assistant）：联网走腾讯云元宝搜索，站内检索复用 /find 那套索引。
 * 接口不能跟页面同路径：页面占着 /chat/，同名时静态文件会把 POST 请求整个吃掉（见 agent 头部注释）。
 * 这里只负责把工具调用过程如实显示出来，以及历史消息的存取。
 *
 * 会话：多会话。当前会话 id 存 `eo_chat_conversation_id`（跟胶囊助手 /find 用不同的 key，
 * 两边是两段独立的对话）；会话**列表索引**存 `eo_chat_conversations`，只活在浏览器里 ——
 * 服务端的 `store.listConversations` 是账号级的、没有 userId 维度，取出来等于把整个
 * EdgeOne 项目下所有访客的会话标题一起列出去。正文仍旧从 /history 按 id 拉。
 *
 * 图片：粘贴 / 拖拽 / 选择 → 客户端压到最长边 1024 的 JPEG → POST /api/chat-image/upload
 * 由服务端代理上传图床（token 不下发浏览器）→ 消息里只留 URL，agent 那边再抓回来内联成 base64。
 */

type ToolPart = {
	kind: "tool";
	id: string;
	name: string;
	args: string;
	status: "running" | "done" | "error";
	summary?: string;
	content?: string;
};
type TextPart = { kind: "text"; content: string };
type Part = TextPart | ToolPart;
type Notice = { id: string; level: "info" | "warn"; message: string };
type Msg =
	| { role: "user"; content: string; images?: string[]; failed?: boolean }
	| { role: "assistant"; parts: Part[] };

/** 一条待发送 / 已上传的图片 */
type Attachment = {
	id: string;
	/** 本地预览图（objectURL），上传完成后也用它渲染气泡，省一次请求 */
	preview: string;
	/** 图床直链；上传中为空 */
	url: string;
	status: "uploading" | "done" | "error";
	error?: string;
};

const convKey = "eo_chat_conversation_id";
const listKey = "eo_chat_conversations";

/** 单张原图上限、单条消息图片数上限、压缩后最长边与质量 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES_PER_MSG = 3;
const MAX_IMAGE_EDGE = 1024;
const JPEG_QUALITY = 0.85;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** 工具名 → 界面上说人话的标签 */
const TOOL_LABELS: Record<string, string> = {
	web_search: "联网搜索",
	search: "站内找文章",
	radio_tracks: "找歌",
	radio_play: "生成电台",
};

const TOOL_RUNNING_TEXT: Record<string, string> = {
	web_search: "正在联网搜索…",
	search: "正在翻站内文章…",
	radio_tracks: "正在网易云找歌…",
	radio_play: "正在整理播放卡…",
};

const SUGGESTIONS = [
	"最近有什么值得关注的 AI 新闻？",
	"站内有没有讲 Redis 的文章？",
	"解释一下 CAP 定理",
	"帮我把这段正则翻译成人话",
];

function getOrCreateConversationId(): string {
	const cached = localStorage.getItem(convKey);
	if (cached) return cached;
	const fresh = crypto.randomUUID();
	localStorage.setItem(convKey, fresh);
	return fresh;
}

function rotateConversationId(): string {
	const fresh = crypto.randomUUID();
	localStorage.setItem(convKey, fresh);
	return fresh;
}

/** 读会话索引；脏数据一律当空处理，坏掉的 localStorage 不该让整页打不开 */
function readIndex(): ConversationMeta[] {
	try {
		const raw = JSON.parse(localStorage.getItem(listKey) ?? "[]");
		if (!Array.isArray(raw)) return [];
		return raw
			.filter(
				(c): c is ConversationMeta =>
					!!c &&
					typeof c.id === "string" &&
					!!c.id &&
					typeof c.title === "string" &&
					typeof c.updatedAt === "number",
			)
			.slice(0, MAX_CONVERSATIONS);
	} catch {
		return [];
	}
}

function writeIndex(next: ConversationMeta[]) {
	conversations = next;
	try {
		localStorage.setItem(listKey, JSON.stringify(next));
	} catch {
		// 隐私模式 / 配额满：列表只在内存里活得下去，不影响聊天
	}
}

/** 有指针无索引的旧数据：先建一条占位，回放成功后用首条用户消息回填标题 */
function migrateLegacy(): ConversationMeta[] {
	const index = readIndex();
	if (index.length) return index;
	const pointer = localStorage.getItem(convKey);
	if (!pointer) return [];
	const seeded: ConversationMeta[] = [
		{ id: pointer, title: "之前的对话", updatedAt: Date.now() },
	];
	try {
		localStorage.setItem(listKey, JSON.stringify(seeded));
	} catch {
		/* 忽略 */
	}
	return seeded;
}

const md = new MarkdownIt({ breaks: true, linkify: true });
// 正文里的外链一律新窗口打开（站内相对链接照旧）
const defaultLinkOpen =
	md.renderer.rules.link_open ??
	((tokens, idx, options, _env, self) =>
		self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
	const href = tokens[idx].attrGet("href") ?? "";
	if (/^https?:\/\//i.test(href)) {
		tokens[idx].attrSet("target", "_blank");
		tokens[idx].attrSet("rel", "noopener noreferrer");
	}
	return defaultLinkOpen(tokens, idx, options, env, self);
};

let msgs = $state<Msg[]>([]);
let input = $state("");
let streaming = $state(false);
let error = $state("");
let restoring = $state(false);
let listEl = $state<HTMLDivElement | null>(null);
let inputEl = $state<HTMLTextAreaElement | null>(null);
let fileEl = $state<HTMLInputElement | null>(null);
let abortCtl: AbortController | null = null;

let conversations = $state<ConversationMeta[]>([]);
/** 当前会话 id 的反应式副本（localStorage 本身不触发更新） */
let currentId = $state("");
let historyOpen = $state(false);
let attachments = $state<Attachment[]>([]);
let notices = $state<Notice[]>([]);
let uploading = $state(false);
let dragging = $state(false);
/** 当前会话是否已经写过标题（写过就不再被后续消息覆盖） */
let titledFor = "";

/**
 * 回灌 /assistant 的历史必须是「user/assistant 文字」且末尾只有一个 user；工具片段不进行历史。
 * images 只在最后一轮有意义（服务端也只读最新一轮的图）。
 */
const mirror: {
	role: "user" | "assistant";
	content: string;
	images?: string[];
}[] = [];

function turnText(parts: Part[]): string {
	return parts
		.filter((p): p is TextPart => p.kind === "text")
		.map((p) => p.content)
		.join("");
}

function lastAssistant(): Extract<Msg, { role: "assistant" }> | undefined {
	const last = msgs[msgs.length - 1];
	return last && last.role === "assistant" ? last : undefined;
}

function appendText(piece: string) {
	const turn = lastAssistant();
	if (!turn) return;
	const last = turn.parts[turn.parts.length - 1];
	if (last?.kind === "text") last.content += piece;
	else turn.parts.push({ kind: "text", content: piece });
}

/** 站内文章走卡片（见 ChatPostCards），这里只挑外链和单页结果 */
function toolLinks(part: ToolPart): { text: string; url: string }[] {
	if (!part.content) return [];
	try {
		const parsed = JSON.parse(part.content);
		if (Array.isArray(parsed?.results)) {
			return parsed.results
				.slice(0, 6)
				.map((r: any) => ({
					text: String(r?.title || r?.url || ""),
					url: String(r?.url || ""),
				}))
				.filter((l: { text: string; url: string }) => l.url);
		}
		if (typeof parsed?.url === "string" && parsed.url) {
			return [{ text: parsed.url, url: parsed.url }];
		}
	} catch {
		// 解析不了就不列链接，原始内容在「查看返回内容」里
	}
	return [];
}

// ── 图片：选择 / 粘贴 / 拖拽 → 压缩 → 代理上传 ────────────────────────────

function pushNotice(level: Notice["level"], message: string) {
	const id = crypto.randomUUID();
	notices = [...notices, { id, level, message }];
	// 同时最多挂 3 条，旧的自动退场
	if (notices.length > 3) notices = notices.slice(notices.length - 3);
}

function dropNotice(id: string) {
	notices = notices.filter((n) => n.id !== id);
}

/** 压缩到最长边 1024 的 JPEG；环境不支持 createImageBitmap 时原样退回（由服务端再校验） */
async function compressImage(file: File): Promise<Blob> {
	// GIF 不走 canvas：重编码只剩第一帧，动图就没了；反正它也压不小
	if (file.type === "image/gif") return file;
	if (
		typeof createImageBitmap !== "function" ||
		typeof OffscreenCanvas !== "function"
	)
		return file;
	try {
		const bitmap = await createImageBitmap(file);
		const scale = Math.min(
			1,
			MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height),
		);
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));
		const canvas = new OffscreenCanvas(width, height);
		const ctx = canvas.getContext("2d");
		if (!ctx) return file;
		// JPEG 没有透明通道，先铺白底，否则 png 的透明区域会变黑
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, width, height);
		ctx.drawImage(bitmap, 0, 0, width, height);
		bitmap.close?.();
		const blob = await canvas.convertToBlob({
			type: "image/jpeg",
			quality: JPEG_QUALITY,
		});
		return blob.size && blob.size < file.size ? blob : file;
	} catch {
		return file;
	}
}

async function uploadOne(attachment: Attachment, blob: Blob) {
	uploading = true;
	try {
		const form = new FormData();
		const ext = blob.type === "image/gif" ? "gif" : "jpg";
		form.append("image", blob, `chat-${Date.now()}.${ext}`);
		const resp = await fetch("/api/chat-image/upload", {
			method: "POST",
			body: form,
		});
		const data = await resp.json().catch(() => null);
		if (!resp.ok || !data?.url) {
			throw new Error(data?.error || `上传失败（HTTP ${resp.status}）`);
		}
		// $state 里存的是原始对象，直接改字段不会触发更新，必须整体换掉数组
		attachments = attachments.map((a) =>
			a.id === attachment.id
				? { ...a, url: String(data.url), status: "done" as const }
				: a,
		);
	} catch (e) {
		const message = (e as Error).message || "上传失败";
		attachments = attachments.map((a) =>
			a.id === attachment.id
				? { ...a, status: "error" as const, error: message }
				: a,
		);
		pushNotice("warn", `图片上传失败：${message}`);
	} finally {
		uploading = attachments.some((a) => a.status === "uploading");
	}
}

async function addFiles(files: File[] | FileList) {
	const list = Array.from(files ?? []);
	if (!list.length) return;
	const room = MAX_IMAGES_PER_MSG - attachments.length;
	if (room <= 0) {
		pushNotice("warn", `一条消息最多 ${MAX_IMAGES_PER_MSG} 张图片。`);
		return;
	}
	const accepted: File[] = [];
	for (const file of list.slice(0, room)) {
		if (!ACCEPTED_TYPES.includes(file.type)) {
			pushNotice(
				"warn",
				`不支持这个格式：${file.name || file.type || "未知"}（只收 png / jpeg / webp / gif）。`,
			);
			continue;
		}
		if (file.size > MAX_IMAGE_BYTES) {
			pushNotice("warn", `${file.name || "这张图"} 超过 5MB，压缩后再试。`);
			continue;
		}
		accepted.push(file);
	}
	if (list.length > room)
		pushNotice(
			"warn",
			`一条消息最多 ${MAX_IMAGES_PER_MSG} 张图片，多出的没加进来。`,
		);

	for (const file of accepted) {
		const attachment: Attachment = {
			id: crypto.randomUUID(),
			preview: URL.createObjectURL(file),
			url: "",
			status: "uploading",
		};
		attachments = [...attachments, attachment];
		void compressImage(file).then((blob) => uploadOne(attachment, blob));
	}
	uploading = attachments.some((a) => a.status === "uploading");
}

function removeAttachment(id: string) {
	const target = attachments.find((a) => a.id === id);
	if (target?.preview.startsWith("blob:")) URL.revokeObjectURL(target.preview);
	attachments = attachments.filter((a) => a.id !== id);
	uploading = attachments.some((a) => a.status === "uploading");
}

function clearAttachments() {
	for (const a of attachments)
		if (a.preview.startsWith("blob:")) URL.revokeObjectURL(a.preview);
	attachments = [];
	uploading = false;
}

function onPaste(e: ClipboardEvent) {
	const files = Array.from(e.clipboardData?.files ?? []);
	if (!files.length) return;
	e.preventDefault();
	void addFiles(files);
}

function onDrop(e: DragEvent) {
	dragging = false;
	const files = Array.from(e.dataTransfer?.files ?? []);
	if (!files.length) return;
	e.preventDefault();
	void addFiles(files);
}

function onFilePick(e: Event) {
	const input = e.currentTarget as HTMLInputElement;
	if (input.files?.length) void addFiles(input.files);
	input.value = "";
}

// ── 会话索引 ─────────────────────────────────────────────────────────

/** 把当前会话写回索引（首条消息发出、点新对话、离开页面前都调它） */
function rememberCurrent(title?: string, id = currentId) {
	if (!id) return;
	const existing = conversations.find((c) => c.id === id);
	const next = upsertConversation(conversations, {
		id,
		title: title ?? existing?.title ?? "新对话",
		updatedAt: Date.now(),
	});
	writeIndex(next);
	if (title) titledFor = id;
}

function selectConversation(id: string) {
	if (streaming || restoring || id === currentId) {
		historyOpen = false;
		return;
	}
	if (abortCtl) void stop();
	mirror.length = 0;
	msgs = [];
	notices = [];
	error = "";
	clearAttachments();
	localStorage.setItem(convKey, id);
	currentId = id;
	historyOpen = false;
	writeIndex(touchConversation(conversations, id));
	void restore();
}

function renameCurrent(id: string, title: string) {
	writeIndex(renameConversation(conversations, id, title));
}

async function removeCurrent(id: string) {
	// 先删服务端，成功了才移出本地索引 —— 反过来的话服务端消息会成孤儿
	try {
		const resp = await fetch("/history", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"makers-conversation-id": id,
			},
			body: JSON.stringify({ conversation_id: id, action: "delete" }),
		});
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
	} catch (e) {
		// 删不掉就别假装删了：从列表隐藏 + 明说，下次刷新服务端还在
		writeIndex(removeConversation(conversations, id));
		pushNotice(
			"warn",
			`服务端删除失败（${(e as Error).message}），已从列表隐藏。`,
		);
		if (id === currentId) newChat();
		return;
	}
	writeIndex(removeConversation(conversations, id));
	if (id === currentId) newChat();
}

function prettyArgs(args: string): string {
	if (!args?.trim()) return "";
	try {
		return JSON.stringify(JSON.parse(args));
	} catch {
		return args;
	}
}

function shortArgs(args: string): string {
	const pretty = prettyArgs(args);
	return pretty.length > 60 ? `${pretty.slice(0, 60)}…` : pretty;
}

async function scrollToBottom() {
	await tick();
	listEl?.scrollTo({ top: listEl.scrollHeight, behavior: "smooth" });
}

async function post(question: string, images: string[] = []) {
	const conversationId = getOrCreateConversationId();
	error = "";
	streaming = true;
	msgs = [
		...msgs,
		{ role: "user", content: question, ...(images.length ? { images } : {}) },
		{ role: "assistant", parts: [] },
	];
	mirror.push({
		role: "user",
		content: question,
		...(images.length ? { images } : {}),
	});
	abortCtl = new AbortController();
	let sawDone = false;

	try {
		const resp = await fetch("/assistant", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"makers-conversation-id": conversationId,
			},
			body: JSON.stringify({
				messages: [...mirror],
				query: question || "（图片）",
			}),
			signal: abortCtl.signal,
		});
		if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

		const reader = resp.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		while (!sawDone) {
			const { done, value } = await reader.read();
			if (done) break; // 提前断开：sawDone 仍是 false
			buffer += decoder.decode(value, { stream: true });

			let idx: number;
			while ((idx = buffer.indexOf("\n")) !== -1) {
				const line = buffer.slice(0, idx).trim();
				buffer = buffer.slice(idx + 1);
				if (!line.startsWith("data:")) continue;
				const payload = line.slice(5).trim();
				if (payload === "[DONE]") {
					sawDone = true;
					break;
				}
				if (!payload) continue;
				const ev = JSON.parse(payload);
				const turn = lastAssistant();
				if (!turn) continue;
				if (ev.type === "ai_response") {
					appendText(ev.content ?? "");
					void scrollToBottom();
				} else if (ev.type === "tool_call") {
					turn.parts.push({
						kind: "tool",
						id: String(ev.id ?? turn.parts.length),
						name: String(ev.name ?? "tool"),
						args: String(ev.arguments ?? ""),
						status: "running",
					});
					void scrollToBottom();
				} else if (ev.type === "tool_result") {
					const part = [...turn.parts]
						.reverse()
						.find(
							(p): p is ToolPart =>
								p.kind === "tool" &&
								p.status === "running" &&
								p.id === String(ev.id ?? ""),
						);
					const target =
						part ??
						turn.parts.filter((p): p is ToolPart => p.kind === "tool").pop();
					if (target) {
						target.status = ev.ok === false ? "error" : "done";
						target.summary = String(ev.summary ?? "");
						target.content = String(ev.content ?? "");
					}
					void scrollToBottom();
				} else if (ev.type === "notice") {
					pushNotice(
						ev.level === "warn" ? "warn" : "info",
						String(ev.message ?? ""),
					);
				} else if (ev.type === "error_message") {
					throw new Error(ev.content ?? "未知错误");
				}
				// ping / usage 静默忽略
			}
		}

		if (!sawDone && !abortCtl.signal.aborted)
			throw new Error("连接中断，请重试");

		const turn = lastAssistant();
		const text = turn ? turnText(turn.parts).trim() : "";
		if (text) mirror.push({ role: "assistant", content: text });
		else if (turn)
			turn.parts.push({
				kind: "text",
				content: "（这次没有回答，换个说法再问问？）",
			});
	} catch (e) {
		const err = e as Error;
		if (err.name === "AbortError") {
			const turn = lastAssistant();
			const text = turn ? turnText(turn.parts).trim() : "";
			if (text) mirror.push({ role: "assistant", content: text });
			return;
		}
		error = err.message;
		msgs = msgs.map((m) => (m.role === "user" ? { ...m, failed: true } : m));
		mirror.length = 0;
		// 失败那轮的图片还挂在本地，放回输入区让用户自己决定重发还是删掉
		const lastUser = [...msgs].reverse().find((m) => m.role === "user");
		if (lastUser?.role === "user" && lastUser.images?.length) {
			attachments = lastUser.images.map((url) => ({
				id: crypto.randomUUID(),
				preview: url,
				url,
				status: "done" as const,
			}));
		}
	} finally {
		streaming = false;
		abortCtl = null;
		autoGrow();
		void scrollToBottom();
	}
}

function submit() {
	// 文本或图片至少一项；上传没完成的图先别发
	if (streaming || restoring) return;
	if (uploading || attachments.some((a) => a.status === "uploading")) return;
	const q = input.trim();
	const uploaded = attachments
		.filter((a) => a.status === "done" && a.url)
		.map((a) => a.url);
	if (!q && !uploaded.length) return;

	const firstTurn = !msgs.length;
	if (firstTurn) rememberCurrent(deriveTitle(q || "（图片）"));
	else rememberCurrent();

	input = "";
	clearAttachments();
	autoGrow();
	void post(q, uploaded);
}

async function stop() {
	const controller = abortCtl;
	if (!controller) return;
	const conversationId = getOrCreateConversationId();
	// 先断本地读取再通知服务端：上游被 abort 后会直接关流，
	// 等到那时才断的话，「没收到 [DONE] 的结束」会被当成连接中断而报错。
	controller.abort();
	await fetch("/stop", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"makers-conversation-id": conversationId,
		},
		body: JSON.stringify({ conversation_id: conversationId }),
	}).catch(() => {});
}

function newChat() {
	if (streaming) void stop();
	// 先把当前会话写回索引，再换 id —— 否则旧消息就成了没人认领的孤儿
	rememberCurrent();
	currentId = rotateConversationId();
	msgs = [];
	mirror.length = 0;
	notices = [];
	error = "";
	clearAttachments();
	historyOpen = false;
	void tick().then(() => inputEl?.focus());
}

async function restore() {
	restoring = true;
	const conversationId = getOrCreateConversationId();
	try {
		const resp = await fetch("/history", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"makers-conversation-id": conversationId,
			},
			body: JSON.stringify({ conversation_id: conversationId, limit: 50 }),
		});
		if (!resp.ok) return;
		const data = await resp.json();
		const turns = parseHistoryMessages(data?.messages, 50);
		const restored: Msg[] = turns.map((t) =>
			t.role === "user"
				? {
						role: "user" as const,
						content: t.content,
						...(t.images.length ? { images: t.images } : {}),
					}
				: {
						role: "assistant" as const,
						parts: [{ kind: "text" as const, content: t.content }],
					},
		);
		if (!restored.length) return;
		if (msgs.length || streaming) return; // 期间用户已经开口了就不覆盖
		msgs = restored;
		mirror.push(
			...restored.map((m) =>
				m.role === "user"
					? { role: "user" as const, content: m.content }
					: { role: "assistant" as const, content: turnText(m.parts) },
			),
		);
		// 旧数据迁移过来的占位标题，回放成功后用首条用户消息回填
		const entry = conversations.find((c) => c.id === conversationId);
		const firstUser = turns.find((t) => t.role === "user");
		if (entry && entry.title === "之前的对话" && firstUser) {
			writeIndex(
				renameConversation(
					conversations,
					conversationId,
					deriveTitle(firstUser.content, "之前的对话"),
				),
			);
		} else if (entry) {
			writeIndex(touchConversation(conversations, conversationId));
		}
		void scrollToBottom();
	} catch {
		// /history 不可用时静默，不影响新对话
	} finally {
		restoring = false;
	}
}

/** 输入框跟着内容长高，最多到 10rem */
function autoGrow() {
	if (!inputEl) return;
	inputEl.style.height = "auto";
	inputEl.style.height = `${Math.min(inputEl.scrollHeight, 160)}px`;
}

$effect(() => {
	currentId = getOrCreateConversationId();
	conversations = migrateLegacy();
	void restore();
	void tick().then(() => inputEl?.focus());
});

// 别的标签页改了列表，这里的列表跟着走（localStorage 的 storage 事件只在其它标签页触发）
$effect(() => {
	function onStorage(e: StorageEvent) {
		if (e.key === listKey) {
			conversations = readIndex();
		} else if (
			e.key === convKey &&
			e.newValue &&
			e.newValue !== currentId &&
			!streaming
		) {
			currentId = e.newValue;
			msgs = [];
			mirror.length = 0;
			void restore();
		}
	}
	window.addEventListener("storage", onStorage);
	return () => window.removeEventListener("storage", onStorage);
});
</script>

<div class="card-base flex h-[72vh] min-h-[26rem] flex-col overflow-hidden !p-0">
	<div class="flex items-center gap-1.5 border-b border-black/5 px-3 py-2.5 dark:border-white/10 sm:gap-2 sm:px-4 sm:py-3">
		<Icon icon="material-symbols:forum-outline-rounded" class="text-[1.25rem] text-[var(--primary)]" />
		<div class="min-w-0 flex-1">
			<div class="truncate text-sm font-bold text-90">
				{conversations.find((c) => c.id === currentId)?.title ?? "AI 助手"}
			</div>
			<div class="truncate text-[0.7rem] text-black/40 dark:text-white/40">
				随便聊；涉及事实和最新消息时它会自己联网查，也会翻本站文章
			</div>
		</div>
		<button
			class="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-black/50 transition hover:bg-black/5 disabled:opacity-40 dark:text-white/50 dark:hover:bg-white/10"
			title="历史会话"
			disabled={streaming}
			onclick={() => (historyOpen = !historyOpen)}
		>
			<Icon icon="material-symbols:history-rounded" class="text-[1.05rem]" />
			<span class="hidden sm:inline">历史</span>
		</button>
		<button
			class="shrink-0 rounded-md px-2 py-1 text-xs text-black/50 transition hover:bg-black/5 disabled:opacity-40 dark:text-white/50 dark:hover:bg-white/10"
			disabled={streaming}
			onclick={newChat}
		>新对话</button>
	</div>

	<div
		class="relative flex min-h-0 flex-1 flex-col"
		ondragover={(e) => {
			if (!e.dataTransfer?.types?.includes("Files")) return;
			e.preventDefault();
			dragging = true;
		}}
		ondragleave={() => (dragging = false)}
		ondrop={onDrop}
	>
	{#if dragging}
		<div class="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-[var(--primary)]/60 bg-[var(--primary)]/10 text-xs font-bold text-[var(--primary)]">
			松手把图片加进来
		</div>
	{/if}

	<div bind:this={listEl} class="chat-list flex-1 space-y-3 overflow-y-auto px-4 py-3">
		{#each notices as notice (notice.id)}
			<div
				class="flex items-start gap-1.5 rounded-md px-2.5 py-1.5 text-[0.7rem] {notice.level === 'warn'
					? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
					: 'bg-black/[0.04] text-black/55 dark:bg-white/[0.07] dark:text-white/60'}"
			>
				<Icon
					icon={notice.level === "warn" ? "material-symbols:warning-outline-rounded" : "material-symbols:info-outline-rounded"}
					class="mt-px shrink-0 text-[0.95rem]"
				/>
				<span class="min-w-0 flex-1 leading-relaxed">{notice.message}</span>
				<button class="shrink-0 opacity-50 transition hover:opacity-100" aria-label="关闭提示" onclick={() => dropNotice(notice.id)}>
					<Icon icon="material-symbols:close-rounded" class="text-[0.9rem]" />
				</button>
			</div>
		{/each}

		{#if !msgs.length}
			<div class="text-sm leading-relaxed text-black/50 dark:text-white/50">
				{#if restoring}
					<p>正在恢复上次的对话…</p>
				{:else}
					<p>问什么都行：技术问题、概念解释、写段代码，或者让我联网查点东西。</p>
					<p class="mt-1 text-xs text-black/40 dark:text-white/40">
						涉及事实、时效的问题我会先搜再答，答案里的来源都可以点开核对。
						也可以直接贴图（粘贴、拖进来或点左边的图片按钮），让我看图说话。
					</p>
				{/if}
			</div>
			{#if !restoring}
				<div class="flex flex-wrap gap-2">
					{#each SUGGESTIONS as s}
						<button
							class="rounded-full bg-black/5 px-3 py-1 text-xs text-black/60 transition hover:bg-black/10 dark:bg-white/10 dark:text-white/60 dark:hover:bg-white/20"
							onclick={() => { input = s; submit(); }}
						>{s}</button>
					{/each}
				</div>
			{/if}
		{/if}

		{#each msgs as m, mi}
			{#if m.role === "user"}
				<div class="flex flex-col items-end gap-1">
					{#if m.images?.length}
						<div class="flex max-w-[85%] flex-wrap justify-end gap-1.5">
							{#each m.images as src}
								<a href={src} target="_blank" rel="noopener noreferrer" class="block">
									<img
										src={src}
										alt="发送的图片"
										class="max-h-40 max-w-[10rem] rounded-lg border border-black/10 object-cover dark:border-white/15"
										loading="lazy"
									/>
								</a>
							{/each}
						</div>
					{/if}
					{#if m.content}
						<div class="max-w-[85%] whitespace-pre-wrap rounded-lg bg-[var(--primary)] px-3 py-2 text-sm text-white {m.failed ? 'line-through opacity-60' : ''}">
							{m.content}
						</div>
					{/if}
				</div>
			{:else}
				<div class="space-y-2">
					{#each m.parts as part, pi}
						{#if part.kind === "tool"}
							{@const radio = toolRadioCard(part.content)}
							{@const hits = radio ? [] : toolPostHits(part.content)}
							{@const categories = hits.length || radio ? [] : toolCategories(part.content)}
							{@const links = hits.length || categories.length || radio ? [] : toolLinks(part)}
							<div class="rounded-lg border border-black/10 bg-black/[0.03] px-2.5 py-2 text-[0.7rem] dark:border-white/10 dark:bg-white/[0.06]">
								<div class="flex items-center gap-1.5">
									{#if part.status === "running"}
										<Icon icon="material-symbols:progress-activity" class="chat-spin shrink-0 text-[0.95rem] text-[var(--primary)]" />
									{:else if part.status === "error"}
										<Icon icon="material-symbols:error-outline-rounded" class="shrink-0 text-[0.95rem] text-red-500" />
									{:else}
										<Icon icon="material-symbols:check-circle-outline-rounded" class="shrink-0 text-[0.95rem] text-[var(--primary)]" />
									{/if}
									<span class="font-bold text-black/70 dark:text-white/70">{TOOL_LABELS[part.name] ?? part.name}</span>
									{#if part.args}
										<span class="truncate font-mono text-black/45 dark:text-white/45">{shortArgs(part.args)}</span>
									{/if}
								</div>
								<div class="mt-1 {part.status === 'error' ? 'text-red-500' : 'text-black/50 dark:text-white/50'}">
									{part.status === "running" ? TOOL_RUNNING_TEXT[part.name] ?? "正在调用…" : part.summary || ""}
								</div>
								{#if radio}
									<div class="mt-1.5">
										<RadioCard card={radio} />
									</div>
								{:else if hits.length}
									<div class="mt-1.5">
										<ChatPostCards posts={hits} />
									</div>
								{:else if categories.length}
									<ul class="mt-1 space-y-0.5 text-black/45 dark:text-white/45">
										{#each categories as c}
											<li class="truncate">· {c}</li>
										{/each}
									</ul>
								{:else if links.length}
									<ul class="mt-1 space-y-0.5">
										{#each links as link}
											<li class="truncate">
												·
												<a
													href={link.url}
													target={link.url.startsWith("http") ? "_blank" : undefined}
													rel={link.url.startsWith("http") ? "noopener noreferrer" : undefined}
													class="text-[var(--primary)] hover:underline"
												>{link.text}</a>
											</li>
										{/each}
									</ul>
								{/if}
								{#if part.content}
									<details class="mt-1">
										<summary class="cursor-pointer select-none text-black/40 dark:text-white/40">查看返回内容</summary>
										<pre class="chat-json mt-1 overflow-x-auto whitespace-pre-wrap break-all">{part.content}</pre>
									</details>
								{/if}
							</div>
						{:else}
							<div class="chat-md prose prose-sm dark:prose-invert custom-md max-w-[92%] rounded-lg bg-black/5 px-3 py-2 text-sm dark:bg-white/10">
								{#if streaming && mi === msgs.length - 1 && pi === m.parts.length - 1 && !part.content}
									<span class="chat-dots">正在思考…</span>
								{:else}
									{@html md.render(part.content)}
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		{/each}

		{#if error}<p class="text-center text-xs text-red-500">{error}</p>{/if}
	</div>
	</div>

	<div class="border-t border-black/5 p-3 dark:border-white/10">
		{#if attachments.length}
			<div class="mb-2 flex flex-wrap gap-2">
				{#each attachments as a (a.id)}
					<div class="relative h-16 w-16 overflow-hidden rounded-md border border-black/10 dark:border-white/15">
						<img src={a.preview} alt="待发送的图片" class="h-full w-full object-cover" />
						{#if a.status === "uploading"}
							<div class="absolute inset-0 flex items-center justify-center bg-black/45 text-[0.6rem] text-white">上传中</div>
						{:else if a.status === "error"}
							<div class="absolute inset-0 flex items-center justify-center bg-red-600/70 text-center text-[0.6rem] leading-tight text-white">
								失败
							</div>
						{/if}
						<button
							class="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl bg-black/55 text-white"
							aria-label="移除图片"
							onclick={() => removeAttachment(a.id)}
						>
							<Icon icon="material-symbols:close-rounded" class="text-[0.7rem]" />
						</button>
					</div>
				{/each}
			</div>
		{/if}

		<div class="flex items-end gap-2">
			<input
				bind:this={fileEl}
				type="file"
				accept="image/png,image/jpeg,image/webp,image/gif"
				multiple
				class="hidden"
				onchange={onFilePick}
			/>
			<button
				class="shrink-0 rounded-md border border-black/10 p-2 text-black/45 transition hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:text-white/45 dark:hover:bg-white/10"
				title="添加图片（也可以直接粘贴或拖进来）"
				aria-label="添加图片"
				disabled={streaming || attachments.length >= MAX_IMAGES_PER_MSG}
				onclick={() => fileEl?.click()}
			>
				<Icon icon="material-symbols:image-outline-rounded" class="text-[1.1rem]" />
			</button>
			<textarea
				bind:this={inputEl}
				id="chat-page-input"
				name="chat-message"
				rows="1"
				class="chat-input min-w-0 flex-1 resize-none rounded-md border border-black/10 bg-black/[0.03] px-3 py-2 text-sm text-90 outline-none dark:border-white/15 dark:bg-white/5"
				bind:value={input}
				placeholder={streaming ? "生成中…" : "想问什么？（Enter 发送，Shift+Enter 换行，可粘贴图片）"}
				disabled={streaming}
				oninput={autoGrow}
				onpaste={onPaste}
				onkeydown={(e) => {
					if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
						e.preventDefault();
						submit();
					}
				}}
			></textarea>
			{#if streaming}
				<button class="rounded-md bg-red-500 px-4 py-2 text-sm text-white" onclick={stop}>停止</button>
			{:else}
				<button
					class="shrink-0 rounded-md bg-[var(--primary)] px-4 py-2 text-sm text-white disabled:opacity-50"
					disabled={uploading || (!input.trim() && !attachments.some((a) => a.status === "done"))}
					onclick={submit}
				>{uploading ? "上传中…" : "发送"}</button>
			{/if}
		</div>
	</div>
</div>

<ChatHistory
	open={historyOpen}
	{conversations}
	{currentId}
	busy={streaming || restoring}
	select={selectConversation}
	rename={renameCurrent}
	remove={removeCurrent}
	close={() => (historyOpen = false)}
/>

<style>
	.chat-list::-webkit-scrollbar {
		width: 6px;
	}
	.chat-list::-webkit-scrollbar-thumb {
		background: rgba(128, 128, 128, 0.35);
		border-radius: 3px;
	}

	.chat-json {
		max-height: 8rem;
		overflow-y: auto;
		font-size: 0.65rem;
		line-height: 1.4;
		color: rgba(128, 128, 128, 1);
	}

	.chat-spin {
		animation: chat-spin 1.2s linear infinite;
	}
	@keyframes chat-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.chat-dots {
		color: rgba(128, 128, 128, 1);
	}

	/* 气泡里复用站点正文排版（custom-md），但它按整篇文章设计，这里按气泡尺寸收一收 */
	.chat-md :global(> :first-child) {
		margin-top: 0;
	}
	.chat-md :global(> :last-child) {
		margin-bottom: 0;
	}
	.chat-md :global(p) {
		margin: 0.5em 0;
		line-height: 1.7;
	}
	.chat-md :global(h1),
	.chat-md :global(h2),
	.chat-md :global(h3),
	.chat-md :global(h4) {
		margin: 0.9em 0 0.4em;
		font-size: 1.05em;
		font-weight: 600;
	}
	.chat-md :global(ul),
	.chat-md :global(ol) {
		margin: 0.4em 0 0.6em;
		padding-left: 1.3em;
	}
	.chat-md :global(li) {
		margin: 0.15em 0;
	}
	.chat-md :global(pre) {
		max-width: 100%;
		overflow-x: auto;
		margin: 0.6em 0;
		padding: 0.6em 0.8em;
		border-radius: 0.375rem;
		font-size: 0.8em;
	}
	.chat-md :global(code) {
		word-break: break-word;
	}
	/* 站点给正文 a 加了 p-1 -m-1 的点击热区，气泡里会把行距顶开 */
	.chat-md :global(a) {
		padding: 0;
		margin: 0;
	}
	.chat-md :global(blockquote) {
		margin: 0.6em 0;
		padding-left: 0.8em;
	}
	.chat-md :global(table) {
		display: block;
		max-width: 100%;
		overflow-x: auto;
	}
</style>
