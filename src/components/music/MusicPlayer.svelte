<script lang="ts">
import Icon from "@iconify/svelte";
import { publishOgCardData } from "../../utils/og-card";
import LyricPanel from "./LyricPanel.svelte";
import {
	MODE_META,
	activePlaylist,
	advance,
	currentTrack,
	cycleMode,
	duration,
	formatTime,
	loadLibrary,
	lyrics,
	player,
	prepareTrack,
	progressPercent,
	progressValue,
	seekTo,
	setVolume,
	switchPlaylist,
	toggleLyrics,
	toggleMute,
	togglePlay,
	tracks,
	trialIds,
} from "./player.svelte";
import type { LoadedPlaylist } from "./player.svelte";

// 播放状态和 <audio> 都在 MusicPlayerHost 里（Layout 常驻），
// 这个组件只负责 /music/ 页面的歌单 UI。
const SKELETON_ROWS = [1, 2, 3, 4, 5, 6];

let active = $derived(activePlaylist());
let list = $derived(tracks());
let current = $derived(currentTrack());
let ids = $derived(trialIds());
let total = $derived(duration());
let progress = $derived(progressValue());
let percent = $derived(progressPercent());
let lines = $derived(lyrics());

/**
 * 歌单数据只有浏览器里才拿得到，算好一份精简快照推给分享卡组件。
 * 分享卡只是把这些数字排成图，云端不负责再请求网易云。
 */
function publishCard(library: LoadedPlaylist[], activeId: string): void {
	const first = library.find((item) => item.ref.id === activeId) ?? library[0];
	if (!first) return;
	const totalTracks = library.reduce((sum, item) => sum + item.tracks.length, 0);
	const totalMs = library.reduce(
		(sum, item) =>
			sum + item.tracks.reduce((acc, track) => acc + (track.duration || 0), 0),
		0,
	);
	const artists = new Set(
		library.flatMap((item) =>
			item.tracks.flatMap((track) =>
				track.artists
					.split(/[/、,&]/)
					.map((name) => name.trim())
					.filter(Boolean),
			),
		),
	);
	const hours = totalMs / 3_600_000;

	publishOgCardData("playlist", {
		title: first.ref.name || first.meta.name,
		subtitle: `${first.meta.creator ? `${first.meta.creator} · ` : ""}来自网易云音乐`,
		badge: "网易云",
		stats: [
			{ label: "曲目", value: `${totalTracks} 首` },
			{
				label: "总时长",
				value:
					hours >= 1
						? `${hours.toFixed(1)} 小时`
						: `${Math.round(totalMs / 60_000)} 分钟`,
			},
			{ label: "歌手", value: `${artists.size} 位` },
		],
		date: first.meta.creator || "",
	});
}

// 歌单加载完成或切换歌单时更新分享卡；library 为空时先不推，等接口回来
$effect(() => {
	if (player.library.length === 0) return;
	publishCard(player.library, player.activeId);
});
</script>

