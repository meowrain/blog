<script lang="ts">
	import { tick } from 'svelte';
	import MarkdownIt from 'markdown-it';

	type Mode = 'tutor' | 'quiz' | 'eval';

	// slug / title 由文章页传入：后端靠它们判断「用户在读哪一篇」
	let { slug = '', title = '' }: { slug?: string; title?: string } = $props();

	// ⭐ 每篇文章一个 conversation_id —— 它同时是 langgraph 的 thread_id，
	// 所以对话记忆天然按文章隔离，读 A 文章的历史不会串到 B 文章。
	const convKey = () => `eo_conversation_id:${slug || '_'}`;

	function getOrCreateConversationId(): string {
		const cached = localStorage.getItem(convKey());
		if (cached) return cached;
		const fresh = crypto.randomUUID();
		localStorage.setItem(convKey(), fresh);
		return fresh;
	}

	function rotateConversationId(): string {
		const fresh = crypto.randomUUID();
		localStorage.setItem(convKey(), fresh);
		return fresh;
	}

	// POST history must never leave two consecutive user messages (sse-protocol.md)
	type Msg = { role: 'user' | 'assistant'; content: string; failed?: boolean };
	let msgs = $state<Msg[]>([]);
	let streaming = $state(false);
	let error = $state('');
	let input = $state('');
	let mode = $state<Mode>('tutor');
	let sawAbort: AbortController | null = null;
	let clearing = $state(false);

	// ⭐ 会话代际：换文章 / 新对话 / 清空都会 +1。在途的流式回包和 /history 恢复
	// 都带着发起时的代际，对不上就丢弃 —— 否则「清空」之后半截回答或迟到的历史
	// 还会写回列表，看着像没清掉。
	let epoch = 0;

	// keep a non-reactive mirror for building the posted-history array
	const msgsMirror: Msg[] = [];

	const md = new MarkdownIt({ breaks: true, linkify: true });

	function renderMarkdown(content: string): string {
		return md.render(content);
	}

	// 文章正文由页面上的正文容器现取：面板只负责把纯文本递过去，
	// 具体怎么裁剪/注入由 agents/learn 决定（后端才是唯一的预算权威）。
	// 上限只是防超长文的请求体失控，给足余量（约 6 万字）。
	const MAX_ARTICLE_CHARS = 60_000;

	function readArticleText(): string {
		if (typeof document === 'undefined') return '';
		const el =
			document.querySelector('.markdown-content') ??
			document.querySelector('#post-container .prose') ??
			document.querySelector('article');
		if (!el) return '';
		// 去掉代码块复制按钮、脚注回链之类的界面噪声，只留可读正文
		const clone = el.cloneNode(true) as HTMLElement;
		for (const junk of clone.querySelectorAll('button, svg, .not-prose, [data-expressive-code-copy], .copy-btn')) {
			junk.remove();
		}
		const text = (clone.innerText || clone.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
		return text.length > MAX_ARTICLE_CHARS ? text.slice(0, MAX_ARTICLE_CHARS) : text;
	}

	const MODES: { id: Mode; label: string; hint: string }[] = [
		{ id: 'tutor', label: '讲解', hint: '让我讲透这篇的知识点' },
		{ id: 'quiz', label: '出题', hint: '让我出 5 道题考你' },
		{ id: 'eval', label: '批改', hint: '把你刚才的答案发过来' },
	];

	const placeholder = $derived(
		streaming ? '生成中…' : MODES.find((m) => m.id === mode)?.hint ?? '输入问题…',
	);

	// ⭐ Frontend SSE reader — verbatim from makers-agents sse-protocol.md (sawDone contract)
	async function post(question: string) {
		const conversationId = getOrCreateConversationId();
		const myEpoch = epoch;
		const alive = () => myEpoch === epoch;
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
					slug,
					title,
					mode,
					// 正文每次现取：astro dev / swup 换页后 DOM 都是新的，缓存反而会串文章
					article: readArticleText(),
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
						if (alive()) {
							msgs = [...msgs.slice(0, -1), { role: 'assistant', content: assistantText }];
							scrollToBottom();
						}
					} else if (ev.type === 'error_message') {
						const e = new Error(ev.content ?? '未知错误') as Error & { code?: string };
						e.code = ev.code;
						throw e;
					}
					// ping / tool_call / tool_result / usage — ignore silently
				}
			}

			if (!sawDone && !sawAbort.signal.aborted) {
				throw new Error('连接中断，请重试'); // truncated stream — offer retry, not empty answer
			}
			// turn finished — commit it to the posted-history mirror
			if (alive()) msgsMirror.push({ role: 'assistant', content: assistantText });
		} catch (e) {
			const err = e as Error & { code?: string };
			if (err.name === 'AbortError') {
				// user pressed stop — keep whatever content streamed, commit partial turn
				if (alive()) msgsMirror.push({ role: 'assistant', content: assistantText });
				return;
			}
			if (!alive()) return; // 已清空 / 换了会话，这一轮的报错不用再上屏
			error = err.message;
			if (err.code === 'AGENT_STATE_CORRUPT') error += '（点「新对话」即可继续）';
			// ⛔ A failed turn must not leave its user message in the posted history —
			// mark both on screen as failed; the mirror drops them from the next posted array.
			msgs = msgs.map((x) => ({ ...x, failed: true }));
			msgsMirror.length = 0;
		} finally {
			if (alive()) {
				streaming = false;
				sawAbort = null;
				scrollToBottom();
			}
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

	// 界面回到初始态：epoch +1 让在途的流式回包和 /history 恢复结果全部作废
	function resetView() {
		epoch++;
		sawAbort?.abort(); // 同步掐掉在途请求：之后 stopQuietly 看到的是 null
		sawAbort = null;
		streaming = false;
		msgs = [];
		msgsMirror.length = 0;
		error = '';
	}

	function newChat() {
		void stopQuietly();
		resetView();
		rotateConversationId();
	}

	// 清空会话：删掉这次会话在服务端的记录，界面回到初始态。
	// 和「新对话」的分工 —— 新对话只换一个 thread_id，旧记录仍留在服务端。
	async function clearChat() {
		if (clearing) return;
		if (!confirm('清空当前会话？服务端保存的这次对话记录会一并删除，无法恢复。')) return;
		const conversationId = getOrCreateConversationId();
		clearing = true;
		try {
			await stopQuietly(); // 流式回答先停下，别一边删一边往上写
			const resp = await fetch('/history', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'makers-conversation-id': conversationId },
				body: JSON.stringify({ conversation_id: conversationId, action: 'clear' }),
			});
			const data = (await resp.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
			if (!resp.ok || data?.ok === false) throw new Error(data?.error ?? `HTTP ${resp.status}`);
			// 服务端删干净了再清界面
			resetView();
		} catch (e) {
			error = `清空失败：${(e as Error).message}`;
		} finally {
			clearing = false;
		}
	}

	async function stopQuietly() {
		if (!streaming) return;
		try {
			await fetch('/stop', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ conversation_id: getOrCreateConversationId() }),
			});
		} catch { /* 尽力而为 */ }
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

	// 换文章 = 换 thread：清掉界面状态，再按新的 conversation_id 恢复历史
	$effect(() => {
		slug;
		resetView();
		void restore();
	});

	async function restore() {
		const conversationId = getOrCreateConversationId();
		const myEpoch = epoch;
		try {
			// /history 是 cloud-function：header 或 body 都行，这里两个都给
			const resp = await fetch('/history', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'makers-conversation-id': conversationId },
				body: JSON.stringify({ conversation_id: conversationId, limit: 100 }),
			});
			if (!resp.ok) return; // 恢复失败不影响新对话，静默
			const data = await resp.json();
			const restored: Msg[] = (Array.isArray(data?.messages) ? data.messages : [])
				.filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.trim())
				.map((m: any) => ({ role: m.role, content: m.content }));
			if (!restored.length) return;
			// 期间用户已经开口了就不要覆盖
			if (msgs.length || streaming) return;
			if (myEpoch !== epoch) return; // 期间新对话 / 清空过，这份历史已经过期
			msgs = restored;
			msgsMirror.push(...restored);
			scrollToBottom();
		} catch { /* /history 还没上线时也走这里 */ }
	}
