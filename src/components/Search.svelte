<script lang="ts">
import Icon from "@iconify/svelte";
import {
	type FilterOptions,
	type HighlightPart,
	type SearchDoc,
	type SearchHit,
	type SearchResponse,
	collectFilterOptions,
	highlightTokens,
	parseIndexVersion,
	parseSearchIndex,
	rankFullText,
	searchDocs,
	snippetFromChunks,
	tokenize,
} from "@utils/search-core.ts";
import {
	type ChunkGroup,
	type QueryPostings,
	type ShardPayload,
	chunkGroupOf,
	collectQueryPostings,
	shardsForTokens,
} from "@utils/search-index.ts";
import { url } from "@utils/url-utils.ts";
import { onMount, tick } from "svelte";
import { registerShortcut } from "../scripts/shortcuts";

/**
 * 站内搜索面板。
 *
 * 数据分两层，都只在真正搜索时加载：
 * - `/posts-index.json`：标题 / 分类 / 标签 / 小节标题 / 首段，一次拿全；
 * - `/search-index/shard/<n>.json`：正文倒排表分片，按查询词的哈希只拉需要的几片；
 * - `/search-index/body/<doc>/<group>.json`：命中结果所在的正文块，用来生成摘要。
 *
 * 这样既不像旧实现那样拉整份 `/rss.xml`，也不会把 1MB 正文一次性交给浏览器。
 * 匹配与排序规则见 `src/utils/search-core.ts`。
 */

const RESULT_LIMIT = 20;
/**
 * 打开面板时先给前几条拉正文摘要，其余的等鼠标移上去再拉。
 * 每条摘要都要一个正文块文件（几 KB 到十几 KB），一次全拉会白白多几十 KB。
 */
const SNIPPET_LIMIT = 6;
const EMPTY_RESPONSE: SearchResponse = { hits: [], total: 0 };
const EMPTY_FILTERS: FilterOptions = { categories: [], tags: [] };
const DEBOUNCE_MS = 120;

/** 组件可能随 swup 导航重挂载，这些缓存放模块级，只拉一次。 */
let indexPromise: Promise<SearchDoc[]> | null = null;
const shardCache = new Map<number, Promise<ShardPayload>>();
const bodyCache = new Map<string, Promise<ChunkGroup>>();
/**
 * 索引版本（构建时间）。文档号是排序后的下标，加一篇文章就会整体位移，
 * 所以分片/正文块请求都带 `?v=`：重新构建后旧缓存自然失效，不会串到别的文章。
 */
let indexVersion = "";

let keyword = "";
let category = "";
let tag = "";
let panelOpen = false;
let loading = false;
let searching = false;
let loadError = "";
let docs: SearchDoc[] = [];
let filterOptions: FilterOptions = EMPTY_FILTERS;
let response: SearchResponse = EMPTY_RESPONSE;
let hits: SearchHit[] = [];
let snippets: Record<number, HighlightPart[]> = {};
let total = 0;
let activeIndex = -1;
let desktopInput: HTMLInputElement | undefined;
let mobileInput: HTMLInputElement | undefined;
let shortcutLabel = "Ctrl K";

/** 异步检索的代次：输入变动会 +1，旧结果回来时直接丢掉。 */
let generation = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

$: hasCriteria = keyword.trim().length > 0 || category !== "" || tag !== "";
$: filterOptions = docs.length > 0 ? collectFilterOptions(docs) : EMPTY_FILTERS;
$: hits = response.hits;
$: total = response.total;
$: if (hits) {
	// 结果集变化时把键盘焦点拉回第一条
	activeIndex = hits.length > 0 ? 0 : -1;
}
$: criteriaKey = `${keyword}|${category}|${tag}`;
$: if (docs.length > 0) {
	criteriaKey;
	void queueSearch();
}