<div class="music-shell space-y-4">
	{#if player.loading}
		<section class="card-base p-5 md:p-7">
			<div class="grid gap-5 md:grid-cols-[12rem_1fr] md:gap-7">
				<div class="music-skeleton mx-auto aspect-square w-40 rounded-xl md:mx-0 md:w-full"></div>
				<div class="flex flex-col justify-between gap-4">
					<div class="space-y-3">
						<div class="music-skeleton h-3 w-24 rounded"></div>
						<div class="music-skeleton h-7 w-2/3 rounded"></div>
						<div class="music-skeleton h-4 w-1/3 rounded"></div>
					</div>
					<div class="music-skeleton h-1.5 w-full rounded-full"></div>
					<div class="music-skeleton h-12 w-44 rounded-full"></div>
				</div>
			</div>
		</section>
		<section class="card-base space-y-2 p-5">
			{#each SKELETON_ROWS as row (row)}
				<div class="music-skeleton h-9 w-full rounded-md"></div>
			{/each}
		</section>
	{:else if player.loadError}
		<section class="card-base p-8 text-center">
			<Icon icon="material-symbols:error-outline-rounded" class="text-[2rem] text-[var(--primary)]" />
			<p class="mt-3 font-bold text-90">歌单没能加载出来</p>
			<p class="mt-1 text-sm text-50">{player.loadError}</p>
			<button
				type="button"
				class="btn-regular mx-auto mt-4 h-10 rounded-lg px-4 text-sm font-bold"
				onclick={() => void loadLibrary()}
			>
				重新加载
			</button>
		</section>
	{:else}
		{#if player.library.length > 1}
			<section class="card-base p-2">
				<div class="hide-scrollbar flex gap-2 overflow-x-auto">
					{#each player.library as item (item.ref.id)}
						<button
							type="button"
							class="music-tab"
							class:is-active={item.ref.id === player.activeId}
							onclick={() => switchPlaylist(item.ref.id)}
						>
							<img
								src={item.meta.cover}
								alt=""
								class="h-8 w-8 shrink-0 rounded-md object-cover"
								loading="lazy"
							/>
							<span class="truncate text-xs font-bold">{item.meta.name}</span>
						</button>
					{/each}
				</div>
			</section>
		{/if}

		<section class="card-base music-hero relative overflow-hidden">
			{#if current?.cover}
				<img src={current.cover} alt="" class="music-hero-bg" aria-hidden="true" />
			{/if}

			<div class="relative p-5 md:p-7">
				<div class="grid gap-5 md:grid-cols-[12rem_1fr] md:gap-7">
					<div class="music-cover mx-auto w-40 md:mx-0 md:w-full">
						{#if current?.cover}
							<img src={current.cover} alt={current.name} />
						{:else}
							<Icon icon="material-symbols:music-note-rounded" class="text-[3rem] text-50" />
						{/if}
						{#if player.playing}
							<span class="music-cover-badge">
								<i class="music-bar"></i><i class="music-bar"></i><i class="music-bar"></i>
							</span>
						{/if}
					</div>

					<div class="flex min-w-0 flex-col justify-between gap-4">
						<header class="min-w-0">
							<p class="truncate text-xs text-50">
								{active?.meta.name ?? "歌单"}
								{#if active?.meta.creator}
									<span class="with-divider">{active.meta.creator}</span>
								{/if}
								<span class="with-divider">{list.length} 首可播放</span>
							</p>
							<h1 class="mt-1 truncate text-xl font-black text-90 md:text-2xl">
								{current?.name ?? "选一首开始播放"}
							</h1>
							<p class="mt-1 truncate text-sm text-50">
								{current?.artists ?? "来自网易云歌单"}
								{#if current?.album}
									<span class="with-divider">{current.album}</span>
								{/if}
								{#if current && ids.has(current.id)}
									<span class="music-tag">会员曲目 · 仅 30 秒试听</span>
								{/if}
							</p>
						</header>

						<div>
							<input
								type="range"
								class="music-range w-full"
								min="0"
								max={Math.max(total, 0.1)}
								step="0.1"
								value={progress}
								style={`--music-progress: ${percent}%`}
								aria-label="播放进度"
								onpointerdown={() => {
									player.seeking = true;
									player.seekValue = player.currentTime;
								}}
								oninput={(event) => {
									player.seeking = true;
									player.seekValue = Number(event.currentTarget.value);
								}}
								onchange={(event) => seekTo(Number(event.currentTarget.value))}
							/>
							<div class="mt-1 flex justify-between text-xs tabular-nums text-50">
								<span>{formatTime(progress)}</span>
								<span>{formatTime(total)}</span>
							</div>
						</div>

						<div class="flex flex-wrap items-center gap-2.5">
							<button
								type="button"
								class="music-btn h-10 w-10"
								title={MODE_META[player.mode].label}
								onclick={cycleMode}
							>
								<Icon icon={MODE_META[player.mode].icon} />
							</button>
							<button
								type="button"
								class="music-btn h-10 w-10"
								title="上一首"
								onclick={() => advance(-1)}
							>
								<Icon icon="material-symbols:skip-previous-rounded" />
							</button>
							<button
								type="button"
								class="music-play"
								title={player.playing ? "暂停" : "播放"}
								onclick={togglePlay}
							>
								{#if player.pending}
									<Icon icon="svg-spinners:180-ring" />
								{:else}
									<Icon
										icon={player.playing
											? "material-symbols:pause-rounded"
											: "material-symbols:play-arrow-rounded"}
									/>
								{/if}
							</button>
							<button
								type="button"
								class="music-btn h-10 w-10"
								title="下一首"
								onclick={() => advance(1)}
							>
								<Icon icon="material-symbols:skip-next-rounded" />
							</button>

							<div class="ml-auto flex items-center gap-2">
								<button
									type="button"
									class="music-btn h-9 w-9"
									title={player.muted ? "取消静音" : "静音"}
									onclick={toggleMute}
								>
									<Icon
										icon={player.muted || player.volume === 0
											? "material-symbols:volume-off-rounded"
											: "material-symbols:volume-up-rounded"}
									/>
								</button>
								<input
									type="range"
									class="music-range music-range-sm w-20 md:w-24"
									min="0"
									max="1"
									step="0.01"
									value={player.muted ? 0 : player.volume}
									style={`--music-progress: ${(player.muted ? 0 : player.volume) * 100}%`}
									aria-label="音量"
									oninput={(event) => setVolume(Number(event.currentTarget.value))}
								/>
							</div>

							<button
								type="button"
								class="music-btn h-9 gap-1.5 px-3 text-xs font-bold"
								onclick={toggleLyrics}
							>
								<Icon icon="material-symbols:lyrics-rounded" />
								<span>{player.showLyrics ? "收起歌词" : "歌词"}</span>
							</button>
						</div>
					</div>
				</div>

				{#if player.notice}
					<p class="music-notice">{player.notice}</p>
				{/if}
			</div>

			{#if player.showLyrics}
				<div class="relative border-t border-[var(--line-divider)]">
					<div class="h-56 md:h-64">
						<LyricPanel lines={lines} currentTime={player.currentTime} onseek={seekTo} />
					</div>
				</div>
			{/if}
		</section>

		<section class="card-base">
			<header
				class="flex flex-wrap items-center gap-2 border-b border-[var(--line-divider)] px-4 py-3 md:px-5"
			>
				<Icon icon="material-symbols:queue-music-rounded" class="text-[1.25rem] text-[var(--primary)]" />
				<h2 class="text-base font-bold text-90">曲目</h2>
				<span class="text-xs text-50">{list.length} 首</span>
				<a
					class="link ml-auto text-xs font-bold text-[var(--btn-content)]"
					href={`https://music.163.com/#/playlist?id=${active?.meta.id ?? ""}`}
					target="_blank"
					rel="noopener noreferrer"
				>
					去网易云看这个歌单
				</a>
			</header>

			{#if list.length === 0}
				<p class="px-5 py-10 text-center text-sm text-50">这个歌单里没有能直接播放的歌。</p>
			{:else}
				<ol class="max-h-[30rem] overflow-y-auto py-2">
					{#each list as track, index (track.id)}
						{@const isCurrent = track.id === current?.id}
						<li>
							<button
								type="button"
								class="music-row"
								onclick={() => prepareTrack(index, true)}
							>
								<span
									class="w-7 shrink-0 text-center text-[0.7rem] tabular-nums {isCurrent
										? 'text-[var(--primary)]'
										: 'text-50'}"
								>
									{#if isCurrent && player.playing}
										<span class="music-eq"><i></i><i></i><i></i></span>
									{:else}
										{String(index + 1).padStart(2, "0")}
									{/if}
								</span>
								<span class="min-w-0 flex-1 truncate text-left">
									<span class={isCurrent ? "text-sm font-bold text-[var(--primary)]" : "text-sm font-medium text-90"}>
										{track.name}
									</span>
									<span class="ml-1 text-xs text-50">{track.artists}</span>
									{#if ids.has(track.id)}
										<span class="music-tag shrink-0">试听</span>
									{/if}
								</span>
								{#if track.album}
									<span class="hidden max-w-[10rem] truncate text-xs text-50 md:block">
										{track.album}
									</span>
								{/if}
								<span class="w-10 shrink-0 text-right text-xs tabular-nums text-50">
									{formatTime(track.duration / 1000)}
								</span>
							</button>
						</li>
					{/each}
				</ol>
			{/if}

			{#if active && (active.filtered > 0 || active.truncated || ids.size > 0 || player.failedNames.length > 0)}
				<footer
					class="border-t border-[var(--line-divider)] px-4 py-3 text-xs leading-relaxed text-50 md:px-5"
				>
					{#if active.filteredApplied && active.filtered > 0}
						<p>已自动过滤 {active.filtered} 首播不了的歌（无版权或需要会员）。</p>
					{/if}
					{#if active.truncated}
						<p>歌单太长，这里只取了前面的 {active.tracks.length + active.filtered} 首。</p>
					{/if}
					{#if ids.size > 0}
						<p>
							其中 {ids.size} 首是会员曲目，免费账号只能试听 30 秒；给部署环境配好
							<code>NETEASE_COOKIE</code> 后即可完整播放。
						</p>
					{/if}

					{#if player.failedNames.length > 0}
						<p>没加载出来的歌单：{player.failedNames.join("、")}</p>
					{/if}
				</footer>
			{/if}
		</section>
	{/if}
</div>
<style>
	/* 播放器卡片是常驻内容，跟着 .card-base 的 hover 上浮会很怪，这里按掉 */
	.music-shell :global(.card-base:hover) {
		transform: none;
		box-shadow: none;
	}

	.music-hero-bg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		opacity: 0.16;
		filter: blur(40px) saturate(1.4);
		transform: scale(1.3);
		pointer-events: none;
	}

	.music-cover {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1 / 1;
		overflow: hidden;
		border-radius: 0.9rem;
		background-color: var(--btn-regular-bg);
		box-shadow: 0 14px 34px -16px rgba(0, 0, 0, 0.55);
	}

	.music-cover img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.music-cover-badge {
		position: absolute;
		left: 0.6rem;
		bottom: 0.6rem;
		display: flex;
		align-items: flex-end;
		gap: 2px;
		padding: 0.3rem 0.5rem;
		border-radius: 999px;
		background-color: rgba(0, 0, 0, 0.45);
		backdrop-filter: blur(4px);
	}

	.music-bar {
		display: block;
		width: 3px;
		height: 9px;
		border-radius: 2px;
		background-color: #fff;
		animation: music-bounce 0.9s ease-in-out infinite;
	}

	.music-bar:nth-child(2) {
		animation-delay: 0.15s;
	}

	.music-bar:nth-child(3) {
		animation-delay: 0.3s;
	}

	.music-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		font-size: 1.15rem;
		color: var(--btn-content);
		background-color: var(--btn-regular-bg);
		transition: background-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
	}

	.music-btn:hover {
		color: var(--primary);
		background-color: var(--btn-regular-bg-hover);
	}

	.music-btn:active {
		transform: scale(0.94);
		background-color: var(--btn-regular-bg-active);
	}

	.music-play {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 3.4rem;
		height: 3.4rem;
		border-radius: 999px;
		font-size: 1.7rem;
		color: #fff;
		background-color: var(--primary);
		box-shadow: 0 10px 24px -10px var(--primary);
		transition: transform 0.15s ease, filter 0.15s ease;
	}

	.music-play:hover {
		filter: brightness(1.08);
	}

	.music-play:active {
		transform: scale(0.94);
	}

	/* 进度条 / 音量条：已播部分用主题色填充，剩下的走背景色 */
	.music-range {
		appearance: none;
		-webkit-appearance: none;
		height: 0.4rem;
		border-radius: 999px;
		cursor: pointer;
		outline: none;
		background-image: linear-gradient(
			to right,
			var(--primary) 0 var(--music-progress, 0%),
			var(--btn-regular-bg) var(--music-progress, 0%) 100%
		);
	}

	.music-range-sm {
		height: 0.3rem;
	}

	.music-range::-webkit-slider-thumb {
		appearance: none;
		-webkit-appearance: none;
		width: 0.8rem;
		height: 0.8rem;
		border: none;
		border-radius: 50%;
		background-color: #fff;
		box-shadow: 0 0 0 2px var(--primary);
		transition: transform 0.15s ease;
	}

	.music-range:hover::-webkit-slider-thumb {
		transform: scale(1.15);
	}

	.music-range::-moz-range-thumb {
		width: 0.8rem;
		height: 0.8rem;
		border: none;
		border-radius: 50%;
		background-color: #fff;
		box-shadow: 0 0 0 2px var(--primary);
	}

	.music-tab {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		max-width: 12rem;
		padding: 0.35rem 0.7rem;
		border-radius: 0.6rem;
		color: var(--btn-content);
		transition: background-color 0.15s ease, color 0.15s ease;
	}

	.music-tab:hover {
		background-color: var(--btn-plain-bg-hover);
	}

	.music-tab.is-active {
		color: var(--primary);
		background-color: var(--btn-regular-bg);
	}

	.music-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.5rem 1rem;
		transition: background-color 0.15s ease;
	}

	.music-row:hover {
		background-color: var(--btn-plain-bg-hover);
	}

	.music-row:active {
		background-color: var(--btn-plain-bg-active);
	}

	.music-tag {
		display: inline-block;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		font-size: 0.65rem;
		font-weight: 700;
		line-height: 1.4;
		color: var(--primary);
		background-color: var(--btn-regular-bg);
	}

	.music-eq {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		gap: 1.5px;
		height: 0.85rem;
	}

	.music-eq i {
		display: block;
		width: 2.5px;
		border-radius: 2px;
		background-color: var(--primary);
		animation: music-bounce 0.8s ease-in-out infinite;
	}

	.music-eq i:nth-child(1) {
		height: 100%;
	}

	.music-eq i:nth-child(2) {
		height: 65%;
		animation-delay: 0.15s;
	}

	.music-eq i:nth-child(3) {
		height: 85%;
		animation-delay: 0.3s;
	}

	.music-notice {
		position: absolute;
		right: 1.25rem;
		bottom: 0.75rem;
		left: 1.25rem;
		text-align: center;
		font-size: 0.72rem;
		color: var(--btn-content);
	}

	.music-skeleton {
		background-color: var(--btn-regular-bg);
		animation: music-pulse 1.4s ease-in-out infinite;
	}

	@keyframes music-bounce {
		0%,
		100% {
			transform: scaleY(0.45);
		}
		50% {
			transform: scaleY(1);
		}
	}

	@keyframes music-pulse {
		0%,
		100% {
			opacity: 0.5;
		}
		50% {
			opacity: 1;
		}
	}
</style>
