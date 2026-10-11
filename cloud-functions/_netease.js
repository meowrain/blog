/**
 * 网易云音乐数据客户端 —— EdgeOne 云函数与本地开发中间件共用
 *
 * 站点是纯静态产物（astro output: "static"），浏览器不能直接打网易云的接口：
 * 上游不给 CORS，不带 Referer / Cookie 还会被风控拦掉。所以浏览器只跟同源的
 * /api/music/* 说话，真正的上游请求都在这一层发出去。
 *
 * 这里只走 legacy 的 /api/ 系列（不是 /weapi/）：不需要 weapi 那套 AES + RSA
 * 加密，实测 api/v6/playlist/detail、api/song/enhance/player/url、api/song/lyric
 * 带上 UA / Referer 就能拿到数据。这些是网易云自家的老接口，随时可能变，
 * 真变了只需要改这一个文件。
 *
 * Cookie 只从服务端环境变量读（NETEASE_COOKIE），绝不由请求方传入 ——
 * 否则这个代理就成了「谁都能拿会员账号听歌」的公共入口。
 */

const API_ORIGIN = "https://music.163.com";

/** 单次请求上游的超时时间。超时宁可报错，也不让浏览器那边一直挂着。 */
const TIMEOUT_MS = 8000;

/** 批量探歌曲地址时每批的 id 数：再长上游会嫌 URL 太长。 */
const URL_BATCH_SIZE = 100;

/** 歌单详情一次最多给 1000 首，超出的部分要按 trackIds 再补一次。 */
const DETAIL_BATCH_SIZE = 200;

/** 单个歌单最多取回多少首。探可用性要对每首发一次批量查询，得有上界。 */
const MAX_TRACKS = 2000;

/** 允许的码率，避免这个接口被当成任意参数转发器。 */
const ALLOWED_BR = new Set([128000, 192000, 320000, 999000]);

const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// appver / os 让上游按桌面客户端的口径返回数据（带 fee、带版权字段）
const BASE_COOKIE = "appver=9.1.0; os=pc";

export const API_PREFIX = "/api/music/";
export const MAX_PLAYLIST_TRACKS = MAX_TRACKS;

export function isAllowedBr(value) {
	return ALLOWED_BR.has(value);
}

