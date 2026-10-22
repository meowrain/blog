import { postPathBySlug } from "../utils/url-utils.ts";
import { parseWikiLinks } from "../utils/wikilink-core.ts";

/**
 * 双链（wikilink）：把正文里的 `[[slug]]` 变成指向 `/posts/<slug>/` 的链接，
 * 同时把出链清单写进 `data.astro.frontmatter.wikilinks`（反向链接靠它反转）。
 *
 * ## 路线选择：remark 直接替换，不做「remark 标记 + rehype 改写」
 *
 * 1. rehype 阶段拿不到 `file.data.astro.frontmatter`，出链清单只能在 remark
 *    阶段落地。绕去 rehype 再从 hast 反推清单，等于同一件事解析两遍，容易漂移。
 * 2. 唯一「看起来」必须放到 rehype 的事是按 slug 查标题。但 remark 插件是同步
 *    注册的，`astro:content` 在 `astro.config.mjs` 里 import 不到，所以标题表
 *    在配置期用 Node 直接扫目录得到（`src/utils/wikilink-targets.ts`），
 *    作为参数注入。插件本身完全同步，不碰异步 I/O，也不需要 rehype 接力。
 * 3. `[[a#小节标题]]` 的锚点直接用原始中文拼 `/posts/a/#小节标题`：`rehype-slug`
 *    为中文标题生成的 id 本来就保留原文（只折叠空格和标点），点了能命中。
 *
 * 结论：remark 一次搞定「识别 → 替换 → 记录出链」。
 *
 * ## 转义
 *
 * `\[[a]]` 里的反斜杠会被 micromark 先吃掉，等插件看到 text 节点时已经是
 * `[[a]]`。所以判断「是不是转义」只能靠节点位置：插件在 `remarkPlugins`
 * 排第一、`remarkMath` 也还没动过，此时 text 节点的 offset 仍和源码一一对应，
 * 就能回源码里看 `[[` 前面是不是有反斜杠（见 `wikilink-core` 的 `parseWikiLinks`）。
 */

/** 断链告警去重：同一文件的同一个 slug 只提醒一次，免得刷屏。 */
function createWarner() {
	const seen = new Set();
	/**
	 * @param {string} filePath
	 * @param {number | undefined} line
	 * @param {string} slug
	 * @param {string} reason
	 */
	return (filePath, line, slug, reason) => {
		const key = `${filePath}:${slug}`;
		if (seen.has(key)) return;
		seen.add(key);
		const at = line ? `${filePath}:${line}` : filePath;
		console.warn(`[wikilink] ${reason}：${at} 指向 "${slug}"`);
	};
}

/** 拼最终 href：`/posts/<slug>/#<anchor>`，锚点保留原始中文。 */
export function buildWikiLinkHref(slug, anchor) {
	const path = postPathBySlug(slug);
	return anchor ? `${path}#${anchor}` : path;
}

/**
 * 把一段文本里的双链替换成节点数组；没有双链时返回 null。
 *
 * @param {string} value 文本内容
 * @param {object} ctx
 * @param {(slug: string) => {title: string} | undefined} ctx.lookup
 * @param {import("../utils/wikilink-core.ts").OutlinkRecord[]} ctx.outlinks 出链收集器
 * @param {(slug: string, reason: string) => void} ctx.onBroken 断链回调
 * @param {(index: number) => boolean} [ctx.isEscaped] 判断本段文本里某个 `[[` 是否被转义
 * @returns {any[] | null}
 */
