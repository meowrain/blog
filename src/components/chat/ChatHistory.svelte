<script lang="ts">
import Icon from "@iconify/svelte";
import type { ConversationMeta } from "@utils/chat-core";

/**
 * 历史会话面板（抽屉）。
 *
 * 列表数据**只来自 localStorage**，不调服务端：`store.listConversations` 是账号级的，
 * 没有 userId 维度，取出来会把整个 EdgeOne 项目下所有访客的会话标题一起列出来。
 * 打开某条会话时正文才从 /history 拉。
 */

interface Props {
	open: boolean;
	conversations: ConversationMeta[];
	currentId: string;
	/** 正在流式回答：切换 / 删除 / 新建一律禁用 */
	busy?: boolean;
	select: (id: string) => void;
	rename: (id: string, title: string) => void;
	remove: (id: string) => void;
	close: () => void;
}

let {
	open,
	conversations,
	currentId,
	busy = false,
	select,
	rename,
	remove,
	close,
}: Props = $props();

/** 正在内联重命名的会话 id */
let editingId = $state("");
let editingText = $state("");
/** 等待二次确认删除的会话 id */
let confirmingId = $state("");
let editEl = $state<HTMLInputElement | null>(null);

function formatTime(ts: number): string {
	const date = new Date(ts);
	const now = new Date();
	const sameDay =
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate();
	if (sameDay) {
		return date.toLocaleTimeString("zh-CN", {
			hour: "2-digit",
			minute: "2-digit",
		});
	}
	const sameYear = date.getFullYear() === now.getFullYear();
	return sameYear
		? date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })
		: date.toLocaleDateString("zh-CN", {
				year: "2-digit",
				month: "2-digit",
				day: "2-digit",
			});
}

function beginRename(id: string, title: string) {
	if (busy) return;
	editingId = id;
	editingText = title;
	confirmingId = "";
	void Promise.resolve().then(() => editEl?.select());
}

function commitRename() {
	if (!editingId) return;
	const id = editingId;
	const title = editingText.trim();
	editingId = "";
	if (title) rename(id, title);
}

function cancelRename() {
	editingId = "";
	editingText = "";
}

function pick(id: string) {
	if (busy || editingId) return;
	select(id);
}

function askRemove(id: string) {
	if (busy) return;
	confirmingId = confirmingId === id ? "" : id;
}

function doRemove(id: string) {
	confirmingId = "";
	remove(id);
}

function onKeydown(e: KeyboardEvent) {
	if (e.key === "Escape") {
		e.stopPropagation();
		if (editingId) cancelRename();
		else if (confirmingId) confirmingId = "";
		else close();
	}
}
</script>

<svelte:window on:keydown={open ? onKeydown : undefined} />

