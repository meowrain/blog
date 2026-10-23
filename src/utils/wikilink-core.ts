/**
 * 双链（wikilink）纯解析核心：零依赖，Node 里可直接跑单元测试。
 *
 * remark 解析 `[[slug]]` 时不会产生 linkReference，原样留在 text 节点里
 * （`inlineCode` / `code` 是独立节点，天然不会被误伤），所以识别逻辑就是
 * 在一段纯文本里扫 `[[...]]`。插件、反向索引、测试共用这一份实现。
 */

/** 一条双链的解析结果（语法层，还没查目标文章是否存在）。 */
export interface WikiLinkToken {
	/** 目标文章 slug，已 trim。空 slug 的写法直接不产生 token。 */
	target: string;
	/** 锚点（`#` 后面那段原始中文），没有就是 undefined。 */
	anchor?: string;
	/** `|` 后面的自定义显示文字，已 trim。 */
	text?: string;
	/** 在输入文本里的起止下标，插件靠它拼接前后剩余的文本。 */
	start: number;
	end: number;
	/** 原始匹配到的完整文本 `[[...]]`，便于出错时打印。 */
	raw: string;
}

/**
 * 合法 slug 的字符集：字母数字、下划线、连字符、点、斜杠、CJK。
 * 中文 slug 在这套内容里很常见（`开发日记/xxx`），所以不能只认 ASCII。
 *
 * 别的字符一律不猜——`[[ $a -lt 100 ]]` 这种 shell 片段在正文里也写着，
 * 它含空格和 `/**
 * 双链（wikilink）纯解析核心：零依赖，Node 里可直接跑单元测试。
 *
 * remark 解析 `[[slug]]` 时不会产生 linkReference，原样留在 text 节点里
 * （`inlineCode` / `code` 是独立节点，天然不会被误伤），所以识别逻辑就是
 * 在一段纯文本里扫 `[[...]]`。插件、反向索引、测试共用这一份实现。
 */

/** 一条双链的解析结果（语法层，还没查目标文章是否存在）。 */
export interface WikiLinkToken {
	/** 目标文章 slug，已 trim。空 slug 的写法直接不产生 token。 */
	target: string;
	/** 锚点（`#` 后面那段原始中文），没有就是 undefined。 */
	anchor?: string;
	/** `|` 后面的自定义显示文字，已 trim。 */
	text?: string;
	/** 在输入文本里的起止下标，插件靠它拼接前后剩余的文本。 */
	start: number;
	end: number;
	/** 原始匹配到的完整文本 `[[...]]`，便于出错时打印。 */
	raw: string;
}

/**
 * 合法 slug 的字符集：字母数字、下划线、连字符、点、斜杠、CJK。
 * 中文 slug 在这套内容里很常见（"开发日记/xxx"），所以不能只认 ASCII。
 *
 * 别的字符一律不猜：正文里还写着 "[[ $a -lt 100 ]]" 这类 shell 片段，
 * 它含空格和 "$"，落在这套字符集外，于是被原样留下当文本，不会变成断链。
 */
const SLUG_PATTERN = /^[\w\-.\/\u4e00-\u9fff]+$/u;

/**
 * `[[` 前面是反斜杠时视为转义，整段当普通文本输出（`\[[a]]` → `[[a]]`）。
 *
 * note: remark/micromark 会先吃掉一个反斜杠，`\[[a]]` 到达 text 节点时已经是
 * `[[a]]`，所以光看节点文本无法判断。见 `protectEscapedWikiLinks`。
 */
function isEscaped(source: string, openIndex: number): boolean {
	let backslashes = 0;
	for (let i = openIndex - 1; i >= 0 && source[i] === "\\"; i--) {
		backslashes++;
	}
	return backslashes % 2 === 1;
}

/**
 * 把 markdown 原文里被反斜杠转义的 `\[[` 换成占位符，解析完再换回来。
 *
 * micromark 遇到 `\[` 会把它当转义序列、只吐出一个 `[`，插件就无法区分
 * 「作者想写字面量」和「作者想双链」。所以插件在 remark 之前先保护起来：
 * 占位符不含 `[`，也不会被 markdown 语法吃掉。
 */
export const ESCAPED_WIKILINK_PLACEHOLDER = "\u0000ESCAPED_WIKILINK\u0000";

