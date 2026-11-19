<script lang="ts">
import Icon from "@iconify/svelte";
import { playRadio, player, stopRadio } from "../music/player.svelte";
import { type RadioCard, formatDuration, toRadioQueue } from "./radio-card";

/**
 * 对话里的「电台播放卡」。
 *
 * 卡片只是把歌和串词摆出来；真正出声的是全站常驻的 MusicPlayerHost（挂在
 * Swup 容器外，换页不停）。这里点播放键必须**同步**调 playRadio ——
 * 浏览器只认用户手势里的出声请求，绕一层 await 就会被拦掉。
 */
interface Props {
	card: RadioCard;
}
let { card }: Props = $props();

/** 这张卡是不是当前正在播的电台（靠队列标题 + 曲目 id 认，不靠 id，因为卡会被重复渲染） */
let active = $derived(
	player.queue !== null &&
		player.queue.tracks.length === card.tracks.length &&
		player.queue.tracks.every((track, i) => track.id === card.tracks[i]?.id),
);
let currentId = $derived(
	active ? (player.queue?.tracks[player.currentIndex]?.id ?? "") : "",
);

function play(index = 0) {
	// 同步调用，不要 await / setTimeout —— 否则丢掉用户手势，串词和歌都放不出来
	playRadio(toRadioQueue(card), index);
}
</script>

<div
	class="overflow-hidden rounded-xl border border-black/[0.08] bg-[var(--card-bg)] dark:border-white/10"
>
	<div class="flex items-center gap-2 border-b border-black/5 px-3 py-2 dark:border-white/10">
		<Icon
			icon="material-symbols:radio-rounded"
			class="shrink-0 text-[1.05rem] text-[var(--primary)]"
		/>
		<span class="min-w-0 flex-1 truncate text-[0.8rem] font-bold text-90">{card.title}</span>
		<span class="shrink-0 text-[0.65rem] text-black/40 dark:text-white/40">
			{card.tracks.length} 首
		</span>
		{#if active}
			<button
				class="flex shrink-0 items-center gap-1 rounded-md bg-black/5 px-2 py-1 text-[0.65rem] text-black/60 transition hover:bg-black/10 dark:bg-white/10 dark:text-white/60 dark:hover:bg-white/20"
				onclick={() => stopRadio()}
			>
				<Icon icon="material-symbols:stop-rounded" class="text-[0.9rem]" />
				退出电台
			</button>
		{:else}
			<button
				class="flex shrink-0 items-center gap-1 rounded-md bg-[var(--primary)] px-2.5 py-1 text-[0.65rem] font-bold text-white transition hover:opacity-90"
				onclick={() => play(0)}
			>
				<Icon icon="material-symbols:play-arrow-rounded" class="text-[0.95rem]" />
				开始收听
			</button>
		{/if}
	</div>

	<ol class="divide-y divide-black/5 dark:divide-white/10">
		{#each card.tracks as track, index (track.id)}
			{@const isCurrent = currentId === track.id}
			<li>
				<button
					class="flex w-full items-start gap-2.5 px-3 py-2 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
					onclick={() => play(index)}
					title="播这首"
				>
					<span class="relative mt-0.5 h-9 w-9 shrink-0">
						{#if track.cover}
							<img
								src={track.cover}
								alt=""
								loading="lazy"
								referrerpolicy="no-referrer"
								class="h-9 w-9 rounded-md object-cover"
							/>
						{:else}
							<span
								class="flex h-9 w-9 items-center justify-center rounded-md bg-black/5 dark:bg-white/10"
							>
								<Icon
									icon="material-symbols:music-note-rounded"
									class="text-[1rem] text-black/30 dark:text-white/30"
								/>
							</span>
						{/if}
						{#if isCurrent && player.playing}
							<span
								class="absolute inset-0 flex items-center justify-center rounded-md bg-black/45"
							>
								<Icon
									icon="material-symbols:graphic-eq-rounded"
									class="text-[1rem] text-white"
								/>
							</span>
						{/if}
					</span>

					<span class="min-w-0 flex-1">
						<span class="flex items-baseline gap-1.5">
							<span
								class="min-w-0 truncate text-[0.78rem] font-bold {isCurrent
									? 'text-[var(--primary)]'
									: 'text-90'}"
							>
								{index + 1}. {track.name}
							</span>
							{#if track.trial}
								<span
									class="shrink-0 rounded bg-amber-500/15 px-1 py-px text-[0.6rem] text-amber-600 dark:text-amber-400"
									title="会员曲目，未登录时只能试听 30 秒"
								>
									试听
								</span>
							{/if}
							{#if track.duration > 0}
								<span class="ml-auto shrink-0 font-mono text-[0.62rem] text-black/35 dark:text-white/35">
									{formatDuration(track.duration)}
								</span>
							{/if}
						</span>
						<span class="mt-0.5 block truncate text-[0.68rem] text-black/45 dark:text-white/45">
							{track.artists}
						</span>
						{#if track.intro}
							<span
								class="mt-1 block text-[0.68rem] leading-relaxed text-black/55 dark:text-white/55"
							>
								{track.intro}
							</span>
						{/if}
					</span>
				</button>
			</li>
		{/each}
	</ol>

	{#if active && player.notice}
		<p class="border-t border-black/5 px-3 py-1.5 text-[0.65rem] text-black/45 dark:border-white/10 dark:text-white/45">
			{player.notice}
		</p>
	{/if}
</div>
