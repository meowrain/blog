<script lang="ts">
import Icon from "@iconify/svelte";
import MarkdownIt from "markdown-it";
import { tick } from "svelte";

/**
 * 全站右下角的「找文章」入口。
 *
 * 挂在 Layout.astro（Swup 容器之外），所以换页时面板和对话都留着 —— 这正是
 * 「全站一个入口」要的行为。真正干活的是 /find（agents/find）：它自带 search_posts 等
 * 工具，自己决定搜什么、搜几次；这里只负责把工具调用过程如实显示出来。
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

const convKey = "eo_find_conversation_id";

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

const SUGGESTIONS = [
	"有没有讲 Redis 的文章？",
	"最近写了什么？",
	"我想看点轻松的",
	"帮我找面试相关的笔记",
];

let open = $state(false);
let msgs = $state<Msg[]>([]);
let input = $state("");
let streaming = $state(false);
let error = $state("");
let restoring = $state(false);
let listEl = $state<HTMLDivElement | null>(null);
let inputEl = $state<HTMLInputElement | null>(null);
let sawAbort: AbortController | null = null;

// 回灌给 /find 的历史必须是「user/assistant 文字」且末尾只有一个 user ——
// 工具片段只活在界面上，不进历史（见平台的 sse-protocol 约定）。
const mirror: { role: "user" | "assistant"; content: string }[] = [];

function turnText(parts: Part[]): string {
	return parts
		.filter((p): p is TextPart => p.kind === "text")
		.map((p) => p.content)
		.join("");
}

/** 工具结果里的文章标题，用来在片段里直接列出命中项 */
function toolHits(part: ToolPart): string[] {
	if (!part.content) return [];
	try {
		const parsed = JSON.parse(part.content);
		if (Array.isArray(parsed?.posts)) {
			return parsed.posts
				.slice(0, 5)
				.map((p: any) => String(p?.title ?? ""))
				.filter(Boolean);
		}
		if (Array.isArray(parsed?.categories)) {
			return parsed.categories
				.slice(0, 8)
				.map((c: any) => `${c?.name}(${c?.count})`);
		}
	} catch {
		// 解析不了就只显示原始内容
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

async function scrollToBottom() {
	await tick();
	listEl?.scrollTo({ top: listEl.scrollHeight, behavior: "smooth" });
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
	sawAbort = new AbortController();
	let sawDone = false;

	try {
		const resp = await fetch("/find", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"makers-conversation-id": conversationId,
			},
			body: JSON.stringify({ messages: [...mirror], query: question }),
			signal: sawAbort.signal,
		});
		if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

		const reader = resp.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		while (!sawDone) {
			const { done, value } = await reader.read();
			if (done) break; // 提前断开：sawDone 还是 false
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
					scrollToBottom();
				} else if (ev.type === "tool_call") {
					turn.parts.push({
						kind: "tool",
						id: String(ev.id ?? turn.parts.length),
						name: String(ev.name ?? "tool"),
						args: String(ev.arguments ?? ""),
						status: "running",
					});
					scrollToBottom();
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
					scrollToBottom();
				} else if (ev.type === "error_message") {
					const e = new Error(ev.content ?? "未知错误") as Error & {
						code?: string;
					};
					e.code = ev.code;
					throw e;
				}
				// ping / usage 静默忽略
			}
		}

		if (!sawDone && !sawAbort.signal.aborted)
			throw new Error("连接中断，请重试");

		const turn = lastAssistant();
		const text = turn ? turnText(turn.parts).trim() : "";
		if (text) mirror.push({ role: "assistant", content: text });
		else if (turn)
			turn.parts.push({
				kind: "text",
				content: "（这次没有给出推荐，换个说法再问问？）",
			});
	} catch (e) {
		const err = e as Error & { code?: string };
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
		sawAbort = null;
		scrollToBottom();
	}
}

function submit() {
	const q = input.trim();
	if (!q || streaming) return;
	input = "";
	void post(q);
}

async function stop() {
	const controller = sawAbort;
	if (!controller) return; // 没有正在跑的流，无须通知服务端
	const conversationId = getOrCreateConversationId();
	// 先断本地读取，再通知服务端：上游被 abort 后会直接关流，若等到那时才断，
	// 这个「没有收到 [DONE] 的结束」会被当成连接中断而报错（同一轮其实是我们主动停的）。
	controller.abort();
	// ⚠️ 平台的 /stop 路由要求带 makers-conversation-id，缺了会在进我们的 handler 之前
	// 就返回 400 AGENT_CONVERSATION_ID_REQUIRED；目标 id 仍以 body 为准（body 是权威来源）。
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
		scrollToBottom();
	} catch {
		// /history 不可用时静默，不影响新对话
	} finally {
		restoring = false;
	}
}

