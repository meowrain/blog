/**
 * 音乐接口同源代理 —— EdgeOne Makers Cloud Function（Node.js 运行时）
 *
 * 路由由文件路径决定：本文件是 catch-all，对应 `/api/music/*`（生成的路由是
 * `^/api/music/(.*)$`），第二个路径段就是动作名：
 *
 *   GET /api/music/playlist?id=3778678  歌单元信息 + 曲目（已滤掉播不了的）
 *   GET /api/music/song?id=287398       取一首歌的播放地址（地址有时效，随用随取）
 *   GET /api/music/lyric?id=287398      歌词与翻译
 *
 * 为什么要代理：网易云不返回 CORS 头，浏览器直连必失败；由这层转发还能顺手
 * 把上游的 http 播放地址改成 https，否则 https 页面里的 <audio> 会被浏览器
 * 当混合内容拦掉。上游接口与字段的说明都写在 _netease.js 里。
 *
 * 会员 / 私有歌单：把登录后的 Cookie 配到环境变量 NETEASE_COOKIE（控制台配置）。
 * 这里只读环境变量、绝不接受请求方传入的 Cookie，否则这个代理就成了
 * 「谁都能拿你的会员账号听歌」的公共入口。
 */

import {
	API_PREFIX,
	fetchArtistTop,
	fetchCovers,
	fetchLyric,
	fetchPlayability,
	fetchPlaylist,
	fetchSongUrl,
	isAllowedBr,
	lyricSnippet,
	MAX_PLAYLIST_TRACKS,
	searchArtists,
	searchSongs,
} from "../../_netease.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const DEFAULT_BR = 320000;

function json(body, { status = 200, cache = "no-store" } = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...JSON_HEADERS, "cache-control": cache },
	});
}

function fail(message, status) {
	return json({ error: message, status }, { status });
}

/** 只收纯数字 id，顺便挡掉把上游当跳板的长尾参数。 */
function numericId(raw) {
	return typeof raw === "string" && /^\d{1,18}$/.test(raw) ? raw : "";
}

// 歌单数据（含「哪些能播」的探测结果）缓存起来：探测要按每 100 首一批打上游，
// 命中边缘缓存比每次重算划算。配了 Cookie 说明是私有歌单，只能进私有缓存。
function cacheFor(isPrivate) {
	return isPrivate ? "private, max-age=120" : "public, max-age=300, s-maxage=600";
}

/** 只认服务端环境变量里的 Cookie，且压成单行 —— 换行会让上游直接 400。 */
function readCookie(env) {
	const provided = env?.NETEASE_COOKIE ?? env?.neteaseCookie;
	const raw =
		typeof provided === "string" && provided.trim() ? provided : process.env?.NETEASE_COOKIE;
	if (typeof raw !== "string") return "";
	return raw.replace(/[\r\n]+/g, " ").trim();
}

export async function onRequest(context) {
	const { request, env } = context;

	const method = request.method.toUpperCase();
	if (method !== "GET" && method !== "HEAD") {
		return fail("仅支持 GET", 405);
	}

	const url = new URL(request.url);
	const action = url.pathname.slice(API_PREFIX.length).split("/")[0];
	const cookie = readCookie(env);

	switch (action) {
		case "playlist":
			return playlistResponse(url, cookie);
		case "song":
			return songResponse(url, cookie);
		case "lyric":
			return lyricResponse(url, cookie);
		case "search":
			return searchResponse(url, cookie);
		case "artist":
			return artistResponse(url, cookie);
		default:
			return fail("未知的接口动作", 404);
	}
}

