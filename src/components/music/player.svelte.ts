/// <reference types="svelte" />

/**
 * 全站唯一的音乐播放状态。
 *
 * <audio> 由 Layout 里的 MusicPlayerHost 持有（在 Swup 容器之外，换页不销毁），
 * /music/ 页面的 MusicPlayer 只是读取这里的歌单 / 进度并触发动作，
 * 所以从 /music/ 切到任何文章页，音乐都不会停。
 */

import type { LyricLine } from "./lrc";
import { parseLrc } from "./lrc";

export type PlaylistRef = { id: string; name?: string };

export type Track = {
	id: string;
	name: string;
	artists: string;
	album: string;
	cover: string;
	duration: number;
};

export type PlaylistMeta = {
	id: string;
	name: string;
	cover: string;
	description: string;
	trackCount: number;
	creator: string;
};

export type LoadedPlaylist = {
	ref: PlaylistRef;
	meta: PlaylistMeta;
	tracks: Track[];
	trialIds: string[];
	filtered: number;
	filteredApplied: boolean;
	truncated: boolean;
};

export type Mode = "list" | "single" | "shuffle";

export interface PlayerState {
	apiBase: string;
	playlists: PlaylistRef[];
	library: LoadedPlaylist[];
	activeId: string;
	loading: boolean;
	loadError: string;
	failedNames: string[];
	currentIndex: number;
	playing: boolean;
	pending: boolean;
	currentTime: number;
	liveDuration: number;
	volume: number;
	muted: boolean;
	mode: Mode;
	seeking: boolean;
	seekValue: number;
	showLyrics: boolean;
	lyric: string;
	tlyric: string;
	deadTracks: string[];
	notice: string;
}

export const STORAGE = {
	volume: "music:volume",
	mode: "music:mode",
	playlist: "music:playlist",
	track: "music:track",
};

export const MODES: Mode[] = ["list", "single", "shuffle"];

export const MODE_META: Record<Mode, { icon: string; label: string }> = {
	list: { icon: "material-symbols:repeat-rounded", label: "列表循环" },
	single: { icon: "material-symbols:repeat-one-rounded", label: "单曲循环" },
	shuffle: { icon: "material-symbols:shuffle-rounded", label: "随机播放" },
};

function storage(): Storage | null {
	return typeof localStorage === "undefined" ? null : localStorage;
}

function readVolume(fallback: number): number {
	// getItem 没存过时返回 null，而 Number(null) === 0 —— 不挡住就会把「没存过」
	// 当成「音量为 0」，于是一进页面就是静音。
	const stored = storage()?.getItem(STORAGE.volume);
	if (stored === null || stored === undefined || stored === "") return fallback;
	const raw = Number(stored);
	return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : fallback;
}

function readMode(): Mode {
	const raw = storage()?.getItem(STORAGE.mode) as Mode | null;
	return raw && MODES.includes(raw) ? raw : "list";
}

export const player: PlayerState = $state({
	apiBase: "/api/music",
	playlists: [],
	library: [],
	activeId: "",
	loading: true,
	loadError: "",
	failedNames: [],
	currentIndex: -1,
	playing: false,
	pending: false,
	currentTime: 0,
	liveDuration: 0,
	volume: readVolume(0.7),
	muted: false,
	mode: readMode(),
	seeking: false,
	seekValue: 0,
	showLyrics: false,
	lyric: "",
	tlyric: "",
	deadTracks: [],
	notice: "",
});

let audio: HTMLAudioElement | undefined;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let loadStarted = false;
let configReady = false;
let pendingEnsure = false;

export function configure(apiBase: string, playlists: PlaylistRef[]): void {
	player.apiBase = apiBase;
	player.playlists = playlists;
	configReady = true;
	if (pendingEnsure) {
		pendingEnsure = false;
		void ensureLibrary();
	}
}

/** 按需加载：只有进过 /music/ 才拉歌单，普通文章页不白跑请求 */
export function ensureLibrary(): Promise<void> {
	if (!configReady) {
		pendingEnsure = true;
		return Promise.resolve();
	}
	if (loadStarted) return Promise.resolve();
	loadStarted = true;
	return loadLibrary();
}

export function attachAudio(element: HTMLAudioElement): void {
	audio = element;
	audio.volume = player.muted ? 0 : player.volume;
}

export function detachAudio(): void {
	// 只解除引用，绝不暂停：组件销毁正是换页的时候，停了就听不成了
	audio = undefined;
}

