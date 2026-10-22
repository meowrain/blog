<script lang="ts">
	import Icon from "@iconify/svelte";
	import { onDestroy, onMount } from "svelte";
	import { publishOgCardData } from "../../utils/og-card";
	import LyricPanel from "./LyricPanel.svelte";
	import { parseLrc } from "./lrc";

	type PlaylistRef = { id: string; name?: string };

	type Track = {
		id: string;
		name: string;
		artists: string;
		album: string;
		cover: string;
		duration: number;
	};

	type PlaylistMeta = {
		id: string;
		name: string;
		cover: string;
		description: string;
		trackCount: number;
		creator: string;
	};

	type LoadedPlaylist = {
		ref: PlaylistRef;
		meta: PlaylistMeta;
		tracks: Track[];
		trialIds: string[];
		filtered: number;
		filteredApplied: boolean;
		truncated: boolean;
	};

	type Mode = "list" | "single" | "shuffle";

	let { apiBase = "/api/music", playlists = [] }: { apiBase?: string; playlists?: PlaylistRef[] } =
		$props();

	// 接口 URL 统一带结尾斜杠：站点配的是 trailingSlash: "always"，而 astro dev 里
	// Astro 的路由会抢先认领不带斜杠的裸路径，本地中间件（src/plugins/dev-music-api.mjs）
	// 只有收到带斜杠的 URL 才接得住请求。线上云函数两种都认，所以统一带斜杠最省事。

	const STORAGE = {
		volume: "music:volume",
		mode: "music:mode",
		playlist: "music:playlist",
		track: "music:track",
	};

	const MODES: Mode[] = ["list", "single", "shuffle"];
	const MODE_META: Record<Mode, { icon: string; label: string }> = {
		list: { icon: "material-symbols:repeat-rounded", label: "列表循环" },
		single: { icon: "material-symbols:repeat-one-rounded", label: "单曲循环" },
		shuffle: { icon: "material-symbols:shuffle-rounded", label: "随机播放" },
	};

	// 组件是 client:only 挂载的，这里拿到的必然是浏览器环境；仍然留个兜底，
	// 免得以后改成 client:load 时在 SSR 阶段炸掉。
	const store = typeof localStorage === "undefined" ? null : localStorage;

	function readVolume(fallback: number): number {
		// getItem 没存过时返回 null，而 Number(null) === 0 —— 不挡住就会把「没存过」
		// 当成「音量为 0」，于是一进页面就是静音。
		const stored = store?.getItem(STORAGE.volume);
		if (stored === null || stored === undefined || stored === "") return fallback;
		const raw = Number(stored);
		return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : fallback;
	}

	function readMode(): Mode {
		const raw = store?.getItem(STORAGE.mode) as Mode | null;
		return raw && MODES.includes(raw) ? raw : "list";
	}

	let library = $state<LoadedPlaylist[]>([]);
	let activeId = $state("");
	let loading = $state(true);
	let loadError = $state("");
	let failedNames = $state<string[]>([]);

	let audio: HTMLAudioElement | undefined = $state();
	let currentIndex = $state(-1);
	let playing = $state(false);
	let pending = $state(false);
	let currentTime = $state(0);
	let liveDuration = $state(0);
	let volume = $state(readVolume(0.7));
	let muted = $state(false);
	let mode = $state<Mode>(readMode());
	let seeking = $state(false);
	let seekValue = $state(0);
	let showLyrics = $state(false);
	let lyric = $state("");
	let tlyric = $state("");
	let deadTracks = $state<string[]>([]);
	let notice = $state("");
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;

	const activePlaylist = $derived(library.find((item) => item.ref.id === activeId) ?? null);
	const tracks = $derived(activePlaylist?.tracks ?? []);
	const trialIds = $derived(new Set(activePlaylist?.trialIds ?? []));
	const current = $derived(currentIndex >= 0 ? (tracks[currentIndex] ?? null) : null);
	const duration = $derived(liveDuration || (current ? current.duration / 1000 : 0));
	const lyrics = $derived(parseLrc(lyric, tlyric));
	const progressValue = $derived(seeking ? seekValue : currentTime);
	const progressPercent = $derived(duration > 0 ? (progressValue / duration) * 100 : 0);

	function formatTime(seconds: number): string {
		if (!Number.isFinite(seconds) || seconds <= 0) return "00:00";
		const total = Math.floor(seconds);
		const minutes = String(Math.floor(total / 60)).padStart(2, "0");
		return `${minutes}:${String(total % 60).padStart(2, "0")}`;
	}

	function showNotice(message: string) {
		notice = message;
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => {
			notice = "";
		}, 4000);
	}

	async function loadLibrary() {
		loading = true;
		loadError = "";

		const results = await Promise.allSettled(
			playlists.map(async (ref): Promise<LoadedPlaylist> => {
				const response = await fetch(`${apiBase}/playlist/?id=${encodeURIComponent(ref.id)}`);
				const data = await response.json().catch(() => null);
				if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
				return {
					ref: { id: String(data.playlist.id), name: ref.name || data.playlist.name },
					meta: data.playlist as PlaylistMeta,
					tracks: (data.tracks ?? []) as Track[],
					trialIds: (data.trialIds ?? []) as string[],
					filtered: Number(data.filtered ?? 0),
					filteredApplied: Boolean(data.filteredApplied),
					truncated: Boolean(data.truncated),
				};
			}),
		);

		library = results.flatMap((result) =>
			result.status === "fulfilled" ? [result.value] : [],
		);
		failedNames = playlists.flatMap((ref, index) =>
			results[index].status === "rejected" ? [ref.name || ref.id] : [],
		);
		loading = false;

		if (library.length === 0) {
			loadError = "歌单没能加载出来，多半是上游接口抽风了。";
			return;
		}
		restoreSession();
		publishCard();
	}

	/**
	 * 歌单数据只有浏览器里才拿得到，算好一份精简快照推给分享卡组件。
	 * 分享卡只是把这些数字排成图，云端不负责再请求网易云。
	 */
	function publishCard() {
		const first = library[0];
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

	function restoreSession() {
		const saved = store?.getItem(STORAGE.playlist);
		const target = library.find((item) => item.ref.id === saved) ?? library[0];
		activeId = target.ref.id;

		// 恢复上次听的歌，但绝不自作主张播放：浏览器会拦带声音的自动播放，
		// 而且刚进页面就被塞一耳朵也不是什么好体验。
		const savedTrack = store?.getItem(STORAGE.track);
		const index = target.tracks.findIndex((track) => track.id === savedTrack);
		currentIndex = index >= 0 ? index : target.tracks.length > 0 ? 0 : -1;
		if (currentIndex >= 0) void prepareTrack(currentIndex, false);
	}
	async function prepareTrack(index: number, autoplay: boolean, depth = 0) {
		const track = tracks[index];
		if (!track) return;

		currentIndex = index;
		pending = true;
		store?.setItem(STORAGE.track, track.id);
		if (autoplay) {
			currentTime = 0;
			liveDuration = 0;
		}

		try {
			const response = await fetch(`${apiBase}/song/?id=${encodeURIComponent(track.id)}`);
			const data = await response.json().catch(() => null);
			if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);

			if (!data?.playable || !data.url) {
				markDead(track, depth);
				return;
			}

			if (audio) {
				audio.src = data.url;
				audio.volume = muted ? 0 : volume;
			}
			void loadLyric(track.id);

			// 免费账号下的会员曲目只有 30 秒试听，不说明白会以为播放器坏了
			if (data.trial) {
				showNotice(`《${track.name}》是会员曲目，只能试听 30 秒`);
			}
			updateMediaSession(track);

			if (!autoplay || !audio) {
				playing = false;
				return;
			}
			try {
				await audio.play();
			} catch {
				playing = false;
				showNotice("浏览器拦住了自动播放，点一下播放键继续");
			}
		} catch (error) {
			showNotice(`这首歌没取到播放地址：${error instanceof Error ? error.message : "未知错误"}`);
		} finally {
			pending = false;
		}
	}

	// 歌单可用性在拉取时已经探过一轮，但播放地址会过期、会员状态也会变，
	// 真播不出来就把这首标记掉并顺着往下跳；depth 保证最多跳完一整圈就停手。
	function markDead(track: Track, depth: number) {
		if (!deadTracks.includes(track.id)) deadTracks = [...deadTracks, track.id];
		showNotice(`《${track.name}》暂时放不了，已跳过`);
		pending = false;
		if (depth + 1 < tracks.length) advance(1, depth + 1);
	}

	function advance(step: 1 | -1, depth = 0) {
		if (tracks.length === 0) return;

		if (mode === "shuffle" && tracks.length > 1) {
			let index = currentIndex;
			for (let i = 0; i < 12 && index === currentIndex; i++) {
				index = Math.floor(Math.random() * tracks.length);
			}
			void prepareTrack(index, true, depth);
			return;
		}

		let index = currentIndex;
		for (let i = 0; i < tracks.length; i++) {
			index = (index + step + tracks.length) % tracks.length;
			if (!deadTracks.includes(tracks[index]?.id ?? "")) break;
		}
		void prepareTrack(index, true, depth);
	}

	function togglePlay() {
		if (currentIndex < 0 && tracks.length > 0) {
			void prepareTrack(0, true);
			return;
		}
		if (!audio) return;
		if (audio.paused) {
			void audio.play().catch(() => showNotice("播放失败，稍后再试"));
		} else {
			audio.pause();
		}
	}

	function handleEnded() {
		if (mode === "single") {
			seekTo(0);
			void audio?.play();
			return;
		}
		advance(1);
	}

	function seekTo(time: number) {
		seekValue = time;
		seeking = false;
		currentTime = time;
		if (audio && Number.isFinite(audio.duration)) audio.currentTime = time;
	}

	function seekBy(delta: number) {
		const base = audio?.currentTime ?? currentTime;
		seekTo(Math.max(0, Math.min(duration || 0, base + delta)));
	}

	function cycleMode() {
		mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
	}

	function switchPlaylist(id: string) {
		if (id === activeId) return;
		const target = library.find((item) => item.ref.id === id);
		if (!target) return;

		audio?.pause();
		activeId = id;
		store?.setItem(STORAGE.playlist, id);
		lyric = "";
		tlyric = "";
		// 换歌单先把上一首松开，免得它还挂在 audio 上
		audio?.removeAttribute("src");
		currentIndex = target.tracks.length > 0 ? 0 : -1;
		currentTime = 0;
		liveDuration = 0;
		if (currentIndex >= 0) void prepareTrack(currentIndex, false);
		publishCard();
	}

	async function loadLyric(id: string) {
		lyric = "";
		tlyric = "";
		try {
			const response = await fetch(`${apiBase}/lyric/?id=${encodeURIComponent(id)}`);
			if (!response.ok) return;
			const data = await response.json();
			// 切歌够快时晚到的响应不能盖掉新歌的歌词
			if (tracks[currentIndex]?.id !== id) return;
			lyric = data.lyric ?? "";
			tlyric = data.tlyric ?? "";
		} catch {
			// 歌词拿不到就不显示，别因此打扰正在播的歌
		}
	}

	function updateMediaSession(track: Track) {
		if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
		navigator.mediaSession.metadata = new MediaMetadata({
			title: track.name,
			artist: track.artists,
			album: track.album || activePlaylist?.meta.name || "",
			artwork: track.cover ? [{ src: track.cover, sizes: "500x500" }] : [],
		});
	}

	$effect(() => {
		store?.setItem(STORAGE.volume, String(volume));
		if (audio) audio.volume = muted ? 0 : volume;
	});

	$effect(() => {
		store?.setItem(STORAGE.mode, mode);
	});

	// 系统媒体面板（锁屏 / 播放控制中心）上的进度条
	$effect(() => {
		if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
		if (!current || !Number.isFinite(duration) || duration <= 0) return;
		try {
			navigator.mediaSession.setPositionState({
				duration,
				position: Math.min(currentTime, duration),
				playbackRate: 1,
			});
		} catch {
			// 有的浏览器比较挑参数，出错就算了，不该影响播放本身
		}
	});

	onMount(() => {
		void loadLibrary();

		if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
			navigator.mediaSession.setActionHandler("play", togglePlay);
			navigator.mediaSession.setActionHandler("pause", togglePlay);
			navigator.mediaSession.setActionHandler("previoustrack", () => advance(-1));
			navigator.mediaSession.setActionHandler("nexttrack", () => advance(1));
		}

		// 空格播放/暂停，Shift + 左右快进快退；输入框里打字时不抢键
		const onKeydown = (event: KeyboardEvent) => {
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
				seekBy(5);
			} else if (event.shiftKey && event.code === "ArrowLeft") {
				seekBy(-5);
			}
		};
		window.addEventListener("keydown", onKeydown);

		return () => window.removeEventListener("keydown", onKeydown);
	});

	onDestroy(() => {
		clearTimeout(noticeTimer);
		audio?.pause();
	});
	const SKELETON_ROWS = [1, 2, 3, 4, 5, 6];
