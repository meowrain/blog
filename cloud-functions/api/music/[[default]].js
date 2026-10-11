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
	fetchLyric,
	fetchPlayability,
	fetchPlaylist,
	fetchSongUrl,
	isAllowedBr,
	MAX_PLAYLIST_TRACKS,
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