export function activePlaylist(): LoadedPlaylist | null {
	return player.library.find((item) => item.ref.id === player.activeId) ?? null;
}

export function tracks(): Track[] {
	return activePlaylist()?.tracks ?? [];
}

export function trialIds(): Set<string> {
	return new Set(activePlaylist()?.trialIds ?? []);
}

export function currentTrack(): Track | null {
	const list = tracks();
	return player.currentIndex >= 0 ? (list[player.currentIndex] ?? null) : null;
}

export function duration(): number {
	return player.liveDuration || (currentTrack()?.duration ?? 0) / 1000;
}

export function lyrics(): LyricLine[] {
	return parseLrc(player.lyric, player.tlyric);
}

export function progressValue(): number {
	return player.seeking ? player.seekValue : player.currentTime;
}

export function progressPercent(): number {
	const total = duration();
	return total > 0 ? (progressValue() / total) * 100 : 0;
}

export function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return "00:00";
	const total = Math.floor(seconds);
	const minutes = String(Math.floor(total / 60)).padStart(2, "0");
	return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

export function showNotice(message: string): void {
	player.notice = message;
	clearTimeout(noticeTimer);
	noticeTimer = setTimeout(() => {
		player.notice = "";
	}, 4000);
}

export async function loadLibrary(): Promise<void> {
	player.loading = true;
	player.loadError = "";

	const results = await Promise.allSettled(
		player.playlists.map(async (ref): Promise<LoadedPlaylist> => {
			const response = await fetch(
				`${player.apiBase}/playlist/?id=${encodeURIComponent(ref.id)}`,
			);
			const data = await response.json().catch(() => null);
			if (!response.ok)
				throw new Error(data?.error ?? `HTTP ${response.status}`);
			return {
				ref: {
					id: String(data.playlist.id),
					name: ref.name || data.playlist.name,
				},
				meta: data.playlist as PlaylistMeta,
				tracks: (data.tracks ?? []) as Track[],
				trialIds: (data.trialIds ?? []) as string[],
				filtered: Number(data.filtered ?? 0),
				filteredApplied: Boolean(data.filteredApplied),
				truncated: Boolean(data.truncated),
			};
		}),
	);

	player.library = results.flatMap((result) =>
		result.status === "fulfilled" ? [result.value] : [],
	);
	player.failedNames = player.playlists.flatMap((ref, index) =>
		results[index].status === "rejected" ? [ref.name || ref.id] : [],
	);
	player.loading = false;

	if (player.library.length === 0) {
		player.loadError = "歌单没能加载出来，多半是上游接口抽风了。";
		return;
	}
	restoreSession();
}

function restoreSession(): void {
	const saved = storage()?.getItem(STORAGE.playlist);
	const target =
		player.library.find((item) => item.ref.id === saved) ?? player.library[0];
	player.activeId = target.ref.id;

	// 恢复上次听的歌，但绝不自作主张播放：浏览器会拦带声音的自动播放，
	// 而且刚进页面就被塞一耳朵也不是什么好体验。
	const savedTrack = storage()?.getItem(STORAGE.track);
	const index = target.tracks.findIndex((track) => track.id === savedTrack);
	player.currentIndex = index >= 0 ? index : target.tracks.length > 0 ? 0 : -1;
	if (player.currentIndex >= 0) void prepareTrack(player.currentIndex, false);
}

export async function prepareTrack(
	index: number,
	autoplay: boolean,
	depth = 0,
): Promise<void> {
	const track = tracks()[index];
	if (!track) return;

	player.currentIndex = index;
	player.pending = true;
	storage()?.setItem(STORAGE.track, track.id);
	if (autoplay) {
		player.currentTime = 0;
		player.liveDuration = 0;
	}

	try {
		const response = await fetch(
			`${player.apiBase}/song/?id=${encodeURIComponent(track.id)}`,
		);
		const data = await response.json().catch(() => null);
		if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);

		if (!data?.playable || !data.url) {
			markDead(track, depth);
			return;
		}

		if (audio) {
			audio.src = data.url;
			audio.volume = player.muted ? 0 : player.volume;
		}
		void loadLyric(track.id);

		// 免费账号下的会员曲目只有 30 秒试听，不说明白会以为播放器坏了
		if (data.trial) {
			showNotice(`《${track.name}》是会员曲目，只能试听 30 秒`);
		}
		updateMediaSession(track);

		if (!autoplay || !audio) {
			player.playing = false;
			return;
		}
		try {
			await audio.play();
		} catch {
			player.playing = false;
			showNotice("浏览器拦住了自动播放，点一下播放键继续");
		}
	} catch (error) {
		showNotice(
			`这首歌没取到播放地址：${error instanceof Error ? error.message : "未知错误"}`,
		);
	} finally {
		player.pending = false;
	}
}

