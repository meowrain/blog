import { type CollectionEntry, getCollection } from "astro:content";
import { getSortedPosts } from "./content-utils";
import {
	compareNotes,
	compareProjects,
	topTagsOf,
	writingYearsSince,
} from "./personal-core";

export type NoteEntry = CollectionEntry<"notes">;
export type ProjectEntry = CollectionEntry<"projects">;
export type AboutEntry = CollectionEntry<"about">;

/** 草稿只在开发环境可见，和生产环境的文章保持一致。 */
function isVisible<T extends { data: { draft?: boolean } }>(entry: T): boolean {
	return import.meta.env.PROD ? entry.data.draft !== true : true;
}

/** 置顶的排最前，其余按发布时间倒序。 */
export async function getSortedNotes(): Promise<NoteEntry[]> {
	const notes = await getCollection("notes", isVisible);
	return notes.sort((a, b) => compareNotes(a.data, b.data));
}

/** 项目顺序：`order` → 精选 → 发布时间。首页卡片和 /projects/ 共用这一份。 */
export async function getSortedProjects(): Promise<ProjectEntry[]> {
	const projects = await getCollection("projects", isVisible);
	return projects.sort((a, b) => compareProjects(a.data, b.data));
}

/** 关于页正文。集合里只有一份 about.md，取不到时返回 null 让页面走兜底文案。 */
export async function getAboutEntry(): Promise<AboutEntry | null> {
	const entries = await getCollection("about");
	return entries[0] ?? null;
}

export interface PersonalStats {
	posts: number;
	notes: number;
	projects: number;
	/** 从第一篇文章算到现在，头尾都算一年。 */
	writingYears: number;
	firstPublished: Date | null;
	latestPublished: Date | null;
	seriesCount: number;
	topTags: { name: string; count: number }[];
}

/** 关于页 / 首页用的个人站点概览，数字全部来自内容集合。 */
export async function getPersonalStats(): Promise<PersonalStats> {
	const [posts, notes, projects] = await Promise.all([
		getSortedPosts(),
		getSortedNotes(),
		getSortedProjects(),
	]);

	const dates = posts.map((post) => post.data.published.getTime());
	const firstPublished = dates.length > 0 ? new Date(Math.min(...dates)) : null;
	const latestPublished =
		dates.length > 0 ? new Date(Math.max(...dates)) : null;

	return {
		posts: posts.length,
		notes: notes.length,
		projects: projects.length,
		writingYears: writingYearsSince(firstPublished),
		firstPublished,
		latestPublished,
		seriesCount: new Set(
			posts
				.map((post) => post.data.series)
				.filter((name): name is string => !!name),
		).size,
		topTags: topTagsOf(posts.map((post) => post.data.tags ?? [])),
	};
}