</script>

<div class="flex h-full flex-col rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
	<div class="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-700">
		<div class="flex gap-1 rounded-md bg-neutral-100 p-0.5 dark:bg-neutral-800">
			{#each MODES as m}
				<button
					class="rounded px-2.5 py-1 text-xs transition {mode === m.id
						? 'bg-white text-[var(--primary)] shadow dark:bg-neutral-700 dark:text-white'
						: 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100'}"
					onclick={() => { mode = m.id; }}
					title={m.hint}
				>{m.label}</button>
			{/each}
		</div>
		<span class="min-w-0 flex-1 truncate text-xs text-neutral-400" title={title}>{title}</span>
		<button
			class="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-500 transition hover:border-red-300 hover:text-red-500 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-red-500/50 dark:hover:text-red-400"
			onclick={clearChat}
			disabled={clearing}
			title="删除服务端保存的这次对话记录"
		>{clearing ? '清空中…' : '清空'}</button>
		<button
			class="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-500 transition hover:text-neutral-800 dark:border-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-100"
			onclick={newChat}
		>新对话</button>
	</div>

	<div bind:this={listEl} class="eo-learn-list flex-1 space-y-3 overflow-y-auto p-4">
		{#if msgs.length === 0}
			<p class="text-sm text-neutral-400">
				我是这篇{title ? `《${title}》` : ''}的学习助手，把想深入理解的内容问我吧～
				<span class="block text-xs text-neutral-400/80">「讲解」逐个知识点讲透 · 「出题」来一套小测验 · 「批改」给你打分和解析</span>
			</p>
		{/if}
		{#each msgs as m, i}
			<div class={m.role === 'user' ? 'text-right' : 'text-left'}>
				{#if m.role === 'user'}
					<div class="eo-learn-msg inline-block max-w-[85%] whitespace-pre-wrap rounded-lg bg-blue-500 px-3 py-2 text-sm text-white {m.failed ? 'opacity-60 line-through' : ''}">
						{m.content}
					</div>
				{:else}
					<div class="eo-learn-msg prose dark:prose-invert prose-sm custom-md !max-w-[85%] rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100 {m.failed ? 'opacity-60' : ''}">
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
			placeholder={placeholder}
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

	/* 气泡里复用站点正文排版（custom-md），但它按整篇文章设计：
	   首尾外边距、代码块宽度都要按聊天气泡的尺寸收一收 */
	.eo-learn-msg :global(> :first-child) { margin-top: 0; }
	.eo-learn-msg :global(> :last-child) { margin-bottom: 0; }
	.eo-learn-msg :global(p) { margin-top: 0.5em; margin-bottom: 0.5em; line-height: 1.7; }
	.eo-learn-msg :global(h1),
	.eo-learn-msg :global(h2),
	.eo-learn-msg :global(h3),
	.eo-learn-msg :global(h4) { margin-top: 0.9em; margin-bottom: 0.4em; font-size: 1.05em; font-weight: 600; }
	.eo-learn-msg :global(ul),
	.eo-learn-msg :global(ol) { margin-top: 0.4em; margin-bottom: 0.6em; padding-left: 1.3em; }
	.eo-learn-msg :global(li) { margin-top: 0.15em; margin-bottom: 0.15em; }
	.eo-learn-msg :global(pre) {
		max-width: 100%;
		overflow-x: auto;
		margin: 0.6em 0;
		padding: 0.6em 0.8em;
		border-radius: 0.375rem;
		font-size: 0.8em;
	}
	.eo-learn-msg :global(code) { word-break: break-word; }
	/* 站点给正文 a 加了 p-1 -m-1 的点击热区，气泡里会把行距顶开 */
	.eo-learn-msg :global(a) { padding: 0; margin: 0; }
	.eo-learn-msg :global(blockquote) { margin: 0.6em 0; padding-left: 0.8em; }
	.eo-learn-msg :global(table) { display: block; max-width: 100%; overflow-x: auto; }
</style>
