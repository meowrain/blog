/**
 * 个人主页相关纯函数：不依赖 astro:content，方便在 Node 里直接跑单元测试。
 * 数据集合的读写放在 personal-utils.ts，这里只管排序、日期和摘要。
 */

export interface NoteLike {
	pinned: boolean;
	published: Date;
}

export interface ProjectLike {
	order?: number;
	featured: boolean;
	published: Date;
}

/**
 * frontmatter 里的时间不带时区，YAML 解析器会当成 UTC。
 * 这里按 UTC 取年月日，显示的正好是作者写下的那个日期，和文章页
 * `formatDateToYYYYMMDD`（toISOString 截断）保持同一套规则。
 */
export function formatContentDate(date: Date): string {
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/** 碎碎念时间线用的「日期 + 时分」，同样按 frontmatter 里写的字面值显示。 */
export function formatContentDateTime(date: Date): string {
	const hours = String(date.getUTCHours()).padStart(2, "0");
	const minutes = String(date.getUTCMinutes()).padStart(2, "0");
	return `${formatContentDate(date)} ${hours}:${minutes}`;
}

/** Markdown → 单行纯文本。碎碎念摘要只需要文字，不还原排版。 */
export function toPlainText(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/~~~[\s\S]*?~~~/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/<[^>]+>/g, " ")
		.replace(/^#{1,6}\s+/gm, " ")
		.replace(/^>\s?/gm, " ")
		.replace(/[*_`~|]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * 没写 title 的碎碎念用正文第一句当标题。
 * 第一句过长时截断，避免时间线里出现一大段文字。
 */
export function noteHeading(
	note: { title?: string; published: Date; body?: string },
	maxChars = 60,
): string {
	const title = (note.title ?? "").trim();
	if (title) return title;

	const text = toPlainText(note.body ?? "");
	if (!text) return formatContentDate(note.published);

	const firstSentence = text.split(/(?<=[。！？!?])\s*/)[0] ?? text;
	return firstSentence.length > maxChars
		? `${firstSentence.slice(0, maxChars)}…`
		: firstSentence;
}

/** 锚点：slug 里的斜杠和空白换成连字符，中文原样保留。 */
export function noteAnchor(slug: string): string {
	return slug.replace(/[/\s]+/g, "-");
}

/** 碎碎念排序：置顶优先，其余按发布时间倒序。 */
export function compareNotes(a: NoteLike, b: NoteLike): number {
	if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
	return b.published.getTime() - a.published.getTime();
}

/** 项目排序：order 小的在前；没写 order 的按精选优先、发布时间倒序兜底。 */
export function compareProjects(a: ProjectLike, b: ProjectLike): number {
	const orderA = a.order ?? Number.POSITIVE_INFINITY;
	const orderB = b.order ?? Number.POSITIVE_INFINITY;
	if (orderA !== orderB) return orderA - orderB;

	if (a.featured !== b.featured) return a.featured ? -1 : 1;
	return b.published.getTime() - a.published.getTime();
}

/** 从第一篇文章到今年，头尾都算一年。没有文章时返回 0。 */
export function writingYearsSince(
	first: Date | null,
	now = new Date(),
): number {
	if (!first) return 0;
	return Math.max(1, now.getFullYear() - first.getFullYear() + 1);
}

export type ProjectStatus = "active" | "wip" | "archived";

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
	active: "维护中",
	wip: "进行中",
	archived: "已归档",
};

export const PROJECT_STATUS_ICONS: Record<ProjectStatus, string> = {
	active: "material-symbols:check-circle-outline-rounded",
	wip: "material-symbols:build-outline-rounded",
	archived: "material-symbols:archive-outline-rounded",
};

export interface TagCount {
	name: string;
	count: number;
}

/** 统计标签出现次数，数量倒序、同数量按名称排序，取前 limit 个。 */
export function topTagsOf(
	tagLists: readonly (readonly string[])[],
	limit = 12,
): TagCount[] {
	const counter = new Map<string, number>();
	for (const tags of tagLists) {
		for (const tag of tags) {
			if (!tag) continue;
			counter.set(tag, (counter.get(tag) ?? 0) + 1);
		}
	}
	return [...counter.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"))
		.slice(0, limit);
}
