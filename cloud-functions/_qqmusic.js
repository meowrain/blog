/**
 * QQ 音乐数据客户端 —— 电台的第二个曲库
 *
 * 站点本来只有网易云那套（_netease.js），这里补的是版权缺口：两家的免费曲库
 * 不是同一批歌。实测（未登录、不带 Cookie）：
 *
 *   网易云搜「毛不易 / 梁博 / 郭顶」→ 0 首可播；QQ 能捞出「无问」这类
 *   反过来「周杰伦 / 许嵩 / 陈奕迅 / 林俊杰」在 QQ 整页都要会员，一首也拿不到
 *   两边都行的（花粥、房东的猫）语种和曲目也不完全重合
 *
 * 所以两个源是互补，谁都不能替谁：电台先搜网易云，空了再问 QQ。
 *
 * ## 只用网页端接口，不碰登录态
 *
 * - 搜索：`c.y.qq.com/soso/fcgi-bin/client_search_cp`（`new_json=1` 才带
 *   `album.mid` 和 `file.media_mid`，前者拼封面，后者拼播放文件名）
 * - 播放地址：`u.y.qq.com/cgi-bin/musicu.fcg` 的 `vkey.GetVkeyServer`
 * - 歌词：`c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg`
 *
 * 不登录、不读 Cookie。`midurlinfo` 里 `purl` 为空就是放不了（会员曲、下架、
 * 版权受限），直接当作不可播 —— 这和用户不开会员在网页版能听到的范围一致。
 * 这样 QQ 这边不存在「试听 30 秒」的中间态，也就没有 trial 标记。
 *
 * ## 播放地址的形态
 *
 * vkey 返回 `sip`（`http://aqqmusic.tc.qq.com/`）+ `purl`（相对路径，带 vkey 参数）。
 * 必须自己拼成 https 直链：站点是 https，http 地址会被浏览器当混合内容拦掉。
 * 地址和 IP 绑定、有时效（约 2 小时），随用随取，绝不缓存。
 *
 * 上游返回的 `Content-Type` 是 `application/x-www-form-urlencoded`（COS 的默认值），
 * 但内容是正常的 MP4/MP3。浏览器 <audio> 按魔数嗅探，实测能播；不要为此去代理音频流，
 * 云函数扛不住那点带宽。
 */

const SEARCH_ORIGIN = "https://c.y.qq.com";
const API_ORIGIN = "https://u.y.qq.com";

/** 单次请求上游的超时。QQ 接口偶发半开连接，宁可报错也不让调用方一直挂着。 */
const TIMEOUT_MS = 8000;

/** 搜索接口一次最多 50 条；再多的靠换关键词，不翻页 */
const SEARCH_PAGE_SIZE = 50;

/** vkey 一次最多查多少首。实测 50 没问题，再长上游会嫌请求体大 */
const VKEY_BATCH_SIZE = 50;

/** vkey 要求一个数字 guid，随便给一个固定值即可 */
const GUID = "10000";

const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * 歌曲 mid 的形态：14 位左右的 base62（如 `0039MnYb0qxYhV`）。
 * 刻意不按「纯数字」校验 —— 那是网易云 id 的形状，和这里会互相挡。
 */
const SONG_MID_RE = /^[0-9A-Za-z]{8,20}$/;

export function isSongMid(value) {
	return typeof value === "string" && SONG_MID_RE.test(value);
}