async function fetchJson<T>(path: string): Promise<T> {
	const res = await fetch(url(path), {
		headers: { Accept: "application/json" },
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return (await res.json()) as T;
}

async function ensureIndex(): Promise<void> {
	if (docs.length > 0 || loading) return;
	loading = true;
	loadError = "";
	try {
		if (!indexPromise) {
			indexPromise = fetchJson<unknown>("/posts-index.json").then((payload) => {
				indexVersion = parseIndexVersion(payload);
				return parseSearchIndex(payload);
			});
		}
		const loaded = await indexPromise;
		if (loaded.length === 0) {
			indexPromise = null;
			loadError = "搜索索引为空";
			return;
		}
		docs = loaded;
	} catch (error) {
		console.error("站内搜索索引加载失败:", error);
		indexPromise = null;
		loadError = "搜索索引加载失败，请稍后重试";
	} finally {
		loading = false;
	}
}

function versionQuery(): string {
	return indexVersion ? `?v=${indexVersion}` : "";
}

function shardPromise(shard: number): Promise<ShardPayload> {
	let promise = shardCache.get(shard);
	if (!promise) {
		promise = fetchJson<ShardPayload>(
			`/search-index/shard/${shard}.json${versionQuery()}`,
		).catch((error) => {
			// 失败的请求不留缓存，下次输入重试
			shardCache.delete(shard);
			throw error;
		});
		shardCache.set(shard, promise);
	}
	return promise;
}

async function loadPostings(tokens: string[]): Promise<QueryPostings> {
	const shardIds = shardsForTokens(tokens);
	const entries = await Promise.all(
		shardIds.map(async (shard) => [shard, await shardPromise(shard)] as const),
	);
	return collectQueryPostings(tokens, new Map(entries));
}

function chunkGroupPromise(docId: number, group: number): Promise<ChunkGroup> {
	const key = `${docId}/${group}`;
	let promise = bodyCache.get(key);
	if (!promise) {
		promise = fetchJson<ChunkGroup>(
			`/search-index/body/${docId}/${group}.json${versionQuery()}`,
		).catch((error) => {
			bodyCache.delete(key);
			throw error;
		});
		bodyCache.set(key, promise);
	}
	return promise;
}

/**
 * 摘要按需拉取：只取每条结果第一个命中块所在的正文文件。
 * `only` 为空表示只处理前 SNIPPET_LIMIT 条，其余由 hover 触发。
 */
async function loadSnippets(
	result: SearchHit[],
	tokens: string[],
	gen: number,
	only: number[] = [],
): Promise<void> {
	const targets = result
		.map((hit, index) => ({ hit, index }))
		.filter(({ index }) =>
			only.length === 0 ? index < SNIPPET_LIMIT : only.includes(index),
		)
		.map(({ hit, index }) => {
			const chunk = hit.chunks?.[0];
			if (chunk === undefined || snippets[hit.doc.id]) return null;
			return { docId: hit.doc.id, chunk, index };
		})
		.filter(
			(item): item is { docId: number; chunk: number; index: number } =>
				item !== null,
		);
	if (targets.length === 0) return;

	const loaded = await Promise.all(
		targets.map(async ({ docId, chunk }) => {
			try {
				const group = await chunkGroupPromise(docId, chunkGroupOf(chunk));
				const text = group.chunks[chunk - group.start];
				if (!text) return null;
				return [docId, snippetFromChunks([text], tokens)] as const;
			} catch (error) {
				console.warn("正文块加载失败:", error);
				return null;
			}
		}),
	);
	if (gen !== generation) return;

	const next = { ...snippets };
	for (const item of loaded) {
		if (item) next[item[0]] = item[1];
	}
	snippets = next;
}

/** 鼠标移到某条结果上时才补它的摘要，避免一次性拉满 20 个正文块。 */
function onResultHover(item: SearchHit, index: number): void {
	activeIndex = index;
	if (snippets[item.doc.id] || !item.chunks?.length) return;
	void loadSnippets(hits, highlightTokens(keyword), generation, [index]);
}

async function runSearch(gen: number): Promise<void> {
	const query = keyword;
	const activeCategory = category;
	const activeTag = tag;
	const hasQuery = query.trim().length > 0;

	// 换了关键词就把旧摘要清掉：同一个文档在新结果里出现时，
	// 不能让它继续显示上一次查询的高亮片段。
	snippets = {};

	if (!hasQuery && !activeCategory && !activeTag) {
		response = EMPTY_RESPONSE;
		searching = false;
		return;
	}

	const tokens = tokenize(query);

	// 只有筛选条件时不需要正文倒排表，直接按发布时间列出
	if (tokens.length === 0) {
		response = searchDocs(docs, "", {
			category: activeCategory,
			tag: activeTag,
			limit: RESULT_LIMIT,
		});
		searching = false;
		return;
	}

	searching = true;
	let postings: QueryPostings | null = null;
	try {
		postings = await loadPostings(tokens);
	} catch (error) {
		// 分片拿不到时退回到元信息检索，至少有标题/标签能搜
		console.warn("正文索引加载失败，退回元信息检索:", error);
	}
	if (gen !== generation) return;

	if (postings) {
		response = rankFullText(docs, query, postings, {
			category: activeCategory,
			tag: activeTag,
			limit: RESULT_LIMIT,
		});
	} else {
		response = searchDocs(docs, query, {
			category: activeCategory,
			tag: activeTag,
			limit: RESULT_LIMIT,
		});
	}
	searching = false;

	if (postings && response.hits.length > 0) {
		void loadSnippets(response.hits, highlightTokens(query), gen);
	} else {
		snippets = {};
	}
}

function queueSearch(): void {
	generation += 1;
	const gen = generation;
	if (debounceTimer) clearTimeout(debounceTimer);
	debounceTimer = setTimeout(() => {
		debounceTimer = null;
		void runSearch(gen);
	}, DEBOUNCE_MS);
}

function openPanel(): void {
	panelOpen = true;
	void ensureIndex();
}

function closePanel(): void {
	panelOpen = false;
}

async function focusSearch(): Promise<void> {
	panelOpen = true;
	void ensureIndex();
	await tick();
	const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
	const input = isDesktop ? desktopInput : mobileInput;
	input?.focus();
	input?.select();
}

function togglePanel(): void {
	if (panelOpen) {
		closePanel();
		return;
	}
	void focusSearch();
}

function onInput(event: Event): void {
	const value = (event.currentTarget as HTMLInputElement | null)?.value ?? "";
	if (value.trim() || category || tag) panelOpen = true;
	void ensureIndex();
}

function onFilterChange(): void {
	panelOpen = true;
	void ensureIndex();
}

function onDesktopFocus(): void {
	if (hasCriteria) openPanel();
}

function clearFilters(): void {
	keyword = "";
	category = "";
	tag = "";
}

function navigate(target: string): void {
	closePanel();
	// Swup 的实例方法叫 navigate（不是 visit）。实例不在或还在初始化时直接整页跳转。
	const swup = (
		window as unknown as { swup?: { navigate?: (url: string) => unknown } }
	).swup;
	if (typeof swup?.navigate === "function") {
		swup.navigate(target);
	} else {
		window.location.href = target;
	}
}

async function scrollActiveIntoView(): Promise<void> {
	await tick();
	document
		.getElementById(`search-result-${activeIndex}`)
		?.scrollIntoView({ block: "nearest" });
}

function onSearchKeydown(event: KeyboardEvent): void {
	if (!panelOpen || hits.length === 0) return;

	if (event.key === "ArrowDown") {
		event.preventDefault();
		activeIndex = (activeIndex + 1) % hits.length;
		void scrollActiveIntoView();
	} else if (event.key === "ArrowUp") {
		event.preventDefault();
		activeIndex = (activeIndex - 1 + hits.length) % hits.length;
		void scrollActiveIntoView();
	} else if (event.key === "Enter") {
		const hit = hits[activeIndex];
		if (!hit) return;
		event.preventDefault();
		navigate(hit.doc.url);
	}
}

function onDocumentClick(event: MouseEvent): void {
	const target = event.target;
	if (!(target instanceof Node)) return;
	for (const id of ["search-panel", "search-bar", "search-switch"]) {
		const element = document.getElementById(id);
		if (element && (element === target || element.contains(target))) return;
	}
	closePanel();
}

onMount(() => {
	const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
	shortcutLabel = isMac ? "⌘K" : "Ctrl K";

	// ⌘K / Ctrl K、/ 由快捷键中心统一分发，这里只负责聚焦输入框
	const onFocusSearchShortcut = () => void focusSearch();
	document.addEventListener("site:focus-search", onFocusSearchShortcut);

	// 面板打开时 Esc 无论焦点在不在输入框里都能关闭
	const unregisterEscape = registerShortcut({
		id: "search.escape",
		key: "Escape",
		when: () => panelOpen,
		whenLayerOpen: true,
		allowInEditable: true,
		priority: 200,
		handler: () => {
			closePanel();
			const active = document.activeElement;
			if (
				active instanceof HTMLInputElement &&
				(active === desktopInput || active === mobileInput)
			) {
				active.blur();
			}
		},
	});

	document.addEventListener("click", onDocumentClick);

	return () => {
		unregisterEscape();
		document.removeEventListener("site:focus-search", onFocusSearchShortcut);
		document.removeEventListener("click", onDocumentClick);
		if (debounceTimer) clearTimeout(debounceTimer);
	};
});
</script>

<!-- search bar for desktop view -->
<div id="search-bar" on:pointerenter={() => void ensureIndex()} class="hidden lg:flex relative transition-all items-center h-11 mr-2 rounded-lg
      bg-black/[0.04] hover:bg-black/[0.06] focus-within:bg-black/[0.06]
      dark:bg-white/5 dark:hover:bg-white/10 dark:focus-within:bg-white/10
">
    <Icon icon="material-symbols:search" class="absolute text-[1.25rem] pointer-events-none ml-3 transition my-auto text-black/30 dark:text-white/30"></Icon>
    <input
        bind:this={desktopInput}
        bind:value={keyword}
        on:input={onInput}
        on:focus={onDesktopFocus}
        on:keydown={onSearchKeydown}
        placeholder="搜索文章"
        aria-label="搜索文章"
        role="combobox"
        aria-expanded={panelOpen}
        aria-controls="search-panel"
        autocomplete="off"
        spellcheck={false}
        class="transition-all pl-10 pr-16 text-sm bg-transparent outline-0
         h-full w-40 active:w-60 focus:w-60 text-black/50 dark:text-white/50"
    >
    {#if !keyword}
        <kbd class="pointer-events-none absolute right-2.5 text-[0.6875rem] font-mono text-black/35 dark:text-white/35">{shortcutLabel}</kbd>
    {/if}
</div>

<!-- toggle btn for phone/tablet view -->
<button on:click={togglePanel} on:pointerenter={() => void ensureIndex()} aria-label="打开搜索" aria-expanded={panelOpen} id="search-switch"
        class="btn-plain scale-animation lg:!hidden rounded-lg w-11 h-11 active:scale-90">
    <Icon icon="material-symbols:search" class="text-[1.25rem]"></Icon>
</button>

<!-- search panel -->
<div id="search-panel" class:float-panel-closed={!panelOpen} class="float-panel search-panel absolute md:w-[30rem]
top-20 left-4 md:left-[unset] right-4 shadow-2xl rounded-2xl p-2">

    <!-- search bar inside panel for phone/tablet -->
    <div id="search-bar-inside" class="relative flex lg:hidden transition-all items-center h-11 rounded-xl
      bg-black/[0.04] hover:bg-black/[0.06] focus-within:bg-black/[0.06]
      dark:bg-white/5 dark:hover:bg-white/10 dark:focus-within:bg-white/10
  ">
        <Icon icon="material-symbols:search" class="absolute text-[1.25rem] pointer-events-none ml-3 transition my-auto text-black/30 dark:text-white/30"></Icon>
        <input
            bind:this={mobileInput}
            bind:value={keyword}
            on:input={onInput}
            on:keydown={onSearchKeydown}
            placeholder="搜索文章"
            aria-label="搜索文章"
            role="combobox"
            aria-expanded={panelOpen}
            aria-controls="search-panel"
            autocomplete="off"
            spellcheck={false}
            class="pl-10 pr-3 w-full h-full text-sm bg-transparent outline-0 text-black/50 dark:text-white/50"
        >
    </div>

    {#if docs.length > 0}
        <div class="flex flex-wrap items-center gap-2 px-2 pt-2">
            <select
                bind:value={category}
                on:change={onFilterChange}
                aria-label="按分类筛选"
                class="h-8 max-w-[10rem] rounded-lg border border-black/10 dark:border-white/10 bg-transparent px-2 text-xs text-black/60 dark:text-white/60 outline-none focus:border-[var(--primary)]"
            >
                <option value="">全部分类</option>
                {#each filterOptions.categories as option}
                    <option value={option.value}>{option.value}（{option.count}）</option>
                {/each}
            </select>
            <select
                bind:value={tag}
                on:change={onFilterChange}
                aria-label="按标签筛选"
                class="h-8 max-w-[10rem] rounded-lg border border-black/10 dark:border-white/10 bg-transparent px-2 text-xs text-black/60 dark:text-white/60 outline-none focus:border-[var(--primary)]"
            >
                <option value="">全部标签</option>
                {#each filterOptions.tags as option}
                    <option value={option.value}>{option.value}（{option.count}）</option>
                {/each}
            </select>
            {#if hasCriteria}
                <button
                    type="button"
                    on:click={clearFilters}
                    class="h-8 rounded-lg px-2 text-xs text-black/45 transition hover:text-[var(--primary)] dark:text-white/45"
                >
                    清除
                </button>
            {/if}
        </div>
    {/if}

    <div class="px-3 py-2 text-xs text-black/40 dark:text-white/40">
        {#if loading}
            正在加载搜索索引…
        {:else if loadError}
            {loadError}
        {:else if !hasCriteria}
            输入关键词，或按分类 / 标签筛选 · 共 {docs.length} 篇文章
        {:else if searching}
            正在检索正文…
        {:else if total === 0}
            没有找到匹配的文章
        {:else}
            共 {total} 篇{total > hits.length ? `，显示前 ${hits.length} 篇` : ""}
        {/if}
    </div>

    <!-- search results -->
    <div role="listbox" aria-label="搜索结果">
        {#each hits as item, index (item.doc.slug)}
            <a
                id={`search-result-${index}`}
                href={item.doc.url}
                role="option"
                aria-selected={index === activeIndex}
                on:click={closePanel}
                on:mouseenter={() => onResultHover(item, index)}
                class="search-result transition first-of-type:mt-2 lg:first-of-type:mt-0 group block
       rounded-xl text-lg px-3 py-2 hover:bg-[var(--btn-plain-bg-hover)] active:bg-[var(--btn-plain-bg-active)]"
            >
                <div class="transition text-90 inline-flex font-bold group-hover:text-[var(--primary)]">
                    {#each item.titleParts as part}{#if part.match}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}<Icon icon="fa6-solid:chevron-right" class="transition text-[0.75rem] translate-x-1 my-auto text-[var(--primary)]"></Icon>
                </div>
                <div class="transition text-xs text-black/35 dark:text-white/35 mb-1 font-mono">
                    {item.doc.url}
                </div>
                {#if item.doc.category || item.doc.tags.length > 0}
                    <div class="mb-1 flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-black/45 dark:text-white/45">
                        {#if item.doc.category}
                            <span class="rounded bg-black/[0.05] px-1.5 py-0.5 dark:bg-white/10">{item.doc.category}</span>
                        {/if}
                        {#each item.doc.tags.slice(0, 3) as resultTag}
                            <span class="rounded bg-black/[0.05] px-1.5 py-0.5 dark:bg-white/10">#{resultTag}</span>
                        {/each}
                    </div>
                {/if}
                {#if snippets[item.doc.id]?.length}
                    <div class="transition text-sm text-50">
                        {#each snippets[item.doc.id] as part}{#if part.match}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}
                    </div>
                {:else if item.snippet.length > 0}
                    <div class="transition text-sm text-50">
                        {#each item.snippet as part}{#if part.match}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}
                    </div>
                {/if}
            </a>
        {/each}
    </div>

    {#if panelOpen && hits.length > 0}
        <div class="px-3 py-2 text-[0.6875rem] text-black/30 dark:text-white/30">
            ↑↓ 选择 · Enter 打开 · Esc 关闭
        </div>
    {/if}
</div>

<style>
  input:focus {
    outline: 0;
  }
  .search-panel {
    background-color: var(--float-panel-bg-opaque);
    max-height: calc(100vh - 100px);
    overflow-y: auto;
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE and Edge */
  }

  .search-panel::-webkit-scrollbar {
    display: none; /* Chrome, Safari and Opera */
  }

  /* 键盘 ↑↓ 选中的条目和 hover 同一套高亮 */
  .search-result[aria-selected="true"] {
    background-color: var(--btn-plain-bg-hover);
  }

  /* 原生下拉弹层由系统渲染，不声明 color-scheme 时深色模式仍是白底，
     选项文字继承 dark:text-white/60 会变成白底白字 */
  select {
    color-scheme: light;
  }
  select option {
    background-color: #fff;
    color: rgb(0 0 0 / 0.75);
  }
  :global(.dark) select {
    color-scheme: dark;
  }
  :global(.dark) select option {
    background-color: var(--float-panel-bg-opaque);
    color: rgb(255 255 255 / 0.75);
  }
</style>
