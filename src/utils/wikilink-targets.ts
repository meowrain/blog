import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * 构建期把 `src/content/posts/**` 扫成「slug → 标题」表，给 remark 插件用。
 *
 * 为什么不走 `astro:content`：`astro.config.mjs` 在 Vite 起来之前求值，
 * `astro:content` 是 Vite 虚拟模块，那里 import 不到；而 `astro:config:done`
 * 里 Vite 的 module runner 已经关了。偏偏 remark 插件是同步注册的，
 * 拿不到异步的集合——所以这里用 Node 直接读文件：只需要 slug 和标题。
 *
 * 代价是有意为之的取舍：这里**不解析完整 frontmatter YAML**，只认文件开头
 * `---` 块里的一行 `title:`。站内所有文章标题都是这么写的，够用；
 * 真实是否存在、草稿过滤仍以 `astro:content` 为准（见 backlinks-utils）。
 */

export interface WikiTargetRaw {
	title: string;
	/** 标题列表在 remark 阶段拿不到，锚点校验放到构建后统一做 */
	headings: string[];
}

const FRONTMATTER_TITLE = /^title:\s*(.+?)\s*$/m;

/** 去掉 YAML 字符串的引号；单双引号都剥。 */
function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const first = trimmed[0];
		const last = trimmed[trimmed.length - 1];
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
			return trimmed.slice(1, -1);
		}
	}
	return trimmed;
}

/** 从文件内容里抠出 frontmatter 的 title；没有就退回文件名。 */
export function readTitleFromMarkdown(
	source: string,
	fallback: string,
): string {
	// frontmatter 必须是文件开头的 --- 块
	if (!source.startsWith("---")) return fallback;
	const end = source.indexOf("\n---", 3);
	const frontmatter = end < 0 ? "" : source.slice(3, end);
	const matched = frontmatter.match(FRONTMATTER_TITLE);
	return matched ? unquote(matched[1]) : fallback;
}

/** slug 规则对齐 Astro 的默认行为：去掉扩展名、去掉开头的序号目录。 */
function toSlug(relativePath: string): string {
	return relativePath.replace(/\.md$/, "");
}

/**
 * 扫一遍文章目录。目录不存在时返回空表（比如 CI 里只跑单测的场景）。
 */
export function scanWikiTargets(
	contentDir: string,
): Map<string, WikiTargetRaw> {
	const targets = new Map<string, WikiTargetRaw>();

	/**
	 * 递归收集目录下所有 .md。手写而不是用 `readdirSync({recursive})`：
	 * 后者的 `Dirent.parentPath` 是 Node 20.12 才有的，这里用绝对路径更稳。
	 */
	const walk = (dir: string): void => {
		/** @type {import("node:fs").Dirent[]} */
		let entries: import("node:fs").Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const absolute = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(absolute);
				continue;
			}
			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

			const slug = toSlug(
				path.relative(contentDir, absolute).split(path.sep).join("/"),
			);

			let source = "";
			try {
				source = readFileSync(absolute, "utf8");
			} catch {
				continue;
			}

			targets.set(slug, {
				title: readTitleFromMarkdown(source, slug),
				headings: [],
			});
		}
	};

	walk(contentDir);
	return targets;
}
