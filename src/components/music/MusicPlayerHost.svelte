<script lang="ts">
import Icon from "@iconify/svelte";
import { onDestroy, onMount } from "svelte";
import {
	advance,
	attachAudio,
	configure,
	currentTrack,
	detachAudio,
	duration,
	ensureLibrary,
	formatTime,
	handleEnded,
	player,
	progressPercent,
	progressValue,
	seekTo,
	showNotice,
	togglePlay,
} from "./player.svelte";

let {
	apiBase,
	playlists,
}: { apiBase: string; playlists: { id: string; name?: string }[] } = $props();

configure(apiBase, playlists);

let audioEl: HTMLAudioElement | undefined = $state();
let onMusicPage = $state(false);
let track = $derived(currentTrack());
let progress = $derived(progressValue());
let percent = $derived(progressPercent());
let total = $derived(duration());

function applyRoute(pathname: string): void {
	const path = pathname.replace(/\/+$/, "") || "/";
	onMusicPage = path === "/music";
	if (onMusicPage) void ensureLibrary();
}

function syncRoute(): void {
	applyRoute(window.location.pathname);
}

function bindSwup(): void {
	const swup = (
		window as unknown as {
			swup?: {
				hooks?: {
					on: (
						event: string,
						callback: (visit?: { to?: { url?: string } }) => void,
					) => void;
				};
			};
		}
	).swup;
	if (swup?.hooks) {
		// 过渡一开始就切换迷你播放器的显隐，不用等新内容替换完
		swup.hooks.on("visit:start", (visit) => {
			if (visit?.to?.url) {
				applyRoute(new URL(visit.to.url, window.location.origin).pathname);
			}
		});
		swup.hooks.on("page:view", syncRoute);
	} else {
		document.addEventListener("swup:enable", bindSwup, { once: true });
	}
}

$effect(() => {
	if (audioEl) attachAudio(audioEl);
});

$effect(() => {
	if (audioEl) audioEl.volume = player.muted ? 0 : player.volume;
});

// 系统媒体面板（锁屏 / 播放控制中心）上的进度条
$effect(() => {
	if (typeof navigator === "undefined" || !("mediaSession" in navigator))
		return;
	const item = track;
	const time = total;
	if (!item || !Number.isFinite(time) || time <= 0) return;
	try {
		navigator.mediaSession.setPositionState({
			duration: time,
			position: Math.min(progress, time),
			playbackRate: 1,
		});
	} catch {
		// 有的浏览器比较挑参数，出错就算了，不该影响播放本身
	}
});

