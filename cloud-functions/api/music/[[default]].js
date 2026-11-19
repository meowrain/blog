/**
 * 音乐接口同源代理 —— EdgeOne Makers Cloud Function（Node.js 运行时）
 *
 * 路由由文件路径决定：本文件是 catch-all，对应 `/api/music/*`（生成的路由是
 * `^/api/music/(.*)$`），第二个路径段就是动作名：
 *
 *   GET /api/music/playlist?id=3778678  歌单元信息 + 曲目（已滤掉播不了的）
 *   GET /api/music/song?id=287398       取一首歌的播放地址（地址有时效，随用随取）
 *   GET /api/music/lyric?id=287398      歌词与翻译
 *   GET /api/music/search?q=出山&source=netease|qq|all
 *   GET /api/music/artist?id=6452|q=花粥&source=...
 *
 * 两个曲库：网易云（默认）和 QQ 音乐（`source=qq`，歌词/播放地址也认）。两家
 * 的免费曲库不重合，电台要「网易云空了问 QQ」才能覆盖得住，见 _qqmusic.js 顶部。
 * 曲目 id 各自在自己的上游里有效，所以响应里都带 `source`，调用方原样带回来。
 *
 * 为什么要代理：网易云不返回 CORS 头，浏览器直连必失败；由这层转发还能顺手
 * 把上游的 http 播放地址改成 https，否则 https 页面里的 <audio> 会被浏览器
 * 当混合内容拦掉。上游接口与字段的说明都写在 _netease.js / _qqmusic.js 里。
 *
 * 会员 / 私有歌单：把登录后的 Cookie 配到环境变量 NETEASE_COOKIE（控制台配置）。
 * 这里只读环境变量、绝不接受请求方传入的 Cookie，否则这个代理就成了
 * 「谁都能拿你的会员账号听歌」的公共入口。QQ 那边不登录、不读 Cookie。
 */

import {
	API_PREFIX,
	MAX_PLAYLIST_TRACKS,
	fetchArtistTop,
	fetchCovers,
	fetchLyric,
	fetchPlayability,
	fetchPlaylist,
	fetchSongUrl,
	isAllowedBr,
	lyricSnippet,
	searchArtists,
	searchSongs,
} from "../../_netease.js";
import {
	isSongMid,
	artistSongs as qqArtistSongs,
	fetchLyric as qqFetchLyric,
	fetchSongUrl as qqFetchSongUrl,
	probePlayable as qqProbePlayable,
	searchSongs as qqSearchSongs,
} from "../../_qqmusic.js";

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

/**
 * 曲库参数。不传就是网易云（站内播放器、老调用方都是这个口径），
 * `source=qq` 才走 QQ 音乐，`source=all` 用于搜索的两个源合并。
 */
const SOURCES = new Set(["netease", "qq", "all"]);

function readSource(url) {
	const raw = (url.searchParams.get("source") ?? "").trim().toLowerCase();
	return SOURCES.has(raw) ? raw : "netease";
}

/**
 * 播放 / 歌词的 id：网易云是纯数字，QQ 是 base62 的 songmid。
 * 两种形状不重叠，所以能按形状分流；显式带 source 时以它为准。
 *
 * 不带 source 时按形状认 —— 播放器只存了 id，没存来源，老调用方也不传这个参数。
 */
function readTrackRef(url) {
	const raw = (url.searchParams.get("id") ?? "").trim();
	const explicit = (url.searchParams.get("source") ?? "").trim().toLowerCase();
	if (explicit === "qq")
		return isSongMid(raw) ? { source: "qq", id: raw } : null;
	if (explicit === "netease")
		return numericId(raw) ? { source: "netease", id: raw } : null;
	// 未指定（或 all）：按形状认，认不出来直接拒绝，别拿上游当跳板
	if (numericId(raw)) return { source: "netease", id: raw };
	if (isSongMid(raw)) return { source: "qq", id: raw };
	return null;
}

// 歌单数据（含「哪些能播」的探测结果）缓存起来：探测要按每 100 首一批打上游，
// 命中边缘缓存比每次重算划算。配了 Cookie 说明是私有歌单，只能进私有缓存。
function cacheFor(isPrivate) {
	return isPrivate
		? "private, max-age=120"
		: "public, max-age=300, s-maxage=600";
}