/** 上游返回 http://mXXX.music.126.net/...，站点走 https，混进去会被浏览器当混合内容拦掉。 */
export function toHttps(url) {
	return typeof url === "string" ? url.replace(/^http:\/\//, "https://") : "";
}

function buildHeaders(cookie) {
	return {
		"User-Agent": USER_AGENT,
		Referer: "https://music.163.com/",
		Accept: "application/json, text/plain, */*",
		"Accept-Language": "zh-CN,zh;q=0.9",
		Cookie: cookie ? `${BASE_COOKIE}; ${cookie}` : BASE_COOKIE,
	};
}

async function requestJson(path, params, { cookie = "", timeoutMs = TIMEOUT_MS } = {}) {
	const url = new URL(path, API_ORIGIN);
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null || value === "") continue;
		url.searchParams.set(key, String(value));
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, {
			headers: buildHeaders(cookie),
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`upstream ${path} -> HTTP ${response.status}`);
		}
		return await response.json();
	} finally {
		clearTimeout(timer);
	}
}
function text(value, max = 200) {
	return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeTrack(track) {
	// 歌单详情里的字段是缩写（ar / al / dt），单曲接口里是全称，两种都兜一下
	const album = track.al ?? track.album ?? {};
	const artists = track.ar ?? track.artists ?? [];
	return {
		id: String(track.id ?? ""),
		name: text(track.name, 120),
		artists:
			artists
				.map((artist) => text(artist?.name, 60))
				.filter(Boolean)
				.join(" / ") || "未知歌手",
		album: text(album.name, 120),
		cover: toHttps(album.picUrl ?? ""),
		duration: Number(track.dt ?? track.duration ?? 0) || 0,
	};
}
/**
 * 按 id 批量补歌单里拿不到的那部分（歌单详情只给前 1000 首）。
 * 无版权 / 下架的曲子上游只会回一个空壳（没有歌手、没有专辑），先照收，
 * 后面统一按「有没有播放地址」滤掉。某一批失败就停手，能补多少算多少。
 */
async function fetchTrackDetails(ids, cookie) {
	const collected = [];
	for (let i = 0; i < ids.length; i += DETAIL_BATCH_SIZE) {
		const batch = ids.slice(i, i + DETAIL_BATCH_SIZE);
		try {
			const data = await requestJson(
				"/api/v3/song/detail",
				{ c: JSON.stringify(batch.map((id) => ({ id: Number(id) }))) },
				{ cookie },
			);
			for (const song of data?.songs ?? []) {
				const track = normalizeTrack(song);
				if (track.id) collected.push(track);
			}
		} catch {
			break;
		}
	}
	return collected;
}

export async function fetchPlaylist(id, { cookie = "" } = {}) {
	const data = await requestJson(
		"/api/v6/playlist/detail",
		{ id, n: MAX_TRACKS, s: 8 },
		{ cookie },
	);

	const playlist = data?.playlist;
	if (!playlist || !Array.isArray(playlist.tracks)) {
		throw new Error("上游没有返回歌单内容");
	}

	const tracks = playlist.tracks.map(normalizeTrack).filter((t) => t.id && t.name);

	// 大歌单（比如「我喜欢的音乐」上千首）详情里只回前 1000 首，
	// 剩下的按 trackIds 的顺序补回来，整体顺序保持不变。
	const trackIds = Array.isArray(playlist.trackIds)
		? playlist.trackIds.map((item) => String(item?.id ?? item)).filter(Boolean)
		: [];
	if (trackIds.length > tracks.length && tracks.length < MAX_TRACKS) {
		const loaded = new Set(tracks.map((track) => track.id));
		const missing = trackIds
			.filter((id) => !loaded.has(id))
			.slice(0, MAX_TRACKS - tracks.length);
		tracks.push(...(await fetchTrackDetails(missing, cookie)));
	}

	return {
		meta: {
			id: String(playlist.id ?? id),
			name: text(playlist.name, 80) || "未命名歌单",
			cover: toHttps(playlist.coverImgUrl ?? ""),
			description: text(playlist.description, 200),
			trackCount: Number(playlist.trackCount ?? tracks.length) || tracks.length,
			creator: text(playlist.creator?.nickname, 40),
		},
		tracks,
	};
}

/**
 * 批量探一次「哪些歌能放、哪些只能试听」。
 *
 * 歌单里混着无版权 / 只有会员能听的歌，直接排进播放列表会播到一半卡住，
 * 所以先探测再筛掉。免费账号碰上的会员曲目只能放 30 秒试听片段（上游用
 * freeTrialInfo 标记），能播但只剩个开头 —— 界面要标出来，不然看着像卡住了。
 *
 * 返回 null 表示这批探测整体失败：调用方应当放弃过滤
 * （宁多勿漏 —— 过滤只是锦上添花，不能因为它挂了就把能听的歌一起藏起来）。
 */
export async function fetchPlayability(ids, { cookie = "" } = {}) {
	const batches = [];
	for (let i = 0; i < ids.length; i += URL_BATCH_SIZE) {
		batches.push(ids.slice(i, i + URL_BATCH_SIZE));
	}
	if (batches.length === 0) return new Set();

	const results = await Promise.allSettled(
		batches.map((batch) =>
			requestJson(
				"/api/song/enhance/player/url",
				{ ids: JSON.stringify(batch.map(Number)), br: 320000 },
				{ cookie },
			),
		),
	);
	if (results.some((result) => result.status === "rejected")) {
		return null;
	}

	const playable = new Set();
	const trial = new Set();
	for (const result of results) {
		for (const item of result.value?.data ?? []) {
			if (!item?.url) continue;
			const id = String(item.id);
			playable.add(id);
			// 会员曲目在免费账号下只拿到 30 秒试听片段，上游用 freeTrialInfo 标出来
			if (item.freeTrialInfo) trial.add(id);
		}
	}
	return { playable, trial };
}

export async function fetchSongUrl(id, { cookie = "", br = 320000 } = {}) {
	const data = await requestJson(
		"/api/song/enhance/player/url",
		{ ids: JSON.stringify([Number(id)]), br },
		{ cookie },
	);

	const item = data?.data?.[0];
	if (!item) return { url: "" };

	return {
		url: toHttps(item.url),
		br: Number(item.br) || 0,
		size: Number(item.size) || 0,
		type: text(item.type, 10),
		level: text(item.level, 20),
		fee: Number(item.fee) || 0,
		trial: Boolean(item.freeTrialInfo),
	};
}

export async function fetchLyric(id, { cookie = "" } = {}) {
	const data = await requestJson(
		"/api/song/lyric",
		{ id, lv: -1, kv: -1, tv: -1 },
		{ cookie },
	);
	return {
		lyric: typeof data?.lrc?.lyric === "string" ? data.lrc.lyric : "",
		tlyric: typeof data?.tlyric?.lyric === "string" ? data.tlyric.lyric : "",
	};
}