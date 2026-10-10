/**
 * 动态 OG 分享图 —— EdgeOne Makers Cloud Function（Node.js 运行时）
 *
 * 路由由文件路径决定：本文件是 catch-all，对应 `/api/og/<slug>`（slug 可含 `/`，
 * 如 `生活/这盘芒果沙冰真好吃`）。
 *
 *   GET /api/og/<slug>?title=<标题>&tags=<逗号分隔>&date=<YYYY-MM-DD>
 *     ->  1200x630 PNG 分享卡
 *
 * 不带 title 时渲染站点默认卡片。
 *
 * 注意：og:image 里必须带上一段路径。平台的 `[[default]].js` 只映射 `/api/og/*`
 * （生成的路由是 `^/api/og/(.*)$`），`/api/og` 与 `/api/og/` 都不命中，会直接 404。
 * 站点默认卡片因此走 `/api/og/home`（见 src/layouts/Layout.astro 的 og:image 兜底）。
 * 不要再加一个 `api/og/index.js` 来兜住空路径 —— 每个路由文件都会各自内嵌一份
 * base64 字体与 wasm，bundle 体积直接翻倍（实测 7.7MB -> 15.2MB）。
 *
 * 依赖：satori（JSX 风格树 -> SVG）+ @resvg/resvg-wasm（SVG -> PNG）。
 * 中文字体（700 粗体 + 400 常规体）与 resvg 的 wasm 以 base64 内嵌在
 * _font.js / _font400.js / _resvg.js 辅助模块里
 * ——不要改成 fetch 站内静态资源，EO 函数运行时禁止回环请求自身站点。
 *
 * og:image 由 Astro 构建时生成（src/pages/posts/[...slug].astro、src/layouts/Layout.astro），
 * URL 指向本函数所在的 Pages 域名。
 */

import fontBoldB64 from "./_font.js";
import fontRegularB64 from "./_font400.js";
import resvgB64 from "./_resvg.js";

const CARD_W = 1200;
const CARD_H = 630;

// 站点信息（与 src/config.ts 保持一致）
const SITE_TITLE = "MeowRain 的技术博客";
const SITE_DESC = "技术分享与实践";
const SITE_HOST = "blog.meowrain.cn";
const THEME = {
	// hue 340 粉紫系，与博客主题一致；卡片是「光晕 + 玻璃面板」构图
	bg: "linear-gradient(160deg, #1b0a18 0%, #2d0a1f 55%, #4c1030 100%)",
	text: "#fdf2f8",
	accent: "#ec4899",
	soft: "#f9a8d4",
	chipText: "#fbcfe8",
	panel: "rgba(255,255,255,0.055)",
	panelBorder: "rgba(249,168,212,0.24)",
	chipBg: "rgba(255,255,255,0.08)",
	chipBorder: "rgba(249,168,212,0.30)",
	dim: "rgba(253,242,248,0.5)",
	dimmer: "rgba(253,242,248,0.36)",
};

// ---------- 模块级缓存（同实例复用） ----------

const FONT_BOLD = Buffer.from(fontBoldB64, "base64");
const FONT_REGULAR = Buffer.from(fontRegularB64, "base64");
const WASM_BYTES = Buffer.from(resvgB64, "base64");

let wasmReady = null;
function loadWasm() {
	if (!wasmReady) {
		wasmReady = import("@resvg/resvg-wasm").then(({ initWasm }) =>
			initWasm(WASM_BYTES).then(() =>
				import("@resvg/resvg-wasm").then((m) => m.Resvg),
			),
		);
		wasmReady.catch(() => {
			wasmReady = null; // 失败允许下次重试
		});
	}
	return wasmReady;
}

// ---------- 文本处理 ----------

// satori 没有字体就没有 emoji 字形，过滤掉渲染不了的字符，
// 避免整卡渲染失败。
function stripEmoji(s) {
	return s
		.replace(
			/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}|\u{200D}|\u{20E3}/gu,
			"",
		)
		.trim();
}

// 标题越长字号越小；配合玻璃面板的内边距，最长标题控制在 3~4 行
function titleFontSize(len) {
	if (len <= 12) return 78;
	if (len <= 20) return 62;
	if (len <= 34) return 50;
	return 42;
}

function el(type, props = {}, children = undefined) {
	return { type, props: { ...props, children } };
}

// ---------- 卡片构建 ----------

function glow(size, offset, inner) {
	return el("div", {
		style: {
			position: "absolute",
			width: `${size}px`,
			height: `${size}px`,
			borderRadius: `${size / 2}px`,
			background: `radial-gradient(circle, ${inner} 0%, rgba(0,0,0,0) 70%)`,
			...offset,
		},
	});
}

function tagChip(tag) {
	return el(
		"div",
		{
			style: {
				display: "flex",
				padding: "7px 22px",
				borderRadius: "999px",
				background: THEME.chipBg,
				border: `1px solid ${THEME.chipBorder}`,
				fontSize: "23px",
				fontWeight: 400,
				color: THEME.chipText,
			},
		},
		tag,
	);
}