/** 只认服务端环境变量里的 Cookie，且压成单行 —— 换行会让上游直接 400。 */
function readCookie(env) {
	const provided = env?.NETEASE_COOKIE ?? env?.neteaseCookie;
	const raw =
		typeof provided === "string" && provided.trim()
			? provided
			: process.env?.NETEASE_COOKIE;
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
					? kept
							.filter((track) => playability.trial.has(track.id))
							.map((track) => track.id)
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
	const ref = readTrackRef(url);
	if (!ref) return fail("缺少合法的歌曲 id", 400);

	const requested = Number(url.searchParams.get("br") ?? DEFAULT_BR);
	const br = isAllowedBr(requested) ? requested : DEFAULT_BR;

	try {
		const song =
			ref.source === "qq"
				? await qqFetchSongUrl(ref.id)
				: await fetchSongUrl(ref.id, { cookie, br });
		if (!song.url) {
			// 用 200 + playable:false 而不是 4xx：前端据此跳过这首，
			// 这不是错误，没必要在控制台刷一堆红字
			return json({
				id: ref.id,
				source: ref.source,
				playable: false,
				reason: "unplayable",
			});
		}
		// 播放地址带时效（网易云约 20 分钟、QQ 约 2 小时），一律不缓存
		return json({ id: ref.id, source: ref.source, playable: true, ...song });
	} catch (error) {
		console.error(
			"[music] song failed:",
			ref.source,
			ref.id,
			error?.message ?? error,
		);
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
 * 搜索结果里「同名不同版」的标记：`下雨天` 有七八个翻唱，歌词一模一样，
 * 挑不出该放哪个。标出来让模型优先选原唱、或者干脆按歌手名和访客的说法对得上的那首。
 */
function markSameName(tracks) {
	const counts = new Map();
	for (const track of tracks)
		counts.set(track.name, (counts.get(track.name) ?? 0) + 1);
	return tracks.map((track) => ({
		id: track.id,
		name: track.name,
		artists: track.artists,
		album: track.album,
		duration: track.duration,
		cover: track.cover,
		source: track.source ?? "netease",
		...(track.trial ? { trial: true } : {}),
		...(track.lyric ? { lyric: track.lyric } : {}),
		...((counts.get(track.name) ?? 0) > 1 ? { sameName: true } : {}),
	}));
}

/**
 * 网易云的搜索：探可播性、补封面、取歌词片段，返回与 QQ 同形状的曲目。
 * 探测整体失败时不过滤（宁多勿漏，和歌单那边同一套取舍）。
 */
async function searchNetease(query, { limit, wantLyric, cookie }) {
	// 多取一点再过滤：搜索结果的「能播率」因关键词而异，恰好取 limit 条会剩太少
	const found = await searchSongs(query, {
		limit: Math.min(limit * 2, 24),
		cookie,
	});
	if (!found.length) return { found: 0, tracks: [] };

	const playability = await fetchPlayability(
		found.map((track) => track.id),
		{ cookie },
	);
	const kept = (
		playability
			? found.filter((track) => playability.playable.has(track.id))
			: found
	).slice(0, limit);

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
	const lyricMap = new Map(
		lyricTargets.map((track, index) => [track.id, lyrics[index] ?? ""]),
	);

	return {
		found: found.length,
		tracks: kept.map((track) => ({
			...track,
			cover: covers.get(track.id) ?? track.cover,
			source: "netease",
			...(playability?.trial.has(track.id) ? { trial: true } : {}),
			...(lyricMap.get(track.id) ? { lyric: lyricMap.get(track.id) } : {}),
		})),
	};
}

/**
 * QQ 音乐的搜索：先探可播性（QQ 不返回试听态，能放就是整首），再按需取歌词片段。
 * 探测失败同样不过滤。
 */
async function searchQq(query, { limit, wantLyric }) {
	const found = await qqSearchSongs(query, { limit: Math.max(limit * 2, 12) });
	if (!found.length) return { found: 0, tracks: [] };

	let playable;
	try {
		playable = await qqProbePlayable(found.map((track) => track.id));
	} catch {
		playable = null;
	}
	const kept = (
		playable ? found.filter((track) => playable.has(track.id)) : found
	).slice(0, limit);

	const lyricTargets = wantLyric ? kept.slice(0, MAX_LYRIC_TRACKS) : [];
	const lyrics = await Promise.all(
		lyricTargets.map((track) =>
			qqFetchLyric(track.id)
				.then((data) => lyricSnippet(data.lyric))
				.catch(() => ""),
		),
	);
	const lyricMap = new Map(
		lyricTargets.map((track, index) => [track.id, lyrics[index] ?? ""]),
	);

	return {
		found: found.length,
		tracks: kept.map((track) => ({
			...track,
			...(lyricMap.get(track.id) ? { lyric: lyricMap.get(track.id) } : {}),
		})),
	};
}

/**
 * 两个源合并：网易云在前，QQ 补它没覆盖到的，按「歌名 + 歌手」去重。
 *
 * 只按歌名去重不够 —— 同一首《晴天》可能有七八个翻唱版本，跨源撞名时
 * 硬合并会把两边真正的不同版本也吞掉。歌手串也拆开比，顺序和分隔符不稳定。
 */
function mergeSources(groups, limit) {
	const seen = new Set();
	const merged = [];
	for (const track of groups) {
		const key = `${track.name}|${track.artists
			.split(/[/、,&]/)
			.map((name) => name.trim().toLowerCase())
			.sort()
			.join(",")}`;
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(track);
		if (merged.length >= limit) break;
	}
	return merged;
}

/**
 * `GET /api/music/search?q=<关键词>&limit=8&lyric=1&source=netease|qq|all`
 *
 * 电台选歌用。返回的每一首都**已经探过可播放性**——搜索结果里同名翻唱、
 * 无版权的一大堆（实测「下雨天」12 首只有 2 首能放），不过滤的话模型挑了
 * 五首、访客点下去三首没声音。
 *
 * `lyric=1` 时顺带取每首的开头几行歌词，给模型写串词用；模型没听过歌，
 * 只给歌名它只能写空话。
 *
 * `source=all` 会把网易云和 QQ 都问一遍再合并（见 mergeSources）：默认行为
 * 保持只问网易云，站内播放器不因为这个参数多打一次上游。
 */
async function searchResponse(url, cookie) {
	const query = (url.searchParams.get("q") ?? "").trim();
	if (!query) return fail("缺少搜索关键词 q", 400);
	if (query.length > MAX_QUERY_CHARS) return fail("搜索关键词过长", 400);

	const requested = Number(url.searchParams.get("limit") ?? 8);
	const limit =
		Number.isFinite(requested) && requested > 0
			? Math.min(Math.trunc(requested), MAX_SEARCH_LIMIT)
			: 8;
	const wantLyric = url.searchParams.get("lyric") === "1";
	const source = readSource(url);

	try {
		const [netease, qq] = await Promise.all([
			source === "qq"
				? null
				: searchNetease(query, { limit, wantLyric, cookie }).catch(() => null),
			source === "netease"
				? null
				: searchQq(query, { limit, wantLyric }).catch(() => null),
		]);

		// 两个源都挂了才报错；单独一个挂了就把另一个的结果给出去
		if (source !== "qq" && !netease && source !== "netease" && !qq) {
			return fail("搜索失败，稍后再试", 502);
		}

		const tracks =
			source === "netease"
				? (netease?.tracks ?? [])
				: source === "qq"
					? (qq?.tracks ?? [])
					: mergeSources(
							[...(netease?.tracks ?? []), ...(qq?.tracks ?? [])],
							limit,
						);

		return json(
			{
				query,
				source,
				count: tracks.length,
				// 上游搜到多少、滤掉多少，让调用方能判断是不是关键词太泛
				found: (netease?.found ?? 0) + (qq?.found ?? 0),
				results: markSameName(tracks),
			},
			{ cache: "public, max-age=180" },
		);
	} catch (error) {
		console.error("[music] search failed:", query, error?.message ?? error);
		return fail("搜索失败，稍后再试", 502);
	}
}

/**
 * `GET /api/music/artist?id=<歌手 id>|q=<歌手名>&limit=8&source=netease|qq|all`
 *
 * 给模型一条「搜不到歌就换人」的路：按歌手取热门 50 首，可播放率实测明显高于
 * 关键词搜索（花粥前 20 首里 19 首能放）。`q` 形式会先 type=100 找歌手。
 *
 * QQ 那边只认歌手名（按名字搜再精确过滤），id 形式没有对应的歌手歌单接口。
 */
async function artistResponse(url, cookie) {
	const id = numericId(url.searchParams.get("id") ?? "");
	const query = (url.searchParams.get("q") ?? "").trim();
	const source = readSource(url);

	const requested = Number(url.searchParams.get("limit") ?? 10);
	const limit =
		Number.isFinite(requested) && requested > 0
			? Math.min(Math.trunc(requested), MAX_SEARCH_LIMIT)
			: 10;

	try {
		if (source === "qq" || (source === "all" && !id)) {
			const name = query;
			if (!name) return fail("QQ 曲库需要歌手名 q", 400);
			if (name.length > MAX_QUERY_CHARS) return fail("歌手名过长", 400);
			const top = await qqArtistSongs(name, { limit: Math.max(limit * 2, 12) });
			const playable = await qqProbePlayable(
				top.map((track) => track.id),
			).catch(() => null);
			const kept = (
				playable ? top.filter((track) => playable.has(track.id)) : top
			).slice(0, limit);
			const qqJson = {
				...(query ? { query } : {}),
				source: "qq",
				artist: null,
				count: kept.length,
				found: top.length,
				results: markSameName(kept),
			};
			if (source === "qq")
				return json(qqJson, { cache: "public, max-age=300" });

			// source=all：两个源各取一半，凑够 limit 就停
			const half = Math.max(1, Math.ceil(limit / 2));
			const netease = await artistNetease({
				id,
				query,
				limit: half,
				cookie,
			}).catch(() => null);
			const tracks = mergeSources([...(netease?.tracks ?? []), ...kept], limit);
			return json(
				{
					...(query ? { query } : {}),
					source: "all",
					artist: netease?.artist ?? null,
					count: tracks.length,
					found: (netease?.found ?? 0) + top.length,
					results: markSameName(tracks),
				},
				{ cache: "public, max-age=300" },
			);
		}

		const result = await artistNetease({ id, query, limit, cookie });
		if (!result)
			return json(
				{ query, artist: null, count: 0, results: [] },
				{ cache: "public, max-age=180" },
			);
		return json(
			{
				...(query ? { query } : {}),
				source: "netease",
				artist: result.artist,
				count: result.tracks.length,
				found: result.found,
				results: markSameName(result.tracks),
			},
			{ cache: "public, max-age=300" },
		);
	} catch (error) {
		console.error(
			"[music] artist failed:",
			id || query,
			error?.message ?? error,
		);
		return fail("歌手查询失败，稍后再试", 502);
	}
}

async function artistNetease({ id, query, limit, cookie }) {
	let artistId = id;
	let artistName = "";
	let artistPic = "";
	if (!artistId) {
		if (!query) return null;
		if (query.length > MAX_QUERY_CHARS) throw new Error("歌手名过长");
		const [hit] = await searchArtists(query, { limit: 1, cookie });
		if (!hit) return null;
		artistId = hit.id;
		artistName = hit.name;
		artistPic = hit.pic;
	}

	const top = await fetchArtistTop(artistId, { cookie });
	const playability = await fetchPlayability(
		top.map((track) => track.id),
		{ cookie },
	);
	const kept = (
		playability
			? top.filter((track) => playability.playable.has(track.id))
			: top
	).slice(0, limit);

	return {
		artist: { id: artistId, name: artistName, pic: artistPic },
		found: top.length,
		tracks: kept.map((track) => ({
			...track,
			source: "netease",
			...(playability?.trial.has(track.id) ? { trial: true } : {}),
		})),
	};
}

async function lyricResponse(url, cookie) {
	const ref = readTrackRef(url);
	if (!ref) return fail("缺少合法的歌曲 id", 400);

	try {
		const lyric =
			ref.source === "qq"
				? await qqFetchLyric(ref.id)
				: await fetchLyric(ref.id, { cookie });
		return json(
			{ id: ref.id, source: ref.source, ...lyric },
			{ cache: "public, max-age=86400" },
		);
	} catch (error) {
		console.error(
			"[music] lyric failed:",
			ref.source,
			ref.id,
			error?.message ?? error,
		);
		return fail("歌词获取失败", 502);
	}
}
