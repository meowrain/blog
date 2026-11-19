/**
 * 访问统计的维度归类与聚合（内部模块，不参与路由）。
 *
 * 放在 cloud-functions 根目录是因为云函数独立打包，不能跨目录 import；
 * 采集端（cloud-functions/api/stats/[[default]].js）用它把一次访问归类成
 * 来源/设备/浏览器/系统/地区/时段，仪表盘端用它把多天的计数合并排序。
 *
 * 全部是纯函数，测试在 tests/stats-dimensions.test.ts。
 */

/** 每个维度每天最多保留多少个不同的值，超出的一律并入「其他」，防止文档无限膨胀。 */
export const MAX_BUCKET_KEYS = 40;

/** 合并后「其他」项默认最多保留多少个键（不含固定排在末尾的「其他」）。 */
export const MAX_MERGED_KEYS = 12;

const SEARCH_HOSTS = [
	"google.",
	"bing.com",
	"baidu.com",
	"sogou.com",
	"so.com",
	"360.cn",
	"yahoo.",
	"duckduckgo.com",
	"yandex.",
	"ecosia.org",
	"brave.com",
	"naver.com",
	"startpage.com",
	"qwant.com",
];

const SOCIAL_HOSTS = [
	"t.me",
	"telegram.",
	"x.com",
	"twitter.com",
	"weibo.com",
	"weibo.cn",
	"douban.com",
	"reddit.com",
	"discord.com",
	"discord.gg",
	"facebook.com",
	"instagram.com",
	"linkedin.com",
	"bilibili.com",
	"zhihu.com",
	"qq.com",
	"v2ex.com",
	"jike.city",
	"mastodon.",
];

/**
 * 来源渠道：站内跳转 / 直接访问 / 搜索引擎 / 社交媒体 / 具体外链域名。
 *
 * @param {string} raw          document.referrer
 * @param {boolean} internal    前端标记的站内跳转（Swup 换页时为 true）
 * @param {string} selfHost     本站 hostname，用来识别自身域名的 referrer
 */
export function classifyReferrer(raw, internal, selfHost = "") {
	if (internal) return "站内跳转";
	if (typeof raw !== "string" || raw.length === 0) return "直接访问";
	let url;
	try {
		url = new URL(raw);
	} catch {
		return "直接访问";
	}
	if (!url.hostname) return "直接访问";
	const host = url.hostname.toLowerCase().replace(/^www\./, "");
	if (
		selfHost &&
		host ===
			String(selfHost)
				.toLowerCase()
				.replace(/^www\./, "")
	) {
		return "站内跳转";
	}
	if (SEARCH_HOSTS.some((h) => host.includes(h))) return "搜索引擎";
	if (SOCIAL_HOSTS.some((h) => host.includes(h))) return "社交媒体";
	return host;
}

/** 设备类型：机器人 / 平板 / 手机 / 桌面。判断顺序有讲究（iPad 的 UA 里有 Mac）。 */
export function classifyDevice(ua) {
	const s = (ua || "").toLowerCase();
	if (!s) return "未知";
	if (
		/bot|crawler|spider|slurp|facebookexternalhit|headlesschrome|curl\/|wget\/|python-requests/.test(
			s,
		)
	)
		return "机器人";
	if (/ipad|tablet|kindle|silk|playbook/.test(s)) return "平板";
	if (/android/.test(s) && !/mobile/.test(s)) return "平板";
	if (/mobi|iphone|ipod|android|blackberry|windows phone/.test(s))
		return "手机";
	if (/macintosh|windows nt|linux x86_64|x11/.test(s)) return "桌面";
	return "桌面";
}

