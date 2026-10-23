<script lang="ts">
import Icon from "@iconify/svelte";
import type { ChatPostHit } from "./post-hits";

/**
 * 对话里「找到的文章」—— 比一行超链接多给一点判断依据：
 * 命中摘要、发布日期、分类和标签，扫一眼就知道点哪篇。
 */
interface Props {
	posts: ChatPostHit[];
}
let { posts }: Props = $props();
</script>

<div class="space-y-1.5">
	{#each posts as post (post.url)}
		<a
			href={post.url}
			class="group block rounded-lg border border-black/[0.07] bg-[var(--card-bg)] px-2.5 py-2 no-underline transition hover:-translate-y-0.5 hover:border-[var(--primary)]/40 hover:shadow-md dark:border-white/10"
		>
			<div class="flex items-start gap-1">
				<span class="min-w-0 flex-1 text-[0.8rem] font-bold leading-snug text-90 transition group-hover:text-[var(--primary)]">
					{post.title}
				</span>
				<Icon
					icon="material-symbols:chevron-right-rounded"
					class="mt-px shrink-0 text-[1rem] text-[var(--primary)] opacity-0 transition group-hover:opacity-100"
				/>
			</div>
			{#if post.snippet}
				<p class="mt-1 line-clamp-2 text-[0.7rem] leading-relaxed text-black/50 dark:text-white/50">
					{post.snippet}
				</p>
			{/if}
			{#if post.published || post.category || post.tags.length}
				<div class="mt-1.5 flex flex-wrap items-center gap-1 text-[0.65rem] text-black/40 dark:text-white/40">
					{#if post.published}<span class="font-mono">{post.published}</span>{/if}
					{#if post.category}
						<span class="rounded bg-black/[0.05] px-1.5 py-0.5 dark:bg-white/10">{post.category}</span>
					{/if}
					{#each post.tags.slice(0, 3) as tag}
						<span class="rounded bg-black/[0.05] px-1.5 py-0.5 dark:bg-white/10">#{tag}</span>
					{/each}
				</div>
			{/if}
		</a>
	{/each}
</div>
