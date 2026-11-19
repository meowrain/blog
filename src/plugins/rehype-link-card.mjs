import fs from "node:fs/promises";
import path from "node:path";
import { h } from "hastscript";
import { visit } from "unist-util-visit";

/**
 * 正文独占段落的外链 → 网站卡片。
 *
 * 构建期抓取目标页面的 og/meta，落盘缓存到 `cacheDir`（默认 `.link-card-cache`）。
 * 抓取超时 / 404 / 无 meta 一律降级成「域名 + URL」简版卡片，绝不抛错，
 * 保证 `pnpm build` 不会因为外链挂掉而失败。
 */

const DEFAULT_TIMEOUT = 5000;
const DEFAULT_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const MAX_CONCURRENCY = 4;
const FETCH_FAILED = "__failed__";

const TEXT_LEAVES_IGNORED = new Set(["img", "br"]);

/** 内存缓存：同一次构建里同一个 URL 只抓一次 */
const memoryCache = new Map();

function isHttpUrl(url) {
	return typeof url === "string" && /^https?:\/\//i.test(url);
}

function normalizeUrl(raw) {
	try {
		const u = new URL(raw);
		u.hash = "";
		return u.toString();
	} catch {
		return null;
	}
}

export function getHostname(url) {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
}

/** 是不是「本域」链接：同域（含子域）或指向静态资源都不做卡片 */
function isSameSite(url, site) {
	if (!site) return false;
	try {
		const target = new URL(url);
		const base = new URL(site);
		if (target.hostname === base.hostname) return true;
		// 同主域的子域也当站内：blog.x.cn 与 img.x.cn 是同一套资源
		const baseRoot = base.hostname.split(".").slice(-2).join(".");
		return (
			target.hostname === baseRoot || target.hostname.endsWith(`.${baseRoot}`)
		);
	} catch {
		return false;
	}
}

function hasText(value) {
	return typeof value === "string" && value.trim().length > 0;
}

/**
 * 判断一个 <p> 是否可以被替换成卡片。
 * 返回 { url, title } 或 null。
 */
export function matchCardParagraph(node, options) {
	const { site, skipDomains = [] } = options;
	const children = (node.children ?? []).filter((child) => {
		// 纯空白文本节点（缩进、换行）不算内容
		if (child.type === "text") return hasText(child.value);
		return true;
	});

	if (children.length !== 1) return null;

	const only = children[0];
	if (only.type !== "element" || only.tagName !== "a") return null;
	if (
		only.children?.some(
			(c) => c.type === "element" && !TEXT_LEAVES_IGNORED.has(c.tagName),
		)
	) {
		return null;
	}

	const props = only.properties ?? {};
	const href = typeof props.href === "string" ? props.href : "";
	const url = normalizeUrl(href);
	if (!url || !isHttpUrl(url)) return null;

	// 显式关闭：{linkcard=false}
	if (props.linkcard === false || props.linkcard === "false") return null;
	if (props["data-linkcard"] === "false") return null;

	if (isSameSite(url, site)) return null;

	const hostname = getHostname(url);
	if (!hostname) return null;
	if (skipDomains.some((d) => hostname === d || hostname.endsWith(`.${d}`)))
		return null;

	const text = (only.children ?? [])
		.filter((c) => c.type === "text")
		.map((c) => c.value)
		.join("")
		.trim();

	// 纯文字链接才当标题；带子元素的（如 <code>、图片）保留原样
	const hasNested = (only.children ?? []).some((c) => c.type === "element");
	const linkText = !hasNested && text !== url && text !== href ? text : "";

	return { url, hostname, linkText };
}

/* ------------------------------- 抓取部分 ------------------------------- */

function decodeEntities(str) {
	if (!str) return "";
	return str
		.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
			const lower = String(code).toLowerCase();
			if (lower === "amp") return "&";
			if (lower === "lt") return "<";
			if (lower === "gt") return ">";
			if (lower === "quot") return '"';
			if (lower === "apos" || lower === "39") return "'";
			if (lower === "nbsp") return " ";
			if (lower === "#39;") return "'";
			if (lower.startsWith("#x")) {
				const n = Number.parseInt(lower.slice(2), 16);
				return Number.isNaN(n) ? match : String.fromCodePoint(n);
			}
			if (lower.startsWith("#")) {
				const n = Number.parseInt(lower.slice(1), 10);
				return Number.isNaN(n) ? match : String.fromCodePoint(n);
			}
			return match;
		})
		.replace(/\s+/g, " ")
		.trim();
}