{#if open}
	<!-- 移动端全屏铺满，桌面端贴左 -->
	<div class="chat-history-mask" role="presentation" onclick={close}></div>
	<aside class="chat-history card-base" aria-label="历史会话">
		<div class="flex items-center gap-2 border-b border-black/5 px-3 py-2.5 dark:border-white/10">
			<Icon icon="material-symbols:history-rounded" class="text-[1.1rem] text-[var(--primary)]" />
			<div class="min-w-0 flex-1 text-sm font-bold text-90">历史会话</div>
			<span class="text-[0.7rem] text-black/35 dark:text-white/35">{conversations.length}</span>
			<button
				class="rounded-md p-1 text-black/45 transition hover:bg-black/5 dark:text-white/45 dark:hover:bg-white/10"
				aria-label="关闭"
				onclick={close}
			>
				<Icon icon="material-symbols:close-rounded" class="text-[1.1rem]" />
			</button>
		</div>

		<div class="chat-history-list flex-1 overflow-y-auto px-2 py-2">
			{#if !conversations.length}
				<p class="px-2 py-6 text-center text-xs text-black/40 dark:text-white/40">
					还没有历史会话。聊过几轮之后，这里会按时间倒序列出来。
				</p>
			{/if}

			{#each conversations as c (c.id)}
				<div
					class="group flex items-start gap-1.5 rounded-md px-2 py-1.5 transition {c.id === currentId
						? 'bg-[var(--primary)]/12'
						: 'hover:bg-black/5 dark:hover:bg-white/10'}"
				>
					{#if editingId === c.id}
						<input
							bind:this={editEl}
							class="min-w-0 flex-1 rounded border border-[var(--primary)]/60 bg-white/70 px-1.5 py-1 text-xs text-90 outline-none dark:bg-black/30"
							bind:value={editingText}
							maxlength="60"
							onkeydown={(e) => {
								if (e.key === "Enter" && !e.isComposing) {
									e.preventDefault();
									commitRename();
								} else if (e.key === "Escape") {
									e.preventDefault();
									cancelRename();
								}
							}}
							onblur={commitRename}
						/>
					{:else}
						<button
							class="min-w-0 flex-1 text-left"
							disabled={busy}
							onclick={() => pick(c.id)}
						>
							<div class="truncate text-xs {c.id === currentId ? 'font-bold text-90' : 'text-black/70 dark:text-white/70'}">
								{c.title}
							</div>
							<div class="flex items-center gap-1 text-[0.65rem] text-black/35 dark:text-white/35">
								<span>{formatTime(c.updatedAt)}</span>
								{#if c.id === currentId}<span>· 当前</span>{/if}
							</div>
						</button>
						<div class="flex shrink-0 items-center gap-0.5">
							<button
								class="rounded p-0.5 text-black/35 transition hover:bg-black/10 hover:text-black/60 dark:text-white/35 dark:hover:bg-white/15 dark:hover:text-white/70"
								title="重命名"
								disabled={busy}
								onclick={() => beginRename(c.id, c.title)}
							>
								<Icon icon="material-symbols:edit-outline-rounded" class="text-[0.95rem]" />
							</button>
							<button
								class="rounded p-0.5 transition {confirmingId === c.id
									? 'bg-red-500/15 text-red-500'
									: 'text-black/35 hover:bg-black/10 hover:text-red-500 dark:text-white/35 dark:hover:bg-white/15'}"
								title={confirmingId === c.id ? "再点一次确认删除" : "删除"}
								disabled={busy}
								onclick={() => askRemove(c.id)}
							>
								<Icon icon="material-symbols:delete-outline-rounded" class="text-[0.95rem]" />
							</button>
						</div>
					{/if}
				</div>

				{#if confirmingId === c.id}
					<div class="mb-1 ml-2 mr-2 flex items-center gap-2 rounded bg-red-500/10 px-2 py-1.5 text-[0.7rem] text-red-500">
						<span class="flex-1">删掉这条会话（服务端消息也一起删）？</span>
						<button class="rounded bg-red-500 px-1.5 py-0.5 text-white" onclick={() => doRemove(c.id)}>删除</button>
						<button
							class="rounded bg-black/10 px-1.5 py-0.5 text-black/60 dark:bg-white/15 dark:text-white/70"
							onclick={() => (confirmingId = "")}
						>取消</button>
					</div>
				{/if}
			{/each}
		</div>

		{#if busy}
			<p class="border-t border-black/5 px-3 py-2 text-[0.7rem] text-black/40 dark:border-white/10 dark:text-white/40">
				正在回答，先点「停止」再切换会话。
			</p>
		{/if}
	</aside>
{/if}

<style>
	/* 抽屉浮在聊天卡片上方；聊天卡片本身有 overflow:hidden，所以用 fixed 定位到视口 */
	.chat-history-mask {
		position: fixed;
		inset: 0;
		z-index: 40;
		background: rgba(0, 0, 0, 0.25);
	}

	.chat-history {
		position: fixed;
		z-index: 41;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		padding: 0 !important;
		animation: chat-history-in 0.16s ease-out;
		/* 卡片变量在玻璃主题下是半透明的，抽屉浮在正文上必须给个不透明底，否则字叠字看不清 */
		background: #ffffff;
	}

	@keyframes chat-history-in {
		from {
			opacity: 0;
			transform: translateY(-50%) translateX(-0.5rem);
		}
		to {
			opacity: 1;
			transform: translateY(-50%);
		}
	}

	.chat-history-list::-webkit-scrollbar {
		width: 6px;
	}
	.chat-history-list::-webkit-scrollbar-thumb {
		background: rgba(128, 128, 128, 0.35);
		border-radius: 3px;
	}

	:global(:root.dark) .chat-history {
		background: oklch(0.23 0.015 var(--hue));
	}

	/* 移动端：铺满整屏 */
	@media (max-width: 640px) {
		.chat-history {
			inset: 0;
			width: 100%;
			border-radius: 0;
			animation: none;
		}
	}

	/* 桌面端：贴在视口左侧的列，高度跟聊天卡片接近 */
	@media (min-width: 641px) {
		.chat-history {
			left: 0.5rem;
			top: 50%;
			transform: translateY(-50%);
			width: 17rem;
			max-height: 78vh;
			border-radius: 0.75rem;
		}
	}
</style>
