/**
 * 动态 OG 分享图 —— EdgeOne Makers Cloud Function（Node.js 运行时）
 *
 * 路由由文件路径决定：本文件是 catch-all，对应 `/api/og/*`。
 *
 *   GET /api/og/<slug>?title=<标题>&tags=<逗号分隔>&date=<YYYY-MM-DD>
 *     ->  1200x630 PNG 分享卡
 *
 * 不带 title 时渲染站点默认卡片。
 *
 * 依赖：satori（JSX 风格树 -> SVG）+ @resvg/resvg-wasm（SVG -> PNG）。
 * 中文字体与 resvg 的 wasm 以 base64 内嵌在 _font.js / _resvg.js 辅助模块里
 * ——不要改成 fetch 站内静态资源，EO 函数运行时禁止回环请求自身站点。
 *
 * og:image 由 Astro 构建时生成（src/pages/posts/[...slug].astro），
 * URL 指向本函数所在的 Pages 域名。
 */

import fontB64 from "./_font.js";
import resvgB64 from "./_resvg.js";

const CARD_W = 1200;
const CARD_H = 630;

// 站点信息（与 src/config.ts 保持一致）
const SITE_TITLE = "MeowRain 的技术博客";
const SITE_DESC = "技术分享与实践";
const THEME = {
	// hue 340 对应的粉紫色系，与博客主题一致
	gradient: "linear-gradient(135deg, #1a1025 0%, #2d0a1f 55%, #4a0e2e 100%)",
	text: "#fdf2f8",
	accent: "#f9a8d4",
	dot: "#ec4899",
	muted: "rgba(253,242,248,0.55)",
};

// ---------- 模块级缓存（同实例复用） ----------

const FONT_DATA = Buffer.from(fontB64, "base64");
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

// 标题越长字号越小，保证最多 3 行能放下
function titleFontSize(len) {
	if (len <= 14) return 72;
	if (len <= 24) return 58;
	if (len <= 40) return 46;
	return 38;
}

function el(type, props = {}, children = undefined) {
	return { type, props: { ...props, children } };
}

// ---------- 卡片构建 ----------

function buildTree({ title, tags, date }) {
	const titleStyle = {
		display: "flex",
		width: "100%",
		fontSize: `${titleFontSize(title.length)}px`,
		fontWeight: 700,
		lineHeight: 1.35,
		color: THEME.text,
	};

	const tagPills = tags.slice(0, 4).map((t) =>
		el(
			"div",
			{
				style: {
					display: "flex",
					padding: "8px 22px",
					borderRadius: "999px",
					border: `2px solid ${THEME.accent}80`,
					fontSize: "26px",
					color: THEME.accent,
				},
			},
			t,
		),
	);

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
				padding: "72px",
				background: THEME.gradient,
				color: THEME.text,
				fontFamily: "Noto Sans SC",
			},
		},
		[
			// 顶栏：圆点 + 站点名
			el(
				"div",
				{
					style: {
						display: "flex",
						alignItems: "center",
						gap: "16px",
						color: THEME.accent,
						fontSize: "30px",
					},
				},
				[
					el("div", {
						style: {
							width: "14px",
							height: "14px",
							borderRadius: "7px",
							background: THEME.dot,
						},
					}),
					el("div", {}, SITE_TITLE),
				],
			),
			// 标题
			el("div", { style: { display: "flex", width: "100%" } }, [
				el("div", { style: titleStyle }, title),
			]),
			// 底栏：标签 + 日期
			el(
				"div",
				{
					style: {
						display: "flex",
						justifyContent: "space-between",
						alignItems: "flex-end",
						width: "100%",
					},
				},
				[
					el("div", { style: { display: "flex", gap: "12px" } }, tagPills),
					...(date
						? [
								el(
									"div",
									{ style: { color: THEME.muted, fontSize: "26px" } },
									date,
								),
							]
						: []),
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
			{ name: "Noto Sans SC", data: FONT_DATA, weight: 700, style: "normal" },
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
	const slug = context.params.default || url.searchParams.get("slug") || "";

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