/** 把 `\[[` 换成占位符 + `[`，供插件在 parse 前调用。 */
export function protectEscapedWikiLinks(source: string): string {
	return source.replace(/\\\[\[/g, () => `${ESCAPED_WIKILINK_PLACEHOLDER}[`);
}

/** 把占位符还原成字面量 `[`，供插件在 transform 之后调用。 */
export function restoreEscapedWikiLinks(source: string): string {
	return source.split(ESCAPED_WIKILINK_PLACEHOLDER).join("");
}

/**
 * 扫一段纯文本里的所有 `[[...]]`。
 *
 * 支持的写法：
 * - `[[slug]]`
 * - `[[slug|显示文字]]`
 * - `[[slug#小节标题]]`
 * - 以上混用，允许首尾空格（`[[ slug | 文字 ]]`）
 *
 * 不处理的：空 slug（`[[]]` / `[[ |文字]]`）、跨行的 `[[`、嵌套 `[[`。
 * 不处理的情况原样留在文本里，不会生成节点。
 */
export interface ParseWikiLinkOptions {
	/**
	 * 判断某个下标处的 `[[` 是否被反斜杠转义。
	 *
	 * 默认按「本段文本内」判断，够单测用。插件传的实现基于源码 offset：
	 * micromark 会把 `\[` 吃成 `[`，节点文本比源码短，纯看文本判断不出来。
	 */
	isEscaped?: (token: { start: number; raw: string }) => boolean;
	/**
	 * 节点的文本内容。给了它，`isEscaped` 就能按 `token.start` 自己重新算，
	 * 不依赖调用顺序——插件侧就是这么用的。
	 */
	text?: string;
}

export function parseWikiLinks(
	source: string,
	options: ParseWikiLinkOptions = {},
): WikiLinkToken[] {
	const tokens: WikiLinkToken[] = [];
	let cursor = 0;

	while (cursor < source.length) {
		const open = source.indexOf("[[", cursor);
		if (open < 0) break;

		const close = source.indexOf("]]", open + 2);
		if (close < 0) break;

		const raw = source.slice(open, close + 2);
		cursor = close + 2;

		const inner = source.slice(open + 2, close);
		// `[[a]]b]]`、`[[a[b]]` 这类显然不是双链，直接跳过；跨行同理
		if (inner.includes("[") || inner.includes("]") || inner.includes("\n")) {
			continue;
		}

		const pipeAt = inner.indexOf("|");
		const targetPart = pipeAt < 0 ? inner : inner.slice(0, pipeAt);
		const textPart = pipeAt < 0 ? "" : inner.slice(pipeAt + 1);

		const hashAt = targetPart.indexOf("#");
		const slug = (hashAt < 0 ? targetPart : targetPart.slice(0, hashAt)).trim();
		const anchor = hashAt < 0 ? "" : targetPart.slice(hashAt + 1).trim();

		// 空 slug 不处理：`[[]]`、`[[#标题]]`、`[[ |文字]]` 都当普通文本
		if (slug === "") continue;
		// 不像 slug 的写法（shell 片段、算式等）原样留着，不算断链
		if (!SLUG_PATTERN.test(slug)) continue;

		// 到这里才是一条真正的双链，再问转义：保证 isEscaped 的调用顺序
		// 和 token 在文本里的顺序一致（插件侧靠这个顺序推进源码游标）。
		const escaped = options.isEscaped
			? options.isEscaped({ start: open, raw })
			: isEscaped(source, open);
		if (escaped) continue;

		const text = textPart.trim();
		const token: WikiLinkToken = {
			target: slug,
			start: open,
			end: close + 2,
			raw,
		};
		if (anchor !== "") token.anchor = anchor;
		if (text !== "") token.text = text;
		tokens.push(token);
	}

	return tokens;
}

/** 反向链接索引里的一篇文章（从出链方的条目裁剪出来）。 */
export interface BacklinkSource {
	slug: string;
	title: string;
	description: string;
	published: Date;
	url: string;
}

/** 出链记录：插件写进 frontmatter 的结构，也是反向索引的输入。 */
export interface OutlinkRecord {
	slug: string;
	/** `[[slug|文字]]` 里的自定义文字；没写就没有。 */
	text?: string;
	/** `[[slug#标题]]` 里的锚点（原始中文）。 */
	anchor?: string;
	/** 目标文章是否存在，断链为 false。 */
	resolved: boolean;
}

/** 反向索引的输入：一条出链 + 出链方文章信息（出链方 slug 由 Map 的 key 提供）。 */
export interface ResolvedOutlink extends OutlinkRecord {
	/** 被指向的目标 slug，等同 `OutlinkRecord.slug`，这里换个名字让调用点更直白。 */
	target: string;
	/** 出链方文章，用来填反向链接卡片。 */
	source: BacklinkSource;
}

/**
 * 由「每篇文章的出链」反转出「每篇文章被谁引用」。
 *
 * - 同一篇文章多次链接同一目标只算一条（顺便保留第一次出现的显示文字）；
 * - 自引用（A 链到 A）直接丢弃，因为对读者没有意义；
 * - 只认已解析的目标（`resolved === true`），断链不产生反向链接；
 * - 结果按 `maxPerTarget` 截断，排序完全交给调用方，纯函数不做时间比较，
 *   保证同输入同输出。
 */
export function buildBacklinkIndex(
	outlinksBySlug: Map<string, readonly ResolvedOutlink[]>,
	maxPerTarget = Number.POSITIVE_INFINITY,
): Map<string, BacklinkSource[]> {
	const index = new Map<string, BacklinkSource[]>();

	for (const [sourceSlug, outlinks] of outlinksBySlug) {
		const seen = new Set<string>();

		for (const outlink of outlinks) {
			const { target } = outlink;
			if (!outlink.resolved) continue;
			// 自引用不算「被引用」
			if (target === sourceSlug) continue;
			if (seen.has(target)) continue;
			seen.add(target);

			const bucket = index.get(target);
			if (bucket) bucket.push(outlink.source);
			else index.set(target, [outlink.source]);
		}
	}

	if (Number.isFinite(maxPerTarget) && maxPerTarget >= 0) {
		for (const [target, sources] of index) {
			index.set(target, sources.slice(0, maxPerTarget));
		}
	}

	return index;
}