function buildTree({ title, tags, date }) {
	return el(
		"div",
		{
			style: {
				width: `${CARD_W}px`,
				height: `${CARD_H}px`,
				boxSizing: "border-box", // 注意：satori 遵循 CSS 默认 content-box，不加这个 padding 会把画布撑爆
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				position: "relative",
				overflow: "hidden",
				padding: "60px 72px",
				background: THEME.bg,
				color: THEME.text,
				fontFamily: "Noto Sans SC",
			},
		},
		[
			// 装饰层：两团渐变光晕 + 一道细圆环（satori 不支持 blur/box-shadow，只能用 radial-gradient 假糊）
			glow(620, { left: "-200px", bottom: "-260px" }, "rgba(168,85,247,0.34)"),
			glow(520, { right: "-140px", top: "-200px" }, "rgba(236,72,153,0.32)"),
			el("div", {
				style: {
					position: "absolute",
					width: "360px",
					height: "360px",
					borderRadius: "180px",
					border: "1px solid rgba(249,168,212,0.16)",
					right: "120px",
					top: "-140px",
				},
			}),
			// 顶栏：站点名 + 日期
			el(
				"div",
				{
					style: {
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						position: "relative",
					},
				},
				[
					el(
						"div",
						{ style: { display: "flex", alignItems: "center", gap: "14px" } },
						[
							el("div", {
								style: {
									width: "16px",
									height: "16px",
									borderRadius: "8px",
									background: THEME.accent,
								},
							}),
							el(
								"div",
								{
									style: {
										fontSize: "26px",
										fontWeight: 400,
										color: THEME.soft,
										letterSpacing: "1px",
									},
								},
								SITE_TITLE,
							),
						],
					),
					...(date
						? [
								el(
									"div",
									{
										style: {
											fontSize: "23px",
											fontWeight: 400,
											color: THEME.dim,
											letterSpacing: "2px",
										},
									},
									date,
								),
							]
						: []),
				],
			),
			// 标题：装进半透明玻璃面板
			el(
				"div",
				{
					style: {
						display: "flex",
						position: "relative",
						background: THEME.panel,
						border: `1px solid ${THEME.panelBorder}`,
						borderRadius: "30px",
						padding: "46px 52px",
					},
				},
				[
					el(
						"div",
						{
							style: {
								display: "flex",
								fontSize: `${titleFontSize(title.length)}px`,
								fontWeight: 700,
								lineHeight: 1.3,
								color: THEME.text,
							},
						},
						title,
					),
				],
			),
			// 底栏：标签 + 域名
			el(
				"div",
				{
					style: {
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						position: "relative",
					},
				},
				[
					el(
						"div",
						{ style: { display: "flex", gap: "12px" } },
						tags.slice(0, 4).map(tagChip),
					),
					el(
						"div",
						{
							style: {
								fontSize: "22px",
								fontWeight: 400,
								color: THEME.dimmer,
								letterSpacing: "1px",
							},
						},
						SITE_HOST,
					),
				],
			),
		],
	);
}

// ---------- 渲染 ----------

async function renderPng(params) {
	const [{ default: satori }, Resvg] = await Promise.all([
		import("satori"),
		loadWasm(),
	]);

	const svg = await satori(buildTree(params), {
		width: CARD_W,
		height: CARD_H,
		fonts: [
			{ name: "Noto Sans SC", data: FONT_BOLD, weight: 700, style: "normal" },
			{
				name: "Noto Sans SC",
				data: FONT_REGULAR,
				weight: 400,
				style: "normal",
			},
		],
	});

	const png = new Resvg(svg, { fitTo: { mode: "original" } }).render().asPng();
	return Buffer.from(png);
}

// ---------- 入口 ----------

function fallbackCard(err) {
	return new Response(
		JSON.stringify({
			error: "og card generation failed",
			// 临时调试：定位线上渲染失败原因后移除
			debug: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
		}),
		{
			status: 500,
			headers: {
				"Content-Type": "application/json",
				"Cache-Control": "no-store",
			},
		},
	);
}

export async function onRequestGet(context) {
	const { request } = context;
	const url = new URL(request.url);

	const title = stripEmoji(url.searchParams.get("title") || "");
	const tags = (url.searchParams.get("tags") || "")
		.split(",")
		.map((t) => stripEmoji(t).trim())
		.filter(Boolean)
		.slice(0, 6);
	const date = url.searchParams.get("date") || "";
	const slug = context.params?.default || url.searchParams.get("slug") || "";

	// 防滥用：来源必须是自己站点的 og:image 引用场景之外也允许直接访问，
	// 但限制单卡渲染文本长度，避免超大内存占用。
	if ([title, ...tags].some((s) => s.length > 120)) {
		return new Response("payload too long", { status: 413 });
	}

	const card = title
		? { title, tags, date }
		: {
				title: SITE_DESC,
				tags: [],
				date: "",
			};

	try {
		const png = await renderPng(card);
		return new Response(png, {
			status: 200,
			headers: {
				"Content-Type": "image/png",
				"Cache-Control": "public, max-age=86400", // 同 URL 内容不变（slug 相同则卡片相同），可以放心长缓存
				Etag: `"og-${slug.length ? slug : "home"}-${title.length}"`,
			},
		});
	} catch (err) {
		console.error("og render failed:", err);
		return fallbackCard(err);
	}
}

export async function onRequestHead(context) {
	const res = await onRequestGet(context);
	return new Response(null, { status: res.status, headers: res.headers });
}
