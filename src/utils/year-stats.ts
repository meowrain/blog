import type { CollectionEntry } from "astro:content";
import { getPostCategories } from "./category-utils";
import { getSortedPosts } from "./content-utils";

/** 单篇文章在年报里的样子 */
export interface YearPostStat {
	slug: string;
	title: string;
	published: Date;
	words: number;
	minutes: number;
	tags: string[];
	categories: string[];
}

export interface YearCount {
	name: string;
	count: number;
}

export interface YearMonthStat {
	month: number;
	count: number;
}

export interface YearBusiestDay {
	date: Date;
	count: number;
}

export interface YearHighlight {
	longest: YearPostStat | null;
	shortest: YearPostStat | null;
	first: YearPostStat | null;
	last: YearPostStat | null;
	busiestDay: YearBusiestDay | null;
}

export interface YearComparison {
	year: number;
	postCount: number;
	words: number;
	postDelta: number;
	wordDelta: number;
}

export interface YearReport {
	year: number;
	postCount: number;
	words: number;
	minutes: number;
	averageWords: number;
	activeDays: number;
	longestStreak: number;
	months: YearMonthStat[];
	hours: number[];
	weekdays: number[];
	topTags: YearCount[];
	categories: YearCount[];
	posts: YearPostStat[];
	highlight: YearHighlight;
	comparison: YearComparison | null;
}

const DAY_MS = 86_400_000;

/** 本地时间的日序号，用来判断「相邻两天」而不受时区和夏令时影响 */
function dayIndex(date: Date): number {
	return Math.floor(
		Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS,
	);
}

function countNames(names: string[]): YearCount[] {
	const counter = new Map<string, number>();
	for (const name of names) {
		counter.set(name, (counter.get(name) ?? 0) + 1);
	}
	return [...counter.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"));
}

async function toPostStat(
	entry: CollectionEntry<"posts">,
): Promise<YearPostStat> {
	// words / minutes 由 remark-reading-time 在构建期写进 frontmatter，
	// 和文章卡片、详情页显示的是同一份数字。
	const { remarkPluginFrontmatter } = await entry.render();
	return {
		slug: entry.slug,
		title: entry.data.title,
		published: new Date(entry.data.published),
		words: Number(remarkPluginFrontmatter.words) || 0,
		minutes: Number(remarkPluginFrontmatter.minutes) || 0,
		tags: entry.data.tags ?? [],
		categories: getPostCategories(entry),
	};
}

function longestStreakOf(dayIndexes: number[]): number {
	const unique = [...new Set(dayIndexes)].sort((a, b) => a - b);
	let best = 0;
	let current = 0;
	let previous: number | null = null;
	for (const index of unique) {
		current = previous !== null && index - previous === 1 ? current + 1 : 1;
		best = Math.max(best, current);
		previous = index;
	}
	return best;
}

function buildYearReport(year: number, list: YearPostStat[]): YearReport {
	const posts = [...list].sort(
		(a, b) => a.published.getTime() - b.published.getTime(),
	);

	const words = posts.reduce((sum, post) => sum + post.words, 0);
	const minutes = posts.reduce((sum, post) => sum + post.minutes, 0);

	const months: YearMonthStat[] = Array.from({ length: 12 }, (_, i) => ({
		month: i + 1,
		count: 0,
	}));
	const hours: number[] = Array.from({ length: 24 }, () => 0);
	const weekdays: number[] = Array.from({ length: 7 }, () => 0);
	const days = new Map<number, YearBusiestDay>();

	for (const post of posts) {
		months[post.published.getMonth()].count += 1;
		hours[post.published.getHours()] += 1;
		weekdays[post.published.getDay()] += 1;

		const index = dayIndex(post.published);
		const day = days.get(index);
		if (day) {
			day.count += 1;
		} else {
			days.set(index, { date: post.published, count: 1 });
		}
	}

	let busiestDay: YearBusiestDay | null = null;
	for (const day of days.values()) {
		if (
			busiestDay === null ||
			day.count > busiestDay.count ||
			(day.count === busiestDay.count && day.date < busiestDay.date)
		) {
			busiestDay = day;
		}
	}

	// 纯图文章（reading-time 算不出字）不参与「最长/最短」，免得「最短的一篇」是 0 字
	const byWords = [...posts]
		.filter((post) => post.words > 0)
		.sort((a, b) => b.words - a.words);

	return {
		year,
		postCount: posts.length,
		words,
		minutes,
		averageWords: posts.length > 0 ? Math.round(words / posts.length) : 0,
		activeDays: days.size,
		longestStreak: longestStreakOf([...days.keys()]),
		months,
		hours,
		weekdays,
		topTags: countNames(posts.flatMap((post) => post.tags)),
		categories: countNames(posts.flatMap((post) => post.categories)),
		posts: [...posts].reverse(),
		highlight: {
			longest: byWords[0] ?? null,
			shortest: byWords.length > 1 ? byWords[byWords.length - 1] : null,
			first: posts[0] ?? null,
			last: posts.length > 1 ? posts[posts.length - 1] : null,
			busiestDay,
		},
		comparison: null,
	};
}

/** 把全部文章聚合成按年份倒序的年度报告，年份取 published 的本地时间年份 */
export async function buildYearReports(
	posts: CollectionEntry<"posts">[],
): Promise<YearReport[]> {
	const stats = await Promise.all(posts.map((post) => toPostStat(post)));

	const byYear = new Map<number, YearPostStat[]>();
	for (const stat of stats) {
		const year = stat.published.getFullYear();
		const bucket = byYear.get(year);
		if (bucket) {
			bucket.push(stat);
		} else {
			byYear.set(year, [stat]);
		}
	}

	const reports = [...byYear.entries()]
		.map(([year, list]) => buildYearReport(year, list))
		.sort((a, b) => b.year - a.year);

	const lookup = new Map(reports.map((report) => [report.year, report]));
	for (const report of reports) {
		const previous = lookup.get(report.year - 1);
		if (!previous) continue;
		report.comparison = {
			year: previous.year,
			postCount: previous.postCount,
			words: previous.words,
			postDelta: report.postCount - previous.postCount,
			wordDelta: report.words - previous.words,
		};
	}

	return reports;
}

let cache: Promise<YearReport[]> | null = null;

/** 年报数据入口。生产构建下多个页面共用一个 Promise，避免重复渲染全部文章。 */
export async function getYearReports(): Promise<YearReport[]> {
	if (!import.meta.env.PROD) {
		// dev 下不缓存，改完文章刷新就能看到新数据
		return buildYearReports(await getSortedPosts());
	}
	if (!cache) {
		cache = getSortedPosts().then((posts) => buildYearReports(posts));
	}
	return cache;
}

export function formatNumber(value: number): string {
	return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 字数的口语化写法，超过一万就换成「x.x 万字」 */
export function formatWords(value: number): string {
	if (value < 10000) return `${formatNumber(value)} 字`;
	return `${(value / 10000).toFixed(1)} 万字`;
}

export function formatDuration(totalMinutes: number): string {
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours === 0) return `${minutes} 分钟`;
	if (minutes === 0) return `${hours} 小时`;
	return `${hours} 小时 ${minutes} 分钟`;
}