function toggle() {
	open = !open;
	if (open) {
		void tick().then(() => inputEl?.focus());
		// 第一次点开才去恢复历史：不在每次进站时就白发一个请求
		if (!msgs.length) void restore();
	}
}

// 面板打开时把右下角的回到顶部按钮让开：两个固定元素别叠在一起
$effect(() => {
	document.body.classList.toggle("find-panel-open", open);
	return () => document.body.classList.remove("find-panel-open");
});
</script>

<!-- 入口按钮 -->
<div class="fixed right-4 bottom-4 z-40 lg:right-8 lg:bottom-8">
	<button
		class="find-fab group flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition hover:scale-105 active:scale-95"
		aria-label={open ? '收起找文章助手' : '打开找文章助手'}
		title="找文章"
		onclick={toggle}
	>
		<Icon icon={open ? 'material-symbols:close-rounded' : 'material-symbols:smart-toy-outline-rounded'} class="text-[1.75rem]" />
	</button>
</div>

{#if open}
	<!-- 面板：桌面贴右下，手机占下半屏 -->
	<div
		class="find-panel fixed z-40 flex flex-col overflow-hidden rounded-[var(--radius-large)] shadow-2xl
		inset-x-2 bottom-20 h-[62vh]
		md:inset-x-auto md:right-8 md:bottom-24 md:h-[32rem] md:w-[24rem]"
	>
		<div class="flex items-center gap-2 border-b border-black/5 px-3 py-2 dark:border-white/10">
			<Icon icon="material-symbols:smart-toy-outline-rounded" class="text-[1.125rem] text-[var(--primary)]" />
			<div class="min-w-0 flex-1">
				<div class="text-sm font-bold">找文章</div>
				<div class="truncate text-[0.7rem] text-black/40 dark:text-white/40">描述你想看的，它在站内自己搜</div>
			</div>
			<button
				class="rounded-md px-2 py-1 text-xs text-black/50 transition hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
				onclick={newChat}
			>新对话</button>
			<button
				class="rounded-md px-2 py-1 text-xs text-black/50 transition hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
				onclick={toggle}
				aria-label="收起"
			>收起</button>
		</div>

		<div bind:this={listEl} class="find-list flex-1 space-y-3 overflow-y-auto p-3">
			{#if !msgs.length}
				{#if restoring}
					<p class="text-sm text-black/40 dark:text-white/40">正在恢复上次的对话…</p>
				{:else}
					<div class="text-sm text-black/50 dark:text-white/50">
						<p>我是这个博客的导览员，告诉我你想看什么，我去站内找。</p>
						<p class="mt-1 text-xs text-black/40 dark:text-white/40">比如「有没有讲 Redis 的文章」「最近写了什么」；方向不明也可以直接说「随便推荐点」。</p>
					</div>
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
				{#if m.role === 'user'}
					<div class="text-right">
						<div class="inline-block max-w-[85%] whitespace-pre-wrap rounded-lg bg-[var(--primary)] px-3 py-2 text-sm text-white {m.failed ? 'line-through opacity-60' : ''}">
							{m.content}
						</div>
					</div>
				{:else}
					<div class="space-y-2">
						{#each m.parts as part, pi}
							{#if part.kind === 'tool'}
								{@const hits = toolHits(part)}
								<div class="rounded-lg border border-black/10 bg-black/[0.03] px-2.5 py-2 text-[0.7rem] dark:border-white/10 dark:bg-white/[0.06]">
									<div class="flex items-center gap-1.5">
										{#if part.status === 'running'}
											<Icon icon="material-symbols:progress-activity" class="find-spin shrink-0 text-[0.95rem] text-[var(--primary)]" />
										{:else if part.status === 'error'}
											<Icon icon="material-symbols:error-outline-rounded" class="shrink-0 text-[0.95rem] text-red-500" />
										{:else}
											<Icon icon="material-symbols:check-circle-outline-rounded" class="shrink-0 text-[0.95rem] text-[var(--primary)]" />
										{/if}
										<span class="truncate font-mono text-black/70 dark:text-white/70">
											{part.name}{part.args ? `(${prettyArgs(part.args)})` : ''}
										</span>
									</div>
									<div class="mt-1 {part.status === 'error' ? 'text-red-500' : 'text-black/50 dark:text-white/50'}">
										{part.status === 'running' ? '正在检索…' : part.summary || ''}
									</div>
									{#if hits.length}
										<ul class="mt-1 space-y-0.5 text-black/45 dark:text-white/45">
											{#each hits as h}
												<li class="truncate">· {h}</li>
											{/each}
										</ul>
									{/if}
									{#if part.content}
										<details class="mt-1">
											<summary class="cursor-pointer select-none text-black/40 dark:text-white/40">查看返回内容</summary>
											<pre class="find-json mt-1 overflow-x-auto whitespace-pre-wrap break-all">{part.content}</pre>
										</details>
									{/if}
								</div>
							{:else}
								<div class="find-md prose prose-sm dark:prose-invert custom-md !max-w-[92%] rounded-lg bg-black/5 px-3 py-2 text-sm dark:bg-white/10">
									{#if streaming && mi === msgs.length - 1 && pi === m.parts.length - 1 && !part.content}…{:else}{@html md.render(part.content)}{/if}
								</div>
							{/if}
						{/each}
					</div>
				{/if}
			{/each}

			{#if error}<p class="text-center text-xs text-red-500">{error}</p>{/if}
		</div>

		<div class="flex gap-2 border-t border-black/5 p-3 dark:border-white/10">
			<input
				bind:this={inputEl}
				id="find-agent-input"
				name="find-query"
				class="min-w-0 flex-1 rounded-md border border-black/10 bg-black/[0.03] px-3 py-2 text-sm outline-none dark:border-white/15 dark:bg-white/5"
				bind:value={input}
				placeholder={streaming ? '生成中…' : '想看什么？'}
				disabled={streaming}
				onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing) submit(); }}
			/>
			{#if streaming}
				<button class="rounded-md bg-red-500 px-3 py-2 text-sm text-white" onclick={stop}>停止</button>
			{:else}
				<button
					class="rounded-md bg-[var(--primary)] px-3 py-2 text-sm text-white disabled:opacity-50"
					disabled={!input.trim()}
					onclick={submit}
				>发送</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.find-fab {
		background-color: var(--primary);
	}

	.find-panel {
		background-color: var(--float-panel-bg);
	}

	.find-list::-webkit-scrollbar {
		width: 6px;
	}
	.find-list::-webkit-scrollbar-thumb {
		background: rgba(128, 128, 128, 0.35);
		border-radius: 3px;
	}

	.find-json {
		max-height: 8rem;
		overflow-y: auto;
		font-size: 0.65rem;
		line-height: 1.4;
		color: rgba(128, 128, 128, 1);
	}

	.find-spin {
		animation: find-spin 1.2s linear infinite;
	}
	@keyframes find-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* 气泡里复用站点正文排版（custom-md），但它按整篇文章设计，这里按气泡尺寸收一收 */
	.find-md :global(> :first-child) {
		margin-top: 0;
	}
	.find-md :global(> :last-child) {
		margin-bottom: 0;
	}
	.find-md :global(p) {
		margin: 0.5em 0;
		line-height: 1.7;
	}
	.find-md :global(h1),
	.find-md :global(h2),
	.find-md :global(h3),
	.find-md :global(h4) {
		margin: 0.9em 0 0.4em;
		font-size: 1.05em;
		font-weight: 600;
	}
	.find-md :global(ul),
	.find-md :global(ol) {
		margin: 0.4em 0 0.6em;
		padding-left: 1.3em;
	}
	.find-md :global(li) {
		margin: 0.15em 0;
	}
	.find-md :global(pre) {
		max-width: 100%;
		overflow-x: auto;
		margin: 0.6em 0;
		padding: 0.6em 0.8em;
		border-radius: 0.375rem;
		font-size: 0.8em;
	}
	.find-md :global(code) {
		word-break: break-word;
	}
	/* 站点给正文 a 加了 p-1 -m-1 的点击热区，气泡里会把行距顶开 */
	.find-md :global(a) {
		padding: 0;
		margin: 0;
	}
	.find-md :global(blockquote) {
		margin: 0.6em 0;
		padding-left: 0.8em;
	}
	.find-md :global(table) {
		display: block;
		max-width: 100%;
		overflow-x: auto;
	}

	/* 面板打开时让开右下角的回到顶部按钮（它在 MainGridLayout 里，只能用全局选择器） */
	:global(body.find-panel-open .back-to-top-wrapper) {
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s;
	}
</style>