export function splitWikiLinkText(value, ctx) {
	const tokens = parseWikiLinks(value, { isEscaped: ctx.isEscaped });
	if (tokens.length === 0) return null;

	/** @type {any[]} */
	const children = [];
	let cursor = 0;

	for (const token of tokens) {
		if (token.start > cursor) {
			children.push({ type: "text", value: value.slice(cursor, token.start) });
		}
		cursor = token.end;

		const target = ctx.lookup(token.target);
		/** @type {import("../utils/wikilink-core.ts").OutlinkRecord} */
		const record = { slug: token.target, resolved: Boolean(target) };
		if (token.text) record.text = token.text;
		if (token.anchor) record.anchor = token.anchor;
		ctx.outlinks.push(record);

		if (!target) {
			ctx.onBroken(token.target, "断链");
			// 断链：灰色划线文本，不可点。有自定义文字就显示文字，否则显示原始 slug
			children.push({
				type: "emphasis",
				data: {
					hName: "span",
					hProperties: { className: ["wikilink-broken"] },
				},
				children: [{ type: "text", value: token.text || token.target }],
			});
			continue;
		}

		const anchor = token.anchor;
		children.push({
			type: "link",
			url: buildWikiLinkHref(token.target, anchor),
			title: null,
			data: {
				hProperties: {
					className: anchor ? ["wikilink", "wikilink-anchor"] : ["wikilink"],
					"data-wikilink": token.target,
				},
			},
			children: [
				{
					type: "text",
					// 优先级：自定义文字 > 「标题 § 锚点」 > 标题
					value:
						token.text ||
						(anchor ? `${target.title} § ${anchor}` : target.title),
				},
			],
		});
	}

	if (cursor < value.length) {
		children.push({ type: "text", value: value.slice(cursor) });
	}

	return children;
}

/**
 * 同步核心：只处理一棵 mdast 树，单测可以直接喂 AST。
 *
 * @param {any} tree mdast root
 * @param {object} options
 * @param {Map<string, {title: string}>} options.posts slug → 目标文章
 * @param {string} [options.source] markdown 原文，用来看 `[[` 前是不是反斜杠
 * @param {boolean} [options.brokenLinkWarn]
 * @param {string} [options.filePath]
 * @returns {import("../utils/wikilink-core.ts").OutlinkRecord[]}
 */
export function transformWikiLinks(tree, options) {
	const {
		posts,
		source,
		brokenLinkWarn = true,
		filePath = "(unknown file)",
	} = options;
	const warn = brokenLinkWarn ? createWarner() : null;

	/** @type {import("../utils/wikilink-core.ts").OutlinkRecord[]} */
	const outlinks = [];

	/** 递归时记下当前 text 节点的起始行，断链告警要报位置。 */
	let currentLine;

	/**
	 * 当前 text 节点：文本内容 + 它在源码里的起点。
	 *
	 * 难点：micromark 会把 `\[` 吃成 `[`，节点文本比源码短，所以节点里的下标
	 * 不能直接当源码下标用。`position.offset` 只是节点「起点」准，中间差多少个
	 * 反斜杠得逐字符对齐才知道（见 `alignSource`）。
	 */
	let nodeText = "";
	/** 当前 text 节点在源码里的起点。 */
	let nodeStart = 0;

	/**
	 * 判断一条匹配是不是被反斜杠转义。
	 *
	 * 思路：节点文本比源码「短」，短的正是被 micromark 吃掉的转义反斜杠。
	 * 所以把 token 之前的文本前缀拿去源码里对齐（`alignSource`），
	 * 对齐后源码游标前面的字符就是 `[[` 真正的前一个字符。
	 *
	 * @param {{ start: number }} token
	 * @returns {boolean}
	 */
	const isEscapedAt = (token) => {
		if (!source) return false;

		// 无状态：每次都从节点起点重新对齐到 token.start。
		// 单次对齐是 O(n)，一篇文章的双链很少，不值得为省这点开销维护游标状态
		//（有状态的写法在「被跳过的写法」穿插时很容易错位）。
		const openAt = alignSource(nodeText, 0, token.start, source, nodeStart);

		// 对齐后源码游标可能正好压在「被吃掉的转义反斜杠」上（它在节点文本里
		// 不存在，所以对齐过程不会消费它）。先越过它，再数它前面有几个反斜杠。
		let end = openAt;
		while (source[end] === "\\") end++;

		let backslashes = 0;
		for (let i = end - 1; i >= 0 && source[i] === "\\"; i--) backslashes++;
		return backslashes % 2 === 1;
	};

	const ctx = {
		lookup: (slug) => posts.get(slug),
		outlinks,
		/**
		 * @param {string} slug
		 * @param {string} reason
		 */
		onBroken: (slug, reason) => {
			if (warn) warn(filePath, currentLine, slug, reason);
		},
	};

	/**
	 * 原地改写父节点的 children：\`inlineCode\` / \`code\` 不是 text 节点，
	 * 天然不会被误伤，所以只对 \`text\` 做替换。
	 * @param {any} node
	 */
	const walk = (node) => {
		if (!node || !Array.isArray(node.children)) return;

		/** @type {any[]} */
		const next = [];
		for (const child of node.children) {
			if (child.type === "text") {
				currentLine = child.position?.start?.line;
				nodeText = child.value;
				// position.offset 和 file.value 是同一套坐标：Astro 把 frontmatter
				// 用等长空白覆盖掉了，所以 offset 直接能用，不用再补 frontmatter 长度。
				nodeStart = child.position?.start?.offset ?? 0;
				const replaced = splitWikiLinkText(child.value, {
					...ctx,
					isEscaped: isEscapedAt,
				});
				if (replaced) next.push(...replaced);
				else next.push(child);
				continue;
			}
			walk(child);
			next.push(child);
		}
		node.children = next;
	};

	walk(tree);
	return outlinks;
}