</script>

<audio
	bind:this={audio}
	preload="none"
	ontimeupdate={() => {
		if (!seeking && audio) currentTime = audio.currentTime;
	}}
	ondurationchange={() => {
		liveDuration = audio && Number.isFinite(audio.duration) ? audio.duration : 0;
	}}
	onplay={() => {
		playing = true;
	}}
	onpause={() => {
		playing = false;
	}}
	onended={handleEnded}
	onerror={() => {
		if (audio?.src) showNotice("音频加载失败，换一首试试");
	}}
></audio>

<div class="music-shell space-y-4">
	{#if loading}
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
	{:else if loadError}
		<section class="card-base p-8 text-center">
			<Icon icon="material-symbols:error-outline-rounded" class="text-[2rem] text-[var(--primary)]" />
			<p class="mt-3 font-bold text-90">歌单没能加载出来</p>
			<p class="mt-1 text-sm text-50">{loadError}</p>
			<button
				type="button"
				class="btn-regular mx-auto mt-4 h-10 rounded-lg px-4 text-sm font-bold"
				onclick={loadLibrary}
			>
				重新加载
			</button>
		</section>
	{:else}
		{#if library.length > 1}
			<section class="card-base p-2">
				<div class="hide-scrollbar flex gap-2 overflow-x-auto">
					{#each library as item (item.ref.id)}
						<button
							type="button"
							class="music-tab"
							class:is-active={item.ref.id === activeId}
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
						{#if playing}
							<span class="music-cover-badge">
								<i class="music-bar"></i><i class="music-bar"></i><i class="music-bar"></i>
							</span>
						{/if}
					</div>

					<div class="flex min-w-0 flex-col justify-between gap-4">
						<header class="min-w-0">
							<p class="truncate text-xs text-50">
								{activePlaylist?.meta.name ?? "歌单"}
								{#if activePlaylist?.meta.creator}
									<span class="with-divider">{activePlaylist.meta.creator}</span>
								{/if}
								<span class="with-divider">{tracks.length} 首可播放</span>
							</p>
							<h1 class="mt-1 truncate text-xl font-black text-90 md:text-2xl">
								{current?.name ?? "选一首开始播放"}
							</h1>
							<p class="mt-1 truncate text-sm text-50">
								{current?.artists ?? "来自网易云歌单"}
								{#if current?.album}
									<span class="with-divider">{current.album}</span>
								{/if}
								{#if current && trialIds.has(current.id)}
									<span class="music-tag">会员曲目 · 仅 30 秒试听</span>
								{/if}
							</p>
						</header>

						<div>
							<input
								type="range"
								class="music-range w-full"
								min="0"
								max={Math.max(duration, 0.1)}
								step="0.1"
								value={progressValue}
								style={`--music-progress: ${progressPercent}%`}
								aria-label="播放进度"
								onpointerdown={() => {
									seeking = true;
									seekValue = currentTime;
								}}
								oninput={(event) => {
									seeking = true;
									seekValue = Number(event.currentTarget.value);
								}}
								onchange={(event) => seekTo(Number(event.currentTarget.value))}
							/>
							<div class="mt-1 flex justify-between text-xs tabular-nums text-50">
								<span>{formatTime(progressValue)}</span>
								<span>{formatTime(duration)}</span>
							</div>
						</div>

						<div class="flex flex-wrap items-center gap-2.5">
							<button
								type="button"
								class="music-btn h-10 w-10"
								title={MODE_META[mode].label}
								onclick={cycleMode}
							>
								<Icon icon={MODE_META[mode].icon} />
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
								title={playing ? "暂停" : "播放"}
								onclick={togglePlay}
							>
								{#if pending}
									<Icon icon="svg-spinners:180-ring" />
								{:else}
									<Icon
										icon={playing
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
									title={muted ? "取消静音" : "静音"}
									onclick={() => {
										muted = !muted;
									}}
								>
									<Icon
										icon={muted || volume === 0
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
									value={muted ? 0 : volume}
									style={`--music-progress: ${(muted ? 0 : volume) * 100}%`}
									aria-label="音量"
									oninput={(event) => {
										volume = Number(event.currentTarget.value);
										muted = false;
									}}
								/>
							</div>

							<button
								type="button"
								class="music-btn h-9 gap-1.5 px-3 text-xs font-bold"
								onclick={() => {
									showLyrics = !showLyrics;
								}}
							>
								<Icon icon="material-symbols:lyrics-rounded" />
								<span>{showLyrics ? "收起歌词" : "歌词"}</span>
							</button>
						</div>
					</div>
				</div>

				{#if notice}
					<p class="music-notice">{notice}</p>
				{/if}
			</div>

			{#if showLyrics}
				<div class="relative border-t border-[var(--line-divider)]">
					<div class="h-56 md:h-64">
						<LyricPanel lines={lyrics} currentTime={currentTime} onseek={seekTo} />
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
				<span class="text-xs text-50">{tracks.length} 首</span>
				<a
					class="link ml-auto text-xs font-bold text-[var(--btn-content)]"
					href={`https://music.163.com/#/playlist?id=${activePlaylist?.meta.id ?? ""}`}
					target="_blank"
					rel="noopener noreferrer"
				>
					去网易云看这个歌单
				</a>
			</header>

			{#if tracks.length === 0}
				<p class="px-5 py-10 text-center text-sm text-50">这个歌单里没有能直接播放的歌。</p>
			{:else}
				<ol class="max-h-[30rem] overflow-y-auto py-2">
					{#each tracks as track, index (track.id)}
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
									{#if isCurrent && playing}
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
									{#if trialIds.has(track.id)}
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

			{#if activePlaylist && (activePlaylist.filtered > 0 || activePlaylist.truncated || trialIds.size > 0 || failedNames.length > 0)}
				<footer
					class="border-t border-[var(--line-divider)] px-4 py-3 text-xs leading-relaxed text-50 md:px-5"
				>
					{#if activePlaylist.filteredApplied && activePlaylist.filtered > 0}
						<p>已自动过滤 {activePlaylist.filtered} 首播不了的歌（无版权或需要会员）。</p>
					{/if}
					{#if activePlaylist.truncated}
						<p>歌单太长，这里只取了前面的 {activePlaylist.tracks.length + activePlaylist.filtered} 首。</p>
					{/if}
					{#if trialIds.size > 0}
						<p>
							其中 {trialIds.size} 首是会员曲目，免费账号只能试听 30 秒；给部署环境配好
							<code>NETEASE_COOKIE</code> 后即可完整播放。
						</p>
					{/if}

					{#if failedNames.length > 0}
						<p>没加载出来的歌单：{failedNames.join("、")}</p>
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