async function playlistResponse(url, cookie) {
	const id = numericId(url.searchParams.get("id") ?? "");
	if (!id) return fail("缺少合法的歌单 id", 400);

	try {
		const { meta, tracks } = await fetchPlaylist(id, { cookie });

		// 探测整单可播性；整批探测失败时返回 null，这时不过滤（宁多勿漏）
		const playability = tracks.length
			? await fetchPlayability(
					tracks.map((track) => track.id),
					{ cookie },
				)
			: { playable: new Set(), trial: new Set() };
		const kept = playability
			? tracks.filter((track) => playability.playable.has(track.id))
			: tracks;
		// 能播、但只有 30 秒试听的会员曲目：单独列出来，前端好打标

		return json(
			{
				playlist: meta,
				tracks: kept,
				trialIds: playability
					? kept.filter((track) => playability.trial.has(track.id)).map((track) => track.id)
					: [],
				filtered: tracks.length - kept.length,
				filteredApplied: Boolean(playability),
				truncated: meta.trackCount > tracks.length,
				limit: MAX_PLAYLIST_TRACKS,
			},
			{ cache: cacheFor(Boolean(cookie)) },
		);
	} catch (error) {
		console.error("[music] playlist failed:", id, error?.message ?? error);
		return fail("歌单拉取失败，稍后再试", 502);
	}
}

async function songResponse(url, cookie) {
	const id = numericId(url.searchParams.get("id") ?? "");
	if (!id) return fail("缺少合法的歌曲 id", 400);

	const requested = Number(url.searchParams.get("br") ?? DEFAULT_BR);
	const br = isAllowedBr(requested) ? requested : DEFAULT_BR;

	try {
		const song = await fetchSongUrl(id, { cookie, br });
		if (!song.url) {
			// 用 200 + playable:false 而不是 4xx：前端据此跳过这首，
			// 这不是错误，没必要在控制台刷一堆红字
			return json({ id, playable: false, reason: "unplayable" });
		}
		// 播放地址带时效（约 20 分钟），一律不缓存
		return json({ id, playable: true, ...song });
	} catch (error) {
		console.error("[music] song failed:", id, error?.message ?? error);
		return fail("歌曲地址获取失败", 502);
	}
}

/** 搜索关键词的长度上限——再长的不是搜索，是往上游灌垃圾 */
const MAX_QUERY_CHARS = 60;
/** 一次搜索最多回几首；再多，模型也挑不过来，上游也白打 */
const MAX_SEARCH_LIMIT = 12;
/** 最多给几首抓歌词片段（实测并发 8 首约 2s，取和默认条数同一个上界） */
const MAX_LYRIC_TRACKS = 8;

/**
 * `GET /api/music/search?q=<关键词>&limit=8&lyric=1`
 *
 * 电台选歌用。返回的每一首都**已经探过可播放性**——搜索结果里同名翻唱、
 * 无版权的一大堆（实测「下雨天」12 首只有 2 首能放），不过滤的话模型挑了
 * 五首、访客点下去三首没声音。
 *
 * `lyric=1` 时顺带取每首的开头几行歌词，给模型写串词用；模型没听过歌，
 * 只给歌名它只能写空话。
 */
