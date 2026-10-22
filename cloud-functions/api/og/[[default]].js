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
	// hue 340 粉紫系，与博客主题一致；卡片是「光晕 + 同心圆 + 左侧主题色短线」构图
	bg: "linear-gradient(150deg, #180710 0%, #25091a 46%, #390f27 100%)",
	text: "#fff6fb",
	accent: "#f0559b",
	soft: "#f7b8d6",
	chipText: "#f9cfe4",
	chipBg: "rgba(255,255,255,0.07)",
	chipBorder: "rgba(249,168,212,0.26)",
	dim: "rgba(255,246,251,0.56)",
	dimmer: "rgba(255,246,251,0.34)",
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

// 标题越长字号越小；实际字号还会被 fitTitle 按行数与孤字微调
function titleFontSize(len) {
	if (len <= 10) return 86;
	if (len <= 16) return 72;
	if (len <= 24) return 62;
	if (len <= 40) return 50;
	return 44;
}

// satori 没有文本溢出裁剪，长标题必须自己折行 + 截断，否则会顶出面板。
const CJK = /[\u2e80-\u9fff\u3000-\u303f\uf900-\ufaff\uff00-\uffef]/;
function charWidth(ch) {
	if (CJK.test(ch)) return 1;
	if (ch === " ") return 0.3;
	if (/[A-Z0-9]/.test(ch)) return 0.62;
	if (/[mwMW]/.test(ch)) return 0.84;
	if (/[iljt.,:;'!|]/.test(ch)) return 0.3;
	if (/[a-z]/.test(ch)) return 0.52;
	return 0.58;
}

function measureLine(text, fontSize) {
	let width = 0;
	for (const ch of text) width += charWidth(ch) * fontSize;
	return width;
}

/**
 * 按估算宽度把标题折成若干行；英文尽量在空格处断开，中文逐字断开。
 * 超过 maxLines 的部分丢掉并以 … 收尾。
 */
function wrapTitle(text, fontSize, maxWidth, maxLines) {
	const lines = [];
	let line = "";
	let lineWidth = 0;
	let truncated = false;

	const flush = () => {
		lines.push(line.trimEnd());
		line = "";
		lineWidth = 0;
	};

	for (const ch of text) {
		const w = charWidth(ch) * fontSize;
		if (lineWidth + w > maxWidth && line) {
			// 英文单词被切断时把最后一段挪到下一行，避免出现 "threa / d"
			const ascii = !CJK.test(ch);
			const cut = ascii ? line.lastIndexOf(" ") : -1;
			if (cut > line.length * 0.4) {
				const carry = line.slice(cut + 1);
				line = line.slice(0, cut);
				flush();
				line = carry;
				lineWidth = measureLine(carry, fontSize);
			} else {
				flush();
			}
			if (lines.length >= maxLines) {
				truncated = true;
				break;
			}
		}
		line += ch;
		lineWidth += w;
	}

	if (truncated) {
		// 已经超行了，把最后一行收成省略号
		const last = lines[maxLines - 1] ?? "";
		lines[maxLines - 1] = `${last.replace(/[，,、\s]+$/, "")}…`;
		return lines.slice(0, maxLines);
	}
	if (line.trim()) lines.push(line.trimEnd());
	return lines;
}

/**
 * 估宽有误差，折行结果可能刚好把末尾一两个字挤到下一行（"优化" -> "优" / "化"）。
 * 先往下微调字号，找出「不超过 3 行且末行不太短」的排法；实在不行就用原字号截断。
 */
function fitTitle(text, maxWidth) {
	const base = titleFontSize(text.length);
	const sizes = [];
	for (let size = base; size >= 40; size -= 2) sizes.push(size);

	let fallback = { fontSize: base, lines: wrapTitle(text, base, maxWidth, 3) };
	for (const fontSize of sizes) {
		const lines = wrapTitle(text, fontSize, maxWidth, 3);
		if (lines.length === 0) continue;
		const last = lines[lines.length - 1];
		// 末行只有一个字（或不到行宽 30%）算孤字，宁可缩小一号再试
		const orphan = lines.length > 1 && measureLine(last, fontSize) < maxWidth * 0.3;
		if (!orphan && !last.endsWith("…")) return { fontSize, lines };
		if (fontSize === base) fallback = { fontSize, lines };
	}
	return fallback;
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
				padding: "8px 24px",
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

// 同心细圆环：satori 没有 blur，靠描边圆做出层次，比单圈更耐看
function ring(size, offset, opacity = 0.14) {
	return el("div", {
		style: {
			position: "absolute",
			width: `${size}px`,
			height: `${size}px`,
			borderRadius: `${size / 2}px`,
			border: `1px solid rgba(249,168,212,${opacity})`,
			...offset,
		},
	});
}

function buildTree({ title, tags, date }) {
	const titleWidth = 872;
	// satori 不会裁剪溢出的文字，长标题必须自己折行、必要时缩字号
	const { fontSize, lines } = fitTitle(title, titleWidth);

	return el(
		"div",
		{
			style: {
				width: `${CARD_W}px`,
				height: `${CARD_H}px`,
				boxSizing: "border-box", // 注意：satori 遵循 CSS 默认 content-box，不加这个 padding 会把画布撑爆
				display: "flex",
				flexDirection: "column",
				position: "relative",
				overflow: "hidden",
				padding: "64px 76px 56px",
				background: THEME.bg,
				color: THEME.text,
				fontFamily: "Noto Sans SC",
			},
		},
		[
			// ---------- 装饰层 ----------
			glow(760, { left: "-280px", bottom: "-340px" }, "rgba(168,85,247,0.34)"),
			glow(560, { right: "-170px", top: "-220px" }, "rgba(240,85,155,0.36)"),
			glow(440, { right: "180px", bottom: "-280px" }, "rgba(236,72,153,0.18)"),
			ring(420, { right: "56px", top: "-190px" }, 0.16),
			ring(620, { right: "-30px", top: "-290px" }, 0.09),
			// 底栏上方一条渐隐分隔线
			el("div", {
				style: {
					position: "absolute",
					left: "76px",
					right: "76px",
					bottom: "132px",
					height: "1px",
					background:
						"linear-gradient(90deg, rgba(249,168,212,0) 0%, rgba(249,168,212,0.20) 14%, rgba(249,168,212,0.20) 86%, rgba(249,168,212,0) 100%)",
				},
			}),

			// ---------- 顶栏：站点标识 + 日期 ----------
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
						{ style: { display: "flex", alignItems: "center", gap: "16px" } },
						[
							el(
								"div",
								{
									style: {
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										width: "38px",
										height: "38px",
										borderRadius: "12px",
										background:
											"linear-gradient(140deg, rgba(240,85,155,0.95) 0%, rgba(168,85,247,0.9) 100%)",
									},
								},
								[
									el("div", {
										style: {
											width: "13px",
											height: "13px",
											borderRadius: "7px",
											background: "rgba(255,255,255,0.92)",
										},
									}),
								],
							),
							el(
								"div",
								{
									style: {
										display: "flex",
										fontSize: "27px",
										fontWeight: 600,
										color: THEME.soft,
										letterSpacing: "0.5px",
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
											display: "flex",
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

			// ---------- 标题区：主题色短线 + 大标题 ----------
			el(
				"div",
				{
					style: {
						display: "flex",
						flexDirection: "column",
						justifyContent: "center",
						flex: 1,
						gap: "28px",
						position: "relative",
						paddingRight: "48px",
					},
				},
				[
					el("div", {
						style: {
							display: "flex",
							width: "72px",
							height: "6px",
							borderRadius: "3px",
							background:
								"linear-gradient(90deg, #f0559b 0%, rgba(168,85,247,0.85) 100%)",
						},
					}),
					el(
						"div",
						{
							style: {
								display: "flex",
								flexDirection: "column",
								width: `${titleWidth}px`,
								fontSize: `${fontSize}px`,
								fontWeight: 700,
								lineHeight: 1.28,
								letterSpacing: "0.5px",
								color: THEME.text,
							},
						},
						lines.map((line) =>
							el("div", { style: { display: "flex" } }, line || " "),
						),
					),
				],
			),

			// ---------- 底栏：标签 + 域名 ----------
			el(
				"div",
				{
					style: {
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						position: "relative",
						height: "74px",
						marginTop: "18px",
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
								display: "flex",
								alignItems: "center",
								gap: "10px",
								fontSize: "22px",
								fontWeight: 400,
								color: THEME.dimmer,
								letterSpacing: "1px",
							},
						},
						[
							el("div", {
								style: {
									width: "8px",
									height: "8px",
									borderRadius: "4px",
									background: THEME.accent,
								},
							}),
							SITE_HOST,
						],
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
				// 文章页分享需要跨域 fetch 成 File；HEAD 复用同一份 headers
				"Access-Control-Allow-Origin": "*",
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