/** 浏览器：主流内核优先判断（Edge/Opera 的 UA 里同时含 Chrome、Safari）。 */
export function classifyBrowser(ua) {
	const s = ua || "";
	if (!s) return "未知";
	if (/bot|crawler|spider|curl\/|wget\/|python-requests/i.test(s))
		return "机器人";
	if (/Edg[A-Z]?\//.test(s) || /Edge\//.test(s)) return "Edge";
	if (/OPR\/|Opera/.test(s)) return "Opera";
	if (/Firefox\/|FxiOS/.test(s)) return "Firefox";
	if (/CriOS\//.test(s)) return "Chrome";
	if (/Chrome\//.test(s)) return "Chrome";
	if (/Safari\//.test(s)) return "Safari";
	if (/MSIE |Trident\//.test(s)) return "IE";
	return "其他";
}

/** 操作系统：iOS 要排在 macOS 前（iPad 桌面版 UA 会伪装成 Mac）。 */
export function classifyOS(ua) {
	const s = (ua || "").toLowerCase();
	if (!s) return "未知";
	if (/windows phone/.test(s)) return "Windows Phone";
	if (/iphone|ipad|ipod/.test(s)) return "iOS";
	if (/android/.test(s)) return "Android";
	if (/windows/.test(s)) return "Windows";
	if (/mac os x|macintosh/.test(s)) return "macOS";
	if (/cros/.test(s)) return "ChromeOS";
	if (/linux/.test(s)) return "Linux";
	if (/bot|crawler|spider|curl\/|wget\/|python-requests/.test(s))
		return "机器人";
	return "其他";
}

/**
 * 地区信息：EdgeOne 的 context.geo 在不同调用方式下字段名略有差别
 * （`countryCodeAlpha2` / `countryName`，或整体包一层 `geo`），这里都兜一下。
 * 位置拿不到时返回空串，调用方跳过计数，避免把「未知」堆成第一大项。
 */
export function geoInfo(context) {
	const raw = context?.geo;
	if (!raw || typeof raw !== "object") return { country: "", region: "" };
	const g = raw.geo && typeof raw.geo === "object" ? raw.geo : raw;
	const country =
		g.countryName || g.countryCodeAlpha2 || g.countryCode || g.country || "";
	const region = g.regionName || g.province || g.region || "";
	const pick = (v) => (typeof v === "string" ? v.trim().slice(0, 40) : "");
	return { country: pick(country), region: pick(region) };
}

/** 给 daily 文档的某个维度 +1；达到上限后新值并入「其他」。 */
export function incBucket(daily, field, name) {
	if (!name) return;
	if (
		!daily[field] ||
		typeof daily[field] !== "object" ||
		Array.isArray(daily[field])
	) {
		daily[field] = {};
	}
	const bucket = daily[field];
	if (bucket[name] === undefined) {
		if (Object.keys(bucket).length >= MAX_BUCKET_KEYS) {
			bucket.其他 = (bucket.其他 || 0) + 1;
			return;
		}
		bucket[name] = 0;
	}
	bucket[name] += 1;
}

/** 给 daily 文档的小时数组 +1（上海时区）。 */
export function incHour(daily, date = new Date()) {
	if (!Array.isArray(daily.hours) || daily.hours.length !== 24) {
		daily.hours = new Array(24).fill(0);
	}
	daily.hours[hourInShanghai(date)] += 1;
}

/** 当前是上海时区的几点（0-23）。 */
export function hourInShanghai(date = new Date()) {
	const h = new Intl.DateTimeFormat("en-GB", {
		timeZone: "Asia/Shanghai",
		hour: "2-digit",
		hour12: false,
	}).format(date);
	const n = Number(h);
	return Number.isFinite(n) ? n % 24 : 0;
}

/**
 * 把多天的 `{ 名称: 次数 }` 合并成一个数组，按次数降序。
 * 超过 limit 的尾巴合并成一条「其他」，保证表格不会无限长。
 *
 * @returns {{ name: string, value: number }[]}
 */
export function mergeBuckets(docs, field, limit = MAX_MERGED_KEYS) {
	const merged = new Map();
	for (const doc of docs) {
		const bucket = doc?.[field];
		if (!bucket || typeof bucket !== "object" || Array.isArray(bucket))
			continue;
		for (const [name, count] of Object.entries(bucket)) {
			if (!Number.isFinite(count) || count <= 0) continue;
			merged.set(name, (merged.get(name) || 0) + count);
		}
	}
	const rows = [...merged.entries()]
		.map(([name, value]) => ({ name, value }))
		.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
	if (rows.length <= limit) return rows;
	const head = rows.slice(0, Math.max(1, limit - 1));
	const tail = rows.slice(Math.max(1, limit - 1));
	const rest = tail.reduce((n, r) => n + r.value, 0);
	return [...head, { name: "其他", value: rest }];
}

/** 把多天的小时数组逐位相加，长度固定 24。 */
export function mergeHours(docs) {
	const out = new Array(24).fill(0);
	for (const doc of docs) {
		if (!Array.isArray(doc?.hours)) continue;
		for (let i = 0; i < 24; i += 1) {
			const v = doc.hours[i];
			if (Number.isFinite(v) && v > 0) out[i] += v;
		}
	}
	return out;
}

/**
 * 趋势/分布摘要：峰值日、均值、新老访客、最忙时段。
 * 全部基于已经补齐空白的每日序列，所以「日均」按区间天数算而不是有数据的天数。
 */
export function summarizeSeries(series, hours) {
	const days = series.length;
	const views = series.reduce((n, d) => n + (d.views || 0), 0);
	const visitors = series.reduce((n, d) => n + (d.visitors || 0), 0);
	let peak = series[0] ?? null;
	for (const d of series) {
		if ((d.views || 0) > (peak?.views || 0)) peak = d;
	}
	let busiestHour = -1;
	let busiestHourViews = 0;
	(hours || []).forEach((v, i) => {
		if (v > busiestHourViews) {
			busiestHourViews = v;
			busiestHour = i;
		}
	});
	return {
		days,
		views,
		visitors,
		avgViews: days > 0 ? Math.round((views / days) * 10) / 10 : 0,
		avgVisitors: days > 0 ? Math.round((visitors / days) * 10) / 10 : 0,
		peak: peak ? { date: peak.date, views: peak.views || 0 } : null,
		// 同一访客一天内可能算多次（每天各自去重），所以比值只用于展示、不做加总。
		viewsPerVisitor:
			visitors > 0 ? Math.round((views / visitors) * 100) / 100 : 0,
		busiestHour,
		busiestHourViews,
	};
}

/**
 * 按周几汇总（0=周日…6=周六），用于「一周里哪天最热」。
 * 日期按 UTC 解析再取 UTC 星期，避免时区把 YYYY-MM-DD 挪到前一天。
 */
export function weekdayBreakdown(series) {
	const out = Array.from({ length: 7 }, (_, i) => ({
		weekday: i,
		views: 0,
		visitors: 0,
		days: 0,
	}));
	for (const d of series) {
		const [y, m, day] = String(d.date || "")
			.split("-")
			.map(Number);
		if (!y || !m || !day) continue;
		const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
		const row = out[wd];
		row.views += d.views || 0;
		row.visitors += d.visitors || 0;
		row.days += 1;
	}
	return out.map((row) => ({
		...row,
		avgViews: row.days > 0 ? Math.round((row.views / row.days) * 10) / 10 : 0,
	}));
}