function text(value, max = 200) {
	return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** 专辑封面：T002 是专辑图，300x300 足够播放卡和播放器用 */
export function coverUrl(albumMid) {
	const mid = text(albumMid, 20);
	return mid
		? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg`
		: "";
}

function buildHeaders() {
	return {
		"User-Agent": USER_AGENT,
		Referer: "https://y.qq.com/",
		Accept: "application/json, text/plain, */*",
		"Accept-Language": "zh-CN,zh;q=0.9",
	};
}

async function requestJson(url, init = {}) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			...init,
			headers: { ...buildHeaders(), ...(init.headers ?? {}) },
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`qq upstream ${url.pathname} -> HTTP ${response.status}`);
		}
		return await response.json();
	} finally {
		clearTimeout(timer);
	}
}

function getJson(path, params) {
	const url = new URL(path, SEARCH_ORIGIN);
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null || value === "") continue;
		url.searchParams.set(key, String(value));
	}
	return requestJson(url);
}

/** musicu.fcg 的统一调用形状：所有模块都塞在一个 req_0 里 */
function callMusicu(module, method, param) {
	return requestJson(new URL("/cgi-bin/musicu.fcg", API_ORIGIN), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			req_0: { module, method, param },
			comm: { ct: 24, cv: 0, format: "json", uin: "0" },
		}),
	});
}

/**
 * 搜索结果的归一化。
 *
 * `singers` 与 `mediaMid` 是给内部用的：前者做「按歌手取歌」的精确过滤，
 * 后者留着以后拉 mp3 版本。对外输出时由调用方裁掉。
 */
function normalizeSong(song) {
	const singers = Array.isArray(song?.singer) ? song.singer : [];
	const names = singers.map((singer) => text(singer?.name, 60)).filter(Boolean);
	return {
		id: text(song?.mid, 20),
		name: text(song?.name, 120),
		artists: names.join(" / ") || "未知歌手",
		album: text(song?.album?.name, 120),
		cover: coverUrl(song?.album?.mid),
		/** 上游给的是秒，站内统一用毫秒 */
		duration: (Number(song?.interval) || 0) * 1000,
		source: "qq",
		singers: names,
		mediaMid: text(song?.file?.media_mid, 20),
	};
}

/**
 * 关键词搜歌。
 *
 * 和网易云一样，只在「实体」上可靠：歌名、歌手名准，题材词（"适合写代码"）
 * 基本是字面匹配。语义那一步仍然交给模型先用 web_search 查具体歌手/歌名。
 *
 * 返回的曲目**没有探过可播性** —— 探测是单独一批 vkey，调用方按需做。
 */
export async function searchSongs(query, { limit = 12 } = {}) {
	const data = await getJson("/soso/fcgi-bin/client_search_cp", {
		w: query,
		format: "json",
		p: 1,
		// 多取一点：付费曲过滤掉之后常常剩不到 limit 首
		n: Math.min(Math.max(limit * 2, limit), SEARCH_PAGE_SIZE),
		cr: 1,
		new_json: 1,
	});
	const list = data?.data?.song?.list;
	if (!Array.isArray(list)) return [];
	return list.map(normalizeSong).filter((track) => track.id && track.name);
}

/**
 * 按歌手取歌。
 *
 * 不用 `GetSingerSongList`：那个接口按 singerMid 返回，实测和关键词搜索的曲目
 * 大量重复，还多一跳。直接搜歌手名，再按 `singers` 精确过滤 ——
 * 「周杰伦」的搜索结果里会混进合唱、翻唱和名字带「周杰伦」的别的歌，
 * 不过滤的话电台会放出一堆不是他的东西。
 */
export async function artistSongs(name, { limit = 10 } = {}) {
	const songs = await searchSongs(name, { limit: SEARCH_PAGE_SIZE });
	const target = name.trim().toLowerCase();
	const mine = songs.filter((track) =>
		track.singers.some((singer) => singer.toLowerCase() === target),
	);
	return mine.slice(0, limit);
}

/**
 * 批量探「哪些歌能放」。
 *
 * 返回 Set<mid>。整批失败时抛出 —— 调用方应当放弃过滤（宁多勿漏），
 * 而不是把搜索结果一起藏起来。
 */
export async function probePlayable(ids) {
	const playable = new Set();
	const mids = ids.filter(isSongMid);
	for (let i = 0; i < mids.length; i += VKEY_BATCH_SIZE) {
		const batch = mids.slice(i, i + VKEY_BATCH_SIZE);
		const data = await callMusicu("vkey.GetVkeyServer", "CgiGetVkey", {
			guid: GUID,
			songmid: batch,
			songtype: batch.map(() => 0),
			uin: "0",
			loginflag: 1,
			platform: "20",
		});
		for (const info of data?.req_0?.data?.midurlinfo ?? []) {
			if (info?.songmid && info.purl) playable.add(info.songmid);
		}
	}
	return playable;
}

/**
 * 取一首歌的播放地址（随用随取，有时效）。
 *
 * 默认不传 filename，上游回 128k AAC（`C400*.m4a`）。会员曲、下架曲的
 * purl 为空，返回空 url，由调用方按「不可播」处理。
 */
export async function fetchSongUrl(mid) {
	const data = await callMusicu("vkey.GetVkeyServer", "CgiGetVkey", {
		guid: GUID,
		songmid: [mid],
		songtype: [0],
		uin: "0",
		loginflag: 1,
		platform: "20",
	});
	const info = (data?.req_0?.data?.midurlinfo ?? []).find((item) => item?.purl);
	if (!info) return { url: "" };

	const sip =
		text(data?.req_0?.data?.sip?.[0], 80) || "https://aqqmusic.tc.qq.com/";
	const base = sip.replace(/^http:\/\//, "https://");
	return {
		url: new URL(info.purl, base).toString(),
		br: brFromFilename(info.filename),
		type: text(info.filename, 80).split(".").pop() || "",
		level: levelFromFilename(info.filename),
	};
}

/** 文件名前缀就是音质档：C400 / M500 是 128k，C600 是 320k，F000 是 flac */
function brFromFilename(filename) {
	const name = text(filename, 80);
	if (name.startsWith("F000")) return 999000;
	if (name.startsWith("C600") || name.startsWith("M800")) return 320000;
	if (name.startsWith("C400") || name.startsWith("M500")) return 128000;
	return 0;
}

function levelFromFilename(filename) {
	const name = text(filename, 80);
	if (name.startsWith("F000")) return "lossless";
	if (name.startsWith("C600") || name.startsWith("M800")) return "exhigh";
	return "standard";
}

/** 歌词。QQ 没有翻译曲库给普通用户，tlyric 恒为空，结构上和网易云那边保持一致 */
export async function fetchLyric(mid) {
	const data = await getJson("/lyric/fcgi-bin/fcg_query_lyric_new.fcg", {
		songmid: mid,
		format: "json",
		nobase64: 1,
	});
	return {
		lyric: typeof data?.lyric === "string" ? data.lyric : "",
		tlyric: "",
	};
}
