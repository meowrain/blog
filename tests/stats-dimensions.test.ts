import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	MAX_BUCKET_KEYS,
	classifyBrowser,
	classifyDevice,
	classifyOS,
	classifyReferrer,
	geoInfo,
	incBucket,
	incHour,
	mergeBuckets,
	mergeHours,
	summarizeSeries,
	weekdayBreakdown,
} from "../cloud-functions/_stats-dimensions.js";

describe("classifyReferrer", () => {
	it("站内标记优先于 referrer", () => {
		assert.equal(classifyReferrer("https://google.com/", true), "站内跳转");
	});

	it("空 referrer 记为直接访问", () => {
		assert.equal(classifyReferrer("", false), "直接访问");
		assert.equal(classifyReferrer(undefined, false), "直接访问");
		assert.equal(classifyReferrer("not a url", false), "直接访问");
	});

	it("自身域名算站内跳转", () => {
		assert.equal(
			classifyReferrer(
				"https://blog.meowrain.cn/posts/a/",
				false,
				"blog.meowrain.cn",
			),
			"站内跳转",
		);
		assert.equal(
			classifyReferrer(
				"https://www.blog.meowrain.cn/x",
				false,
				"blog.meowrain.cn",
			),
			"站内跳转",
		);
	});

	it("搜索引擎与社交媒体归为渠道", () => {
		assert.equal(
			classifyReferrer("https://www.google.com/search?q=x", false),
			"搜索引擎",
		);
		assert.equal(
			classifyReferrer("https://cn.bing.com/search?q=x", false),
			"搜索引擎",
		);
		assert.equal(
			classifyReferrer("https://www.baidu.com/s?wd=x", false),
			"搜索引擎",
		);
		assert.equal(
			classifyReferrer("https://t.me/somechannel", false),
			"社交媒体",
		);
		assert.equal(
			classifyReferrer("https://www.zhihu.com/question/1", false),
			"社交媒体",
		);
	});

	it("其余外链保留域名（去掉 www.）", () => {
		assert.equal(
			classifyReferrer("https://www.example.com/a", false),
			"example.com",
		);
	});
});

describe("classifyDevice", () => {
	it("手机 / 平板 / 桌面 / 机器人", () => {
		assert.equal(
			classifyDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"),
			"手机",
		);
		assert.equal(
			classifyDevice(
				"Mozilla/5.0 (Linux; Android 13; Pixel 7) Mobile Safari/537.36",
			),
			"手机",
		);
		assert.equal(
			classifyDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"),
			"平板",
		);
		assert.equal(
			classifyDevice("Mozilla/5.0 (Linux; Android 13; SM-X700) Safari/537.36"),
			"平板",
		);
		assert.equal(
			classifyDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120"),
			"桌面",
		);
		assert.equal(
			classifyDevice("Googlebot/2.1 (+http://www.google.com/bot.html)"),
			"机器人",
		);
	});
});

describe("classifyBrowser", () => {
	it("Edge / Opera 不会误判成 Chrome", () => {
		const edge =
			"Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120.0";
		assert.equal(classifyBrowser(edge), "Edge");
		const opera =
			"Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36 OPR/106";
		assert.equal(classifyBrowser(opera), "Opera");
	});

	it("Chrome / Safari / Firefox 正常识别", () => {
		assert.equal(
			classifyBrowser(
				"Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36",
			),
			"Chrome",
		);
		assert.equal(
			classifyBrowser(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605 Version/17 Safari/605",
			),
			"Safari",
		);
		assert.equal(
			classifyBrowser("Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/121.0"),
			"Firefox",
		);
	});

	it("空 UA 与爬虫", () => {
		assert.equal(classifyBrowser(""), "未知");
		assert.equal(classifyBrowser("curl/8.0"), "机器人");
	});
});

describe("classifyOS", () => {
	it("iOS 优先级高于 macOS", () => {
		assert.equal(
			classifyOS(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Mobile/15E148",
			),
			"macOS",
		);
		assert.equal(
			classifyOS("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"),
			"iOS",
		);
	});

	it("Windows / Android / Linux", () => {
		assert.equal(
			classifyOS("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"),
			"Windows",
		);
		assert.equal(
			classifyOS("Mozilla/5.0 (Linux; Android 13; Pixel 7)"),
			"Android",
		);
		assert.equal(classifyOS("Mozilla/5.0 (X11; Linux x86_64)"), "Linux");
	});
});

describe("geoInfo", () => {
	it("兼容扁平与嵌套两种字段结构", () => {
		assert.deepEqual(
			geoInfo({ geo: { countryCodeAlpha2: "CN", region: "Guangdong" } }),
			{
				country: "CN",
				region: "Guangdong",
			},
		);
		assert.deepEqual(
			geoInfo({ geo: { geo: { countryName: "China", cityName: "Shenzhen" } } }),
			{
				country: "China",
				region: "",
			},
		);
	});

	it("拿不到位置时返回空串，不落「未知」", () => {
		assert.deepEqual(geoInfo({}), { country: "", region: "" });
		assert.deepEqual(geoInfo(undefined), { country: "", region: "" });
	});
});