/**
 * 在「节点文本」和「原始 markdown」之间逐字符对齐。
 *
 * 两者是同一段内容，唯一的差别是 micromark 会吞掉转义反斜杠（`\[` → `[`），
 * 所以源码可能比节点文本「多」几个字符——对齐时把多出来的反斜杠跳过即可。
 *
 * @param {string} text 节点文本
 * @param {number} textFrom 从节点文本的这个下标开始
 * @param {number} textTo 对齐到节点文本的这个下标（不含）
 * @param {string} source 原始 markdown
 * @param {number} sourceFrom 源码里对应的起点
 * @returns {number} 对齐后源码里的位置
 */
function alignSource(text, textFrom, textTo, source, sourceFrom) {
	let cursor = sourceFrom;
	let index = textFrom;

	while (index < textTo && cursor < source.length) {
		if (source[cursor] === text[index]) {
			cursor++;
			index++;
			continue;
		}
		// 源码这里比节点多出来的，只可能是被吃掉的转义反斜杠
		if (source[cursor] === "\\" && source[cursor + 1] === text[index]) {
			cursor++;
			continue;
		}
		// 对不上就保守前进，别死循环
		cursor++;
	}

	return cursor;
}

/**
 * remark 插件工厂（仓库既有 `.js` + JSDoc 风格）。
 *
 * @param {object} [options]
 * @param {Map<string, {title: string}>} [options.posts] slug → 目标文章标题表
 * @param {boolean} [options.enable] false 时完全不改 AST，双链原样显示成文本
 * @param {boolean} [options.brokenLinkWarn]
 * @returns {(tree: any, file: any) => void}
 */
export function remarkWikiLink(options = {}) {
	const { posts = new Map(), enable = true, brokenLinkWarn = true } = options;

	return (tree, file) => {
		const frontmatter = file?.data?.astro?.frontmatter;
		if (!enable) {
			if (frontmatter) frontmatter.wikilinks = [];
			return;
		}

		const filePath = file?.history?.[0] || file?.path || "(unknown file)";
		const outlinks = transformWikiLinks(tree, {
			posts: posts instanceof Map ? posts : new Map(Object.entries(posts)),
			// 这里拿到的是「解析后又被 remark 重新序列化」的内容，反斜杠已经没了，
			// 只作为兜底；转义判断真正依赖的是 astro 传进来的原始 markdown。
			source: typeof file?.value === "string" ? file.value : undefined,
			brokenLinkWarn,
			filePath,
		});

		if (frontmatter) frontmatter.wikilinks = outlinks;
	};
}