async function searchResponse(url, cookie) {
	const query = (url.searchParams.get("q") ?? "").trim();
	if (!query) return fail("缺少搜索关键词 q", 400);
	if (query.length > MAX_QUERY_CHARS) return fail("搜索关键词过长", 400);

	const requested = Number(url.searchParams.get("limit") ?? 8);
	const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.trunc(requested), MAX_SEARCH_LIMIT) : 8;
	const wantLyric = url.searchParams.get("lyric") === "1";

	try {
		// 多取一点再过滤：搜索结果的「能播率」因关键词而异，恰好取 limit 条会剩太少
		const found = await searchSongs(query, { limit: Math.min(limit * 2, 24), cookie });
		if (!found.length) return json({ query, count: 0, results: [] }, { cache: "public, max-age=180" });

		const playability = await fetchPlayability(
			found.map((track) => track.id),
			{ cookie },
		);
		// 探测整体失败时不过滤，宁多勿漏（和歌单那边同一套取舍）
		const kept = (playability ? found.filter((track) => playability.playable.has(track.id)) : found).slice(
			0,
			limit,
		);

		const covers = await fetchCovers(
			kept.map((track) => track.id),
			{ cookie },
		).catch(() => new Map());

		const lyricTargets = wantLyric ? kept.slice(0, MAX_LYRIC_TRACKS) : [];
		const lyrics = await Promise.all(
			lyricTargets.map((track) =>
				fetchLyric(track.id, { cookie })
					.then((data) => lyricSnippet(data.lyric))
					.catch(() => ""),
			),
		);
		const lyricMap = new Map(lyricTargets.map((track, index) => [track.id, lyrics[index] ?? ""]));

		// 只是「同名不同版」时（「下雨天」有七八个翻唱），歌词一模一样，挑不出该放哪个。
		// 标出来让模型优先选有原唱味道、或者干脆按歌手名和访客的说法对得上的那首。
		const sameName = new Map();
		for (const track of kept) sameName.set(track.name, (sameName.get(track.name) ?? 0) + 1);

		return json(
			{
				query,
				count: kept.length,
				// 上游搜到多少、滤掉多少，让调用方能判断是不是关键词太泛
				found: found.length,
				results: kept.map((track) => ({
					id: track.id,
					name: track.name,
					artists: track.artists,
					album: track.album,
					duration: track.duration,
					cover: covers.get(track.id) ?? track.cover,
					...(playability?.trial.has(track.id) ? { trial: true } : {}),
					...(lyricMap.get(track.id) ? { lyric: lyricMap.get(track.id) } : {}),
					...((sameName.get(track.name) ?? 0) > 1 ? { sameName: true } : {}),
				})),
			},
			{ cache: "public, max-age=180" },
		);
	} catch (error) {
		console.error("[music] search failed:", query, error?.message ?? error);
		return fail("搜索失败，稍后再试", 502);
	}
}

/**
 * `GET /api/music/artist?id=<歌手 id>` 或 `?q=<歌手名>&limit=8`
 *
 * 给模型一条「搜不到歌就换人」的路：按歌手取热门 50 首，可播放率实测明显高于
 * 关键词搜索（花粥前 20 首里 19 首能放）。`q` 形式会先 type=100 找歌手。
 */
async function artistResponse(url, cookie) {
	const id = numericId(url.searchParams.get("id") ?? "");
	const query = (url.searchParams.get("q") ?? "").trim();

	const requested = Number(url.searchParams.get("limit") ?? 10);
	const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.trunc(requested), MAX_SEARCH_LIMIT) : 10;

	try {
		let artistId = id;
		let artistName = "";
		let artistPic = "";
		if (!artistId) {
			if (!query) return fail("缺少歌手 id 或名字 q", 400);
			if (query.length > MAX_QUERY_CHARS) return fail("歌手名过长", 400);
			const [hit] = await searchArtists(query, { limit: 1, cookie });
			if (!hit) return json({ query, artist: null, count: 0, results: [] }, { cache: "public, max-age=180" });
			artistId = hit.id;
			artistName = hit.name;
			artistPic = hit.pic;
		}

		const top = await fetchArtistTop(artistId, { cookie });
		const playability = await fetchPlayability(
			top.map((track) => track.id),
			{ cookie },
		);
		const kept = (playability ? top.filter((track) => playability.playable.has(track.id)) : top).slice(0, limit);

		return json(
			{
				...(query ? { query } : {}),
				artist: { id: artistId, name: artistName, pic: artistPic },
				count: kept.length,
				found: top.length,
				results: kept.map((track) => ({
					id: track.id,
					name: track.name,
					artists: track.artists,
					album: track.album,
					duration: track.duration,
					cover: track.cover,
					...(playability?.trial.has(track.id) ? { trial: true } : {}),
				})),
			},
			{ cache: "public, max-age=300" },
		);
	} catch (error) {
		console.error("[music] artist failed:", id || query, error?.message ?? error);
		return fail("歌手查询失败，稍后再试", 502);
	}
}

async function lyricResponse(url, cookie) {
	const id = numericId(url.searchParams.get("id") ?? "");
	if (!id) return fail("缺少合法的歌曲 id", 400);

	try {
		const lyric = await fetchLyric(id, { cookie });
		return json({ id, ...lyric }, { cache: "public, max-age=86400" });
	} catch (error) {
		console.error("[music] lyric failed:", id, error?.message ?? error);
		return fail("歌词获取失败", 502);
	}
}