describe("incBucket", () => {
	it("累加计数", () => {
		const daily = {};
		incBucket(daily, "refs", "直接访问");
		incBucket(daily, "refs", "直接访问");
		incBucket(daily, "refs", "搜索引擎");
		assert.deepEqual(daily.refs, { 直接访问: 2, 搜索引擎: 1 });
	});

	it("空名称不计数", () => {
		const daily = {};
		incBucket(daily, "countries", "");
		assert.equal(daily.countries, undefined);
	});

	it("超过上限的新值并入「其他」", () => {
		const daily = {};
		for (let i = 0; i < MAX_BUCKET_KEYS; i += 1)
			incBucket(daily, "refs", `h${i}`);
		incBucket(daily, "refs", "溢出域名");
		assert.equal(daily.refs.溢出域名, undefined);
		assert.equal(daily.refs.其他, 1);
		assert.equal(Object.keys(daily.refs).length, MAX_BUCKET_KEYS + 1);
	});
});

describe("incHour", () => {
	it("先补齐 24 位再把对应时段 +1", () => {
		const daily = {};
		incHour(daily, new Date("2026-11-18T00:30:00Z")); // 上海 08:30
		assert.equal(daily.hours.length, 24);
		assert.equal(daily.hours[8], 1);
		assert.equal(
			daily.hours.reduce((n, v) => n + v, 0),
			1,
		);
	});
});

describe("mergeBuckets", () => {
	it("跨天累加并按次数降序", () => {
		const rows = mergeBuckets(
			[{ refs: { a: 2, b: 5 } }, { refs: { a: 4 } }],
			"refs",
		);
		assert.deepEqual(rows, [
			{ name: "a", value: 6 },
			{ name: "b", value: 5 },
		]);
	});

	it("超过上限时尾巴合并成「其他」，且总和不丢", () => {
		const bucket = {};
		for (let i = 0; i < 20; i += 1) bucket[`h${i}`] = 20 - i;
		const rows = mergeBuckets([{ refs: bucket }], "refs", 5);
		assert.equal(rows.length, 5);
		const total = rows.reduce((n, r) => n + r.value, 0);
		const expected = Object.values(bucket).reduce((n, v) => n + v, 0);
		assert.equal(total, expected);
		assert.equal(rows[rows.length - 1].name, "其他");
	});

	it("缺失或非法数据返回空数组", () => {
		assert.deepEqual(mergeBuckets([{}, { refs: null }], "refs"), []);
		assert.deepEqual(mergeBuckets([], "refs"), []);
	});
});

describe("mergeHours", () => {
	it("逐位相加、缺数据补 0", () => {
		const a = new Array(24).fill(0);
		a[3] = 2;
		const b = new Array(24).fill(0);
		b[3] = 5;
		b[23] = 1;
		const merged = mergeHours([{ hours: a }, { hours: b }, {}]);
		assert.equal(merged[3], 7);
		assert.equal(merged[23], 1);
		assert.equal(merged.length, 24);
	});
});

describe("summarizeSeries", () => {
	const series = [
		{ date: "2026-11-16", views: 10, visitors: 5 },
		{ date: "2026-11-17", views: 30, visitors: 10 },
		{ date: "2026-11-18", views: 20, visitors: 6 },
	];
	const hours = new Array(24).fill(0);
	hours[21] = 42;

	it("均值、峰值、最热时段", () => {
		const s = summarizeSeries(series, hours);
		assert.equal(s.views, 60);
		assert.equal(s.visitors, 21);
		assert.equal(s.avgViews, 20);
		assert.deepEqual(s.peak, { date: "2026-11-17", views: 30 });
		assert.equal(s.busiestHour, 21);
		assert.equal(s.busiestHourViews, 42);
	});

	it("空序列不崩", () => {
		const s = summarizeSeries([], []);
		assert.equal(s.days, 0);
		assert.equal(s.avgViews, 0);
		assert.equal(s.peak, null);
		assert.equal(s.busiestHour, -1);
	});
});

describe("weekdayBreakdown", () => {
	it("按周几归组并算日均", () => {
		const rows = weekdayBreakdown([
			{ date: "2026-11-16", views: 10, visitors: 3 }, // 周一
			{ date: "2026-11-23", views: 20, visitors: 4 }, // 周一
			{ date: "2026-11-17", views: 6, visitors: 1 }, // 周二
		]);
		// 0=周日，1=周一
		assert.equal(rows[1].views, 30);
		assert.equal(rows[1].days, 2);
		assert.equal(rows[1].avgViews, 15);
		assert.equal(rows[2].views, 6);
		assert.equal(rows[0].views, 0);
	});
});
