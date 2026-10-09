<script lang="ts">
	import { onMount, tick } from 'svelte';
	import MarkdownIt from 'markdown-it';

	// ⭐ Conversation ID pattern — verbatim from makers-agents conversation-id.md
	const KEY = 'eo_conversation_id';

	function getOrCreateConversationId(): string {
		const cached = localStorage.getItem(KEY);
		if (cached) return cached;
		const fresh = crypto.randomUUID();
		localStorage.setItem(KEY, fresh);
		return fresh;
	}

	// POST history must never leave two consecutive user messages (sse-protocol.md)
	type Msg = { role: 'user' | 'assistant'; content: string; failed?: boolean };
	let msgs: Msg[] = [];
	let streaming = false;
	let error = '';
	let input = '';
	let sawAbort: AbortController | null = null;

	// keep a non-reactive mirror for building the posted-history array
	const msgsMirror: Msg[] = [];

	const md = new MarkdownIt({ breaks: true, linkify: true });

	function renderMarkdown(content: string): string {
		return md.render(content);
	}

	// ⭐ Frontend SSE reader — verbatim from makers-agents sse-protocol.md (sawDone contract)
	async function post(question: string) {
		const conversationId = getOrCreateConversationId();
		error = '';
		streaming = true;
		msgs = [...msgs, { role: 'user', content: question }, { role: 'assistant', content: '' }];
		msgsMirror.push({ role: 'user', content: question });
		sawAbort = new AbortController();
		let assistantText = '';

		try {
			const resp = await fetch('/learn', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'makers-conversation-id': conversationId, // ⭐ required
				},
				body: JSON.stringify({
					// ⛔ only non-failed assistant turns + the single trailing user message go in
					messages: [...msgsMirror],
				}),
				signal: sawAbort.signal,
			});
			if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

			let sawDone = false;
			const reader = resp.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (!sawDone) {
				const { done, value } = await reader.read();
				if (done) break; // closed early — sawDone is still false
				buffer += decoder.decode(value, { stream: true });

				let idx;
				while ((idx = buffer.indexOf('\n')) !== -1) {
					const line = buffer.slice(0, idx).trim();
					buffer = buffer.slice(idx + 1);
					if (!line.startsWith('data:')) continue;
					const payload = line.slice(5).trim();
					if (payload === '[DONE]') { sawDone = true; break; }
					if (!payload) continue;
					const ev = JSON.parse(payload);
					if (ev.type === 'ai_response') {
						assistantText += ev.content ?? '';
						msgs = [...msgs.slice(0, -1), { role: 'assistant', content: assistantText }];
						scrollToBottom();
					} else if (ev.type === 'error_message') {
						throw new Error(ev.content ?? '未知错误');
					}
					// ping / tool_call / tool_result / usage — ignore silently
				}
			}

			if (!sawDone && !sawAbort.signal.aborted) {
				throw new Error('连接中断，请重试'); // truncated stream — offer retry, not empty answer
			}
			// turn finished — commit it to the posted-history mirror
			msgsMirror.push({ role: 'assistant', content: assistantText });
		} catch (e) {
			const err = e as Error;
			if (err.name === 'AbortError') {
				// user pressed stop — keep whatever content streamed, commit partial turn
				msgsMirror.push({ role: 'assistant', content: assistantText });
				return;
			}
			error = err.message;
			// ⛔ A failed turn must not leave its user message in the posted history —
			// mark both on screen as failed; the mirror drops them from the next posted array.
			msgs = msgs.map((x) => ({ ...x, failed: true }));
			msgsMirror.length = 0;
		} finally {
			streaming = false;
			sawAbort = null;
			scrollToBottom();
		}
	}

	async function stop() {
		// ⚠️ Inverted rule: fetch /stop must NOT carry makers-conversation-id.
		// Pass the target conversation via body only (conversation-id.md cheat sheet).
		await fetch('/stop', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ conversation_id: getOrCreateConversationId() }),
		});
		sawAbort?.abort();
	}

	function submit() {
		const q = input.trim();
		if (!q || streaming) return;
		input = '';
		post(q);
	}

	let listEl = $state<HTMLDivElement | null>(null);
	async function scrollToBottom() {
		await tick();
		listEl?.scrollTo({ top: listEl.scrollHeight, behavior: 'smooth' });
	}
</script>

<div class="flex h-full flex-col rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
	<div bind:this={listEl} class="eo-learn-list flex-1 space-y-3 overflow-y-auto p-4">
		{#if msgs.length === 0}
			<p class="text-sm text-neutral-400">我是博文学习助手，把想深入理解的内容问我吧～</p>
		{/if}
		{#each msgs as m, i}
			<div class={m.role === 'user' ? 'text-right' : 'text-left'}>
				{#if m.role === 'user'}
					<div class="eo-learn-msg inline-block max-w-[85%] whitespace-pre-wrap rounded-lg bg-blue-500 px-3 py-2 text-sm text-white {m.failed ? 'opacity-60 line-through' : ''}">
						{m.content}
					</div>
				{:else}
					<div class="eo-learn-msg prose prose-sm max-w-[85%] rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100 {m.failed ? 'opacity-60' : ''}">
						{#if streaming && i === msgs.length - 1 && !m.content}…{:else}{@html renderMarkdown(m.content)}{/if}
					</div>
				{/if}
			</div>
		{/each}
		{#if error}<p class="text-center text-xs text-red-500">{error}</p>{/if}
	</div>
	<div class="flex gap-2 border-t border-neutral-200 p-3 dark:border-neutral-700">
		<input
			class="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800"
			bind:value={input}
			placeholder={streaming ? '生成中…' : '输入问题…'}
			disabled={streaming}
			onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing) submit(); }}
		/>
		{#if streaming}
			<button class="rounded-md bg-red-500 px-4 py-2 text-sm text-white" onclick={stop}>停止</button>
		{:else}
			<button class="rounded-md bg-blue-500 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={!input.trim()} onclick={submit}>发送</button>
		{/if}
	</div>
</div>

<style>
	.eo-learn-list::-webkit-scrollbar { width: 6px; }
	.eo-learn-list::-webkit-scrollbar-thumb { background: rgba(128, 128, 128, 0.35); border-radius: 3px; }
</style>
