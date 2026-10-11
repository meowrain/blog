<script lang="ts">
import Icon from "@iconify/svelte";
import MarkdownIt from "markdown-it";
import { tick } from "svelte";

/**
 * /chat 聊天页的主体 —— 一个通用 AI 助手：什么都聊，需要时自己联网查、自己翻站内文章。
 *
 * 真正干活的是 /chat（agents/chat）：联网走 Tavily，站内检索复用 /find 那套索引。
 * 这里只负责把工具调用过程如实显示出来，以及历史消息的存取。
 *
 * 会话 id 存 localStorage，并且跟胶囊助手（/find）用不同的 key —— 两边是两段独立的对话。
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
type Msg =
	| { role: "user"; content: string; failed?: boolean }
	| { role: "assistant"; parts: Part[] };

const convKey = "eo_chat_conversation_id";

/** 工具名 → 界面上说人话的标签 */
const TOOL_LABELS: Record<string, string> = {
	web_search: "联网搜索",
	read_page: "读取网页",
	search_posts: "站内找文章",
};

const TOOL_RUNNING_TEXT: Record<string, string> = {
	web_search: "正在联网搜索…",
	read_page: "正在读取网页…",
	search_posts: "正在翻站内文章…",
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
let abortCtl: AbortController | null = null;

/** 回灌 /chat 的历史必须是「user/assistant 文字」且末尾只有一个 user；工具片段不进行历史 */
const mirror: { role: "user" | "assistant"; content: string }[] = [];

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

/** 工具结果里能直接点开的链接（搜索命中、网页、站内文章） */
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
		if (Array.isArray(parsed?.posts)) {
			return parsed.posts
				.slice(0, 6)
				.map((p: any) => ({
					text: String(p?.title || ""),
					url: String(p?.url || ""),
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

async function post(question: string) {
	const conversationId = getOrCreateConversationId();
	error = "";
	streaming = true;
	msgs = [
		...msgs,
		{ role: "user", content: question },
		{ role: "assistant", parts: [] },
	];
	mirror.push({ role: "user", content: question });
	abortCtl = new AbortController();
	let sawDone = false;

	try {
		const resp = await fetch("/chat", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"makers-conversation-id": conversationId,
			},
			body: JSON.stringify({ messages: [...mirror], query: question }),
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
	} finally {
		streaming = false;
		abortCtl = null;
		autoGrow();
		void scrollToBottom();
	}
}

function submit() {
	const q = input.trim();
	if (!q || streaming) return;
	input = "";
	autoGrow();
	void post(q);
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
	rotateConversationId();
	msgs = [];
	mirror.length = 0;
	error = "";
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
		const restored: Msg[] = (Array.isArray(data?.messages) ? data.messages : [])
			.filter(
				(m: any) =>
					(m?.role === "user" || m?.role === "assistant") &&
					typeof m?.content === "string" &&
					m.content.trim(),
			)
			.map((m: any) =>
				m.role === "user"
					? { role: "user" as const, content: m.content }
					: {
							role: "assistant" as const,
							parts: [{ kind: "text" as const, content: m.content }],
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
	void restore();
	void tick().then(() => inputEl?.focus());
});
</script>

<div class="card-base flex h-[72vh] min-h-[26rem] flex-col overflow-hidden !p-0">
	<div class="flex items-center gap-2 border-b border-black/5 px-4 py-3 dark:border-white/10">
		<Icon icon="material-symbols:forum-outline-rounded" class="text-[1.25rem] text-[var(--primary)]" />
		<div class="min-w-0 flex-1">
			<div class="text-sm font-bold text-90">AI 助手</div>
			<div class="truncate text-[0.7rem] text-black/40 dark:text-white/40">
				随便聊；涉及事实和最新消息时它会自己联网查，也会翻本站文章
			</div>
		</div>
		<button
			class="rounded-md px-2 py-1 text-xs text-black/50 transition hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
			onclick={newChat}
		>新对话</button>
	</div>

	<div bind:this={listEl} class="chat-list flex-1 space-y-3 overflow-y-auto px-4 py-3">
		{#if !msgs.length}
			<div class="text-sm leading-relaxed text-black/50 dark:text-white/50">
				{#if restoring}
					<p>正在恢复上次的对话…</p>
				{:else}
					<p>问什么都行：技术问题、概念解释、写段代码，或者让我联网查点东西。</p>
					<p class="mt-1 text-xs text-black/40 dark:text-white/40">
						涉及事实、时效的问题我会先搜再答，答案里的来源都可以点开核对。
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
				<div class="flex justify-end">
					<div class="max-w-[85%] whitespace-pre-wrap rounded-lg bg-[var(--primary)] px-3 py-2 text-sm text-white {m.failed ? 'line-through opacity-60' : ''}">
						{m.content}
					</div>
				</div>
			{:else}
				<div class="space-y-2">
					{#each m.parts as part, pi}
						{#if part.kind === "tool"}
							{@const links = toolLinks(part)}
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
								{#if links.length}
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

	<div class="flex items-end gap-2 border-t border-black/5 p-3 dark:border-white/10">
		<textarea
			bind:this={inputEl}
			id="chat-page-input"
			name="chat-message"
			rows="1"
			class="chat-input min-w-0 flex-1 resize-none rounded-md border border-black/10 bg-black/[0.03] px-3 py-2 text-sm text-90 outline-none dark:border-white/15 dark:bg-white/5"
			bind:value={input}
			placeholder={streaming ? "生成中…" : "想问什么？（Enter 发送，Shift+Enter 换行）"}
			disabled={streaming}
			oninput={autoGrow}
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
				class="rounded-md bg-[var(--primary)] px-4 py-2 text-sm text-white disabled:opacity-50"
				disabled={!input.trim()}
				onclick={submit}
			>发送</button>
		{/if}
	</div>
</div>

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