// 歌单可用性在拉取时已经探过一轮，但播放地址会过期、会员状态也会变，
// 真播不出来就把这首标记掉并顺着往下跳；depth 保证最多跳完一整圈就停手。
function markDead(track: Track, depth: number): void {
	if (!player.deadTracks.includes(track.id)) {
		player.deadTracks = [...player.deadTracks, track.id];
	}
	showNotice(`《${track.name}》暂时放不了，已跳过`);
	player.pending = false;
	if (depth + 1 < tracks().length) advance(1, depth + 1);
}

export function advance(step: 1 | -1, depth = 0): void {
	const list = tracks();
	if (list.length === 0) return;

	if (player.mode === "shuffle" && list.length > 1) {
		let index = player.currentIndex;
		for (let i = 0; i < 12 && index === player.currentIndex; i++) {
			index = Math.floor(Math.random() * list.length);
		}
		void prepareTrack(index, true, depth);
		return;
	}

	let index = player.currentIndex;
	for (let i = 0; i < list.length; i++) {
		index = (index + step + list.length) % list.length;
		if (!player.deadTracks.includes(list[index]?.id ?? "")) break;
	}
	void prepareTrack(index, true, depth);
}

export function togglePlay(): void {
	if (player.currentIndex < 0 && tracks().length > 0) {
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

export function handleEnded(): void {
	if (player.mode === "single") {
		seekTo(0);
		void audio?.play();
		return;
	}
	advance(1);
}

export function seekTo(time: number): void {
	player.seekValue = time;
	player.seeking = false;
	player.currentTime = time;
	if (audio && Number.isFinite(audio.duration)) audio.currentTime = time;
}

export function seekBy(delta: number): void {
	const base = audio?.currentTime ?? player.currentTime;
	seekTo(Math.max(0, Math.min(duration() || 0, base + delta)));
}

export function cycleMode(): void {
	player.mode = MODES[(MODES.indexOf(player.mode) + 1) % MODES.length];
	storage()?.setItem(STORAGE.mode, player.mode);
}

export function setVolume(value: number): void {
	player.volume = value;
	player.muted = false;
	storage()?.setItem(STORAGE.volume, String(value));
}

export function toggleMute(): void {
	player.muted = !player.muted;
}

export function toggleLyrics(): void {
	player.showLyrics = !player.showLyrics;
}

export function switchPlaylist(id: string): void {
	if (id === player.activeId) return;
	const target = player.library.find((item) => item.ref.id === id);
	if (!target) return;

	audio?.pause();
	player.activeId = id;
	storage()?.setItem(STORAGE.playlist, id);
	player.lyric = "";
	player.tlyric = "";
	// 换歌单先把上一首松开，免得它还挂在 audio 上
	audio?.removeAttribute("src");
	player.currentIndex = target.tracks.length > 0 ? 0 : -1;
	player.currentTime = 0;
	player.liveDuration = 0;
	if (player.currentIndex >= 0) void prepareTrack(player.currentIndex, false);
}

async function loadLyric(id: string): Promise<void> {
	player.lyric = "";
	player.tlyric = "";
	try {
		const response = await fetch(
			`${player.apiBase}/lyric/?id=${encodeURIComponent(id)}`,
		);
		if (!response.ok) return;
		const data = await response.json();
		// 切歌够快时晚到的响应不能盖掉新歌的歌词
		if (tracks()[player.currentIndex]?.id !== id) return;
		player.lyric = data.lyric ?? "";
		player.tlyric = data.tlyric ?? "";
	} catch {
		// 歌词拿不到就不显示，别因此打扰正在播的歌
	}
}

function updateMediaSession(track: Track): void {
	if (typeof navigator === "undefined" || !("mediaSession" in navigator))
		return;
	navigator.mediaSession.metadata = new MediaMetadata({
		title: track.name,
		artist: track.artists,
		album: track.album || activePlaylist()?.meta.name || "",
		artwork: track.cover ? [{ src: track.cover, sizes: "500x500" }] : [],
	});
}