onMount(() => {
	syncRoute();
	bindSwup();

	if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
		navigator.mediaSession.setActionHandler("play", togglePlay);
		navigator.mediaSession.setActionHandler("pause", togglePlay);
		navigator.mediaSession.setActionHandler("previoustrack", () => advance(-1));
		navigator.mediaSession.setActionHandler("nexttrack", () => advance(1));
	}

	// 只在音乐页接管空格 / Shift + 左右：文章页里空格还得留给滚动
	const onKeydown = (event: KeyboardEvent) => {
		if (!onMusicPage) return;
		const target = event.target as HTMLElement | null;
		if (
			target &&
			(target.isContentEditable ||
				["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName))
		) {
			return;
		}
		if (event.code === "Space") {
			event.preventDefault();
			togglePlay();
		} else if (event.shiftKey && event.code === "ArrowRight") {
			seekTo(Math.min(total || 0, progress + 5));
		} else if (event.shiftKey && event.code === "ArrowLeft") {
			seekTo(Math.max(0, progress - 5));
		}
	};
	window.addEventListener("keydown", onKeydown);

	return () => {
		window.removeEventListener("keydown", onKeydown);
		detachAudio();
	};
});
</script>

<audio
	bind:this={audioEl}
	preload="none"
	ontimeupdate={() => {
		if (!player.seeking && audioEl) player.currentTime = audioEl.currentTime;
	}}
	ondurationchange={() => {
		player.liveDuration =
			audioEl && Number.isFinite(audioEl.duration) ? audioEl.duration : 0;
	}}
	onplay={() => {
		player.playing = true;
	}}
	onpause={() => {
		player.playing = false;
	}}
	onended={handleEnded}
	onerror={() => {
		if (audioEl?.src) showNotice("音频加载失败，换一首试试");
	}}
></audio>

{#if !onMusicPage && track}
	<div class="music-mini fixed left-3 bottom-3 z-40 lg:left-8 lg:bottom-8">
		<a href="/music/" class="music-mini-cover" aria-label={`打开音乐页：${track.name}`}>
			{#if track.cover}
				<img src={track.cover} alt="" />
			{:else}
				<Icon icon="material-symbols:music-note-rounded" class="text-lg text-50" />
			{/if}
			{#if player.playing}
				<span class="music-mini-eq"><i></i><i></i><i></i></span>
			{/if}
		</a>

		<div class="min-w-0 flex-1">
			<a href="/music/" class="block min-w-0">
				<span class="block truncate text-xs font-bold text-90">{track.name}</span>
				<span class="block truncate text-[0.68rem] text-50">
					{player.notice || track.artists}
				</span>
			</a>

			<div class="mt-1 flex items-center gap-1.5">
				<span class="w-7 shrink-0 text-right text-[0.6rem] tabular-nums text-50">
					{formatTime(progress)}
				</span>
				<input
					type="range"
					class="music-mini-range min-w-0 flex-1"
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
				<span class="w-7 shrink-0 text-[0.6rem] tabular-nums text-50">
					{formatTime(total)}
				</span>
			</div>
		</div>

		<div class="flex shrink-0 items-center gap-0.5">
			<button type="button" class="music-mini-btn" title="上一首" onclick={() => advance(-1)}>
				<Icon icon="material-symbols:skip-previous-rounded" />
			</button>
			<button
				type="button"
				class="music-mini-play"
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
			<button type="button" class="music-mini-btn" title="下一首" onclick={() => advance(1)}>
				<Icon icon="material-symbols:skip-next-rounded" />
			</button>
		</div>
	</div>
{/if}

<style>
	.music-mini {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: calc(100vw - 6.5rem);
		max-width: 21rem;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--line-divider);
		border-radius: 0.9rem;
		background-color: var(--float-panel-bg);
		box-shadow: 0 16px 40px -18px rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(14px);
	}

	.music-mini-cover {
		position: relative;
		width: 2.7rem;
		height: 2.7rem;
		shrink: 0;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 0.55rem;
		background-color: var(--btn-regular-bg);
	}

	.music-mini-cover img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.music-mini-eq {
		position: absolute;
		left: 0.2rem;
		bottom: 0.2rem;
		display: flex;
		align-items: flex-end;
		gap: 1px;
		height: 0.7rem;
		padding: 0.12rem 0.22rem;
		border-radius: 999px;
		background-color: rgba(0, 0, 0, 0.45);
	}

	.music-mini-eq i {
		display: block;
		width: 2px;
		height: 100%;
		border-radius: 2px;
		background-color: #fff;
		animation: music-mini-bounce 0.8s ease-in-out infinite;
	}

	.music-mini-eq i:nth-child(2) {
		height: 62%;
		animation-delay: 0.15s;
	}

	.music-mini-eq i:nth-child(3) {
		height: 82%;
		animation-delay: 0.3s;
	}

	.music-mini-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 999px;
		font-size: 1.05rem;
		color: var(--btn-content);
		background-color: var(--btn-regular-bg);
		transition: background-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
	}

	.music-mini-btn:hover {
		color: var(--primary);
		background-color: var(--btn-regular-bg-hover);
	}

	.music-mini-btn:active {
		transform: scale(0.94);
		background-color: var(--btn-regular-bg-active);
	}

	.music-mini-play {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.4rem;
		height: 2.4rem;
		border-radius: 999px;
		font-size: 1.35rem;
		color: #fff;
		background-color: var(--primary);
		box-shadow: 0 8px 18px -8px var(--primary);
		transition: transform 0.15s ease, filter 0.15s ease;
	}

	.music-mini-play:hover {
		filter: brightness(1.08);
	}

	.music-mini-play:active {
		transform: scale(0.94);
	}

	.music-mini-range {
		appearance: none;
		-webkit-appearance: none;
		height: 0.22rem;
		border-radius: 999px;
		cursor: pointer;
		outline: none;
		background-image: linear-gradient(
			to right,
			var(--primary) 0 var(--music-progress, 0%),
			var(--btn-regular-bg) var(--music-progress, 0%) 100%
		);
	}

	.music-mini-range::-webkit-slider-thumb {
		appearance: none;
		-webkit-appearance: none;
		width: 0.55rem;
		height: 0.55rem;
		border: none;
		border-radius: 50%;
		background-color: #fff;
		box-shadow: 0 0 0 2px var(--primary);
	}

	.music-mini-range::-moz-range-thumb {
		width: 0.55rem;
		height: 0.55rem;
		border: none;
		border-radius: 50%;
		background-color: #fff;
		box-shadow: 0 0 0 2px var(--primary);
	}

	@keyframes music-mini-bounce {
		0%,
		100% {
			transform: scaleY(0.45);
		}
		50% {
			transform: scaleY(1);
		}
	}
</style>