export function parseAttributes(tag) {
	const attrs = {};
	const re =
		/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
	let m = re.exec(tag);
	while (m) {
		attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? "";
		m = re.exec(tag);
	}
	return attrs;
}

/**
 * 极简 meta 解析：只认 <meta> 和 <title>，不建 DOM，避免大页面开销。
 * 用正则而非 node-html-parser，因为这里只需要几十字节的键值对。
 */
export function extractMetadata(html, baseUrl) {
	const result = {};
	const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
	for (const tag of metas) {
		const attrs = parseAttributes(tag);
		const key = (attrs.property || attrs.name || "").toLowerCase();
		const content = attrs.content;
		if (!key || !content) continue;
		if (result[key] === undefined) result[key] = decodeEntities(content);
	}

	if (!result["og:title"]) {
		const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
		if (titleMatch) result.title = decodeEntities(titleMatch[1]);
	}

	// 相对路径的 favicon / image 补成绝对地址；
	// data: 占位图标（部分站点防爬时返回 data:;base64,=）直接丢掉，否则卡片会显示碎图
	const absolutize = (value) => {
		if (!value) return value;
		if (value.startsWith("data:")) return "";
		if (!baseUrl) return value;
		try {
			return new URL(value, baseUrl).toString();
		} catch {
			return value;
		}
	};

	let icon =
		result.icon || result["shortcut icon"] || result["apple-touch-icon"];
	if (!icon) {
		const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
		for (const tag of linkTags) {
			const attrs = parseAttributes(tag);
			if (/\bicon\b/i.test(attrs.rel ?? "") && attrs.href) {
				icon = attrs.href;
				if (/apple-touch-icon/i.test(attrs.rel ?? "")) break;
			}
		}
	}

	const data = {
		title: result["og:title"] || result["twitter:title"] || result.title || "",
		description:
			result["og:description"] ||
			result.description ||
			result["twitter:description"] ||
			"",
		image: absolutize(
			result["og:image"] ||
				result["twitter:image"] ||
				result["twitter:image:src"] ||
				"",
		),
		icon: absolutize(icon || ""),
		siteName: result["og:site_name"] || "",
	};

	// 只有 favicon 不算「有内容」：像 juejin 那种防爬壳页面只吐一个图标，
	// 拿它当数据会渲染出一张空卡片，不如降级成域名简版。
	const hasAny =
		hasText(data.title) || hasText(data.description) || hasText(data.image);
	if (hasAny) return data;

	// 只有一段 <meta http-equiv="refresh"> 的跳转壳页面：返回跳转目标，交给调用方再抓一层
	const refresh = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/i);
	if (refresh) {
		const content = parseAttributes(refresh[0]).content ?? "";
		const target = content.match(/url\s*=\s*['"]?([^'";]+)/i);
		if (target?.[1] && baseUrl) {
			try {
				return { redirectTo: new URL(target[1], baseUrl).toString() };
			} catch {
				/* ignore */
			}
		}
	}

	return null;
}

async function readCache(cacheDir, key) {
	const file = path.join(cacheDir, `${key}.json`);
	try {
		const raw = await fs.readFile(file, "utf8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

async function writeCache(cacheDir, key, meta) {
	try {
		await fs.mkdir(cacheDir, { recursive: true });
		const file = path.join(cacheDir, `${key}.json`);
		await fs.writeFile(file, JSON.stringify(meta), "utf8");
	} catch {
		// 缓存写不进去不影响构建
	}
}

function cacheKey(url) {
	// 不用 crypto 保持同步简单：url 已经很短，做个稳定 hash 即可
	let hash = 0;
	for (let i = 0; i < url.length; i++) {
		hash = (hash * 31 + url.charCodeAt(i)) | 0;
	}
	return `${(hash >>> 0).toString(36)}-${url.length}`;
}

/**
 * 抓取期间把事件循环撑住。
 *
 * undici 的空闲 socket 是 unref 的：abort 之后若 fetch 的 Promise 迟迟不 settle，
 * 事件循环里就一个活跃 handle 都不剩，Node 直接触发 beforeExit。rollup 在
 * beforeExit 里发现还有 markdown 的 load hook 没返回，报
 * "Unexpected early exit. This happens when Promises returned by plugins cannot
 * resolve." 并把整次构建判失败 —— 而且是**静默**的：Astro 一行日志都不打。
 *
 * 实测：EdgeOne（4 核 6G、冷缓存）上外链集体超时必挂；本地有 .link-card-cache
 * 时一次都不抓，所以从没复现过。这里挂一个 ref 的 interval 把循环留住。
 */
function keepAlive(ms = 200) {
	const timer = setInterval(() => {}, ms);
	return () => clearInterval(timer);
}

/** abort 之后还愿意多等多久再判死；见 requestHtml 的说明 */
const HARD_DEADLINE_GRACE = 1500;

/**
 * 单次 HTTP 请求，超时用 AbortController 兜住；任何异常都只返回 error。
 *
 * 光有 AbortController 不够：它只保证「abort 已发出」，不保证 Promise 一定
 * settle（连接卡在 DNS / TCP 握手阶段时见过）。所以再叠一层硬截止，
 * 到点直接返回错误，绝不把 unresolved 的 Promise 留给 rollup。
 */
async function requestHtml(url, timeout) {
	const controller = new AbortController();
	const abortTimer = setTimeout(() => controller.abort(), timeout);
	let hardTimer;

	const attempt = (async () => {
		const res = await fetch(url, {
			signal: controller.signal,
			redirect: "follow",
			headers: {
				// 部分站点没有 UA 会直接 403
				"user-agent":
					"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
				accept: "text/html,application/xhtml+xml",
				"accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
			},
		});
		if (!res.ok) return { error: `HTTP ${res.status}` };
		const type = res.headers.get("content-type") ?? "";
		if (!type.includes("html")) return { error: `非 HTML (${type})` };
		return { html: await res.text(), finalUrl: res.url || url };
	})();

	const settle = attempt.catch((error) => ({
		error: error?.name === "AbortError" ? `超时 ${timeout}ms` : error?.message,
	}));

	// 竞速落败的那一路也要消费掉，否则是一个未处理的 rejection。
	settle.catch(() => {});

	const deadline = new Promise((resolve) => {
		hardTimer = setTimeout(
			() => resolve({ error: `超时 ${timeout}ms（硬截止）` }),
			timeout + HARD_DEADLINE_GRACE,
		);
	});

	try {
		return await Promise.race([settle, deadline]);
	} finally {
		clearTimeout(abortTimer);
		clearTimeout(hardTimer);
	}
}

async function fetchMetadata(url, { timeout, cacheDir, cacheMaxAge, log }) {
	const key = cacheKey(url);
	if (memoryCache.has(key)) return memoryCache.get(key);

	const cached = await readCache(cacheDir, key);
	if (cached && typeof cached.ts === "number" && cached.url === url) {
		if (Date.now() - cached.ts < cacheMaxAge) {
			const hit = cached.meta ?? null;
			memoryCache.set(key, hit);
			return hit;
		}
	}

	// 构建时多个请求同时在跑，偶发慢响应不该直接判死：
	// 失败后再试一次，两段超时相加控制在 2×timeout 以内。
	const first = await requestHtml(url, timeout);
	let result = first;
	if (first.error) {
		result = await requestHtml(url, timeout);
	}

	let meta = null;
	if (result.error) {
		log(`warn: [link-card] ${result.error} ${url}（已降级）`);
	} else {
		meta = extractMetadata(result.html, result.finalUrl);

		// 有些站点（如 docs.astro.build）是纯 meta refresh 跳转页，再跟一层
		if (meta?.redirectTo) {
			const second = await requestHtml(meta.redirectTo, timeout);
			meta = second.error
				? null
				: extractMetadata(second.html, second.finalUrl);
		}
		if (!meta) log(`warn: [link-card] 页面里没有可用 meta ${url}（已降级）`);
	}

	memoryCache.set(key, meta);
	await writeCache(cacheDir, key, {
		url,
		ts: Date.now(),
		failed: meta ? undefined : FETCH_FAILED,
		meta: meta && !meta.redirectTo ? meta : undefined,
	});
	return meta;
}

/** 控制并发，避免一次构建对同一站点发起几十个请求 */
async function mapWithConcurrency(items, limit, fn) {
	const results = new Array(items.length);
	let cursor = 0;

	async function worker() {
		for (;;) {
			// 必须在 await 之前就抢占下表，否则并发 worker 会拿到同一个下标，
			// 同一个 URL 被抓两次、结果互相覆盖（曾导致降级卡片混进 favicon）。
			const index = cursor++;
			if (index >= items.length) return;
			results[index] = await fn(items[index], index);
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
	return results;
}

/* ------------------------------- 渲染部分 ------------------------------- */

function initialOf(hostname) {
	const first = hostname.replace(/^[^a-z0-9]+/i, "").charAt(0);
	return (first || "?").toUpperCase();
}

function buildCard({ url, hostname, linkText }, meta) {
	const title = meta?.title || linkText || hostname;
	const description = meta?.description || "";
	const image = meta?.image || "";
	const icon = meta?.icon || "";
	const degraded = !meta;

	const nIcon = icon
		? h("img", {
				class: "link-card-icon",
				src: icon,
				alt: "",
				loading: "lazy",
				decoding: "async",
				referrerpolicy: "no-referrer",
			})
		: h(
				"span",
				{ class: "link-card-icon is-fallback", "aria-hidden": "true" },
				initialOf(hostname),
			);

	const nBody = h("div", { class: "link-card-body" }, [
		h("div", { class: "link-card-title" }, title),
		description ? h("div", { class: "link-card-desc" }, description) : null,
		h("div", { class: "link-card-meta" }, [
			nIcon,
			h("span", { class: "link-card-host" }, hostname),
		]),
	]);

	const children = [nBody];

	// 没有 og:image 就不留空位，避免卡片出现空洞
	if (image) {
		children.push(
			h("div", { class: "link-card-cover" }, [
				h("img", {
					src: image,
					alt: "",
					loading: "lazy",
					decoding: "async",
					referrerpolicy: "no-referrer",
				}),
			]),
		);
	}

	return h(
		"div",
		{ class: "link-card-slot", "data-link-card": "true" },
		h(
			"a",
			{
				// no-styling 是 markdown.css 里给正文链接开的口子：
				// 不加的话会继承 prose 的虚线下划线 / 主色 / 内边距。
				class: `link-card no-styling${degraded ? " is-degraded" : ""}`,
				href: url,
				target: "_blank",
				rel: "noopener noreferrer",
				"data-link-card-host": hostname,
			},
			children,
		),
	);
}

/**
 * 环境变量开关：`LINK_CARD=0`（或 `false` / `off`）时直接关掉抓取。
 *
 * 给 CI 用：某些构建机出网受限，几十个外链只会一路超时到 5s×2，
 * 白白拖长构建时间、抬高内存占用。关掉后卡片退化成普通链接，站点照样能构建。
 * 放在插件里读而不是 config.ts，是因为 config.ts 会被客户端组件 import。
 */
function disableByEnv() {
	const raw = process.env.LINK_CARD;
	if (raw === undefined) return false;
	return ["0", "false", "off", "no"].includes(raw.trim().toLowerCase());
}

export default function rehypeLinkCard(options = {}) {
	const {
		enable = true,
		site = "",
		timeout = DEFAULT_TIMEOUT,
		cacheDir = ".link-card-cache",
		cacheMaxAge = DEFAULT_CACHE_MAX_AGE,
		skipDomains = [],
		log = console.warn,
	} = options;

	const effectiveEnable = enable && !disableByEnv();

	return async (tree) => {
		if (!effectiveEnable) return;

		const targets = [];
		visit(tree, "element", (node, index, parent) => {
			if (!parent || index === undefined) return;
			if (node.tagName !== "p") return;
			// 嵌套在 admonition / 列表 / 引用 / 表格里的段落不动
			if (
				parent.type === "element" &&
				parent.tagName !== "div" &&
				parent.tagName !== "section" &&
				parent.tagName !== "body"
			) {
				return;
			}

			const matched = matchCardParagraph(node, { site, skipDomains });
			if (matched) targets.push({ parent, node, ...matched });
		});

		if (targets.length === 0) return;

		const uniqueUrls = [...new Set(targets.map((t) => t.url))];
		// 抓取全程撑住事件循环，否则外链集体超时时 Node 会提前退出（见 keepAlive）。
		const release = keepAlive();
		let metas;
		try {
			metas = await mapWithConcurrency(uniqueUrls, MAX_CONCURRENCY, (url) =>
				fetchMetadata(url, { timeout, cacheDir, cacheMaxAge, log }),
			);
		} finally {
			release();
		}
		const metaByUrl = new Map(uniqueUrls.map((url, i) => [url, metas[i]]));

		// 用节点引用而不是 visit 给的下标：同一父节点下有多个目标时，先替换会
		// 让后面的下标失准（曾经导致替换写到了错误的位置，降级卡片被旧节点覆盖）。
		const byParent = new Map();
		for (const target of targets) {
			if (!byParent.has(target.parent)) byParent.set(target.parent, []);
			byParent.get(target.parent).push(target);
		}

		for (const list of byParent.values()) {
			for (const target of list) {
				const index = target.parent.children.indexOf(target.node);
				if (index === -1) continue;
				target.parent.children[index] = buildCard(
					target,
					metaByUrl.get(target.url) ?? null,
				);
			}
		}
	};
}
