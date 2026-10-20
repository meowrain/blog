import { defineCollection, z } from "astro:content";

const postsCollection = defineCollection({
	schema: z.object({
		title: z.string(),
		published: z.date(),
		updated: z.date().optional(),
		draft: z.boolean().optional().default(false),
		description: z.string().optional().default(""),
		image: z.string().optional().default(""),
		// 列表卡片用的小封面，由 scripts/compress-covers.js 生成并写回 frontmatter。
		// 留空时 PostCard 回退到 image 原图，正文封面/RSS 始终用 image。
		thumb: z.string().optional().default(""),
		tags: z.array(z.string()).optional().default([]),
		category: z.union([z.string(), z.array(z.string())]).optional(),
		lang: z.string().optional().default(""),
		pinned: z.boolean().optional().default(false),
		// 系列（合集）名：同一 series 的文章按 seriesOrder / 发布时间排成章节，
		// 正文顶部会渲染「上一章 / 下一章 + 进度条」。留空表示不属于任何系列。
		series: z.string().optional().default(""),
		// 章节序号，留空按发布时间排序；合集这类固定阅读顺序的系列用它指定。
		seriesOrder: z.number().optional(),

		/* For internal use */
		prevTitle: z.string().default(""),
		prevSlug: z.string().default(""),
		nextTitle: z.string().default(""),
		nextSlug: z.string().default(""),
	}),
});

const assetsCollection = defineCollection({
	type: "data",
	schema: z.object({
		title: z.string().optional(),
		description: z.string().optional(),
	}),
});

/**
 * 碎碎念：短笔记。没写 title 也能发，列表页直接把正文铺出来，
 * 不要求每一条都够得上一篇「文章」。
 */
const notesCollection = defineCollection({
	schema: z.object({
		published: z.date(),
		title: z.string().optional().default(""),
		tags: z.array(z.string()).optional().default([]),
		draft: z.boolean().optional().default(false),
		// 置顶的碎碎念会排在最前面，适合放「关于这个页面」之类的说明
		pinned: z.boolean().optional().default(false),
		mood: z.string().optional().default(""),
		location: z.string().optional().default(""),
	}),
});

/** 项目：卡片里放简介和链接，详情页用 Markdown 正文补充背景。 */
const projectsCollection = defineCollection({
	schema: z.object({
		title: z.string(),
		description: z.string().optional().default(""),
		url: z.string().optional().default(""),
		repo: z.string().optional().default(""),
		icon: z
			.string()
			.optional()
			.default("material-symbols:rocket-launch-outline-rounded"),
		tags: z.array(z.string()).optional().default([]),
		status: z.enum(["active", "wip", "archived"]).optional().default("active"),
		featured: z.boolean().optional().default(false),
		// 数字越小越靠前；不写就按发布时间倒序
		order: z.number().optional(),
		published: z.date(),
		draft: z.boolean().optional().default(false),
	}),
});

/** 关于页的正文，只放一个 about.md。 */
const aboutCollection = defineCollection({
	schema: z.object({
		title: z.string().optional().default("关于我"),
		description: z.string().optional().default(""),
		updated: z.date().optional(),
	}),
});

export const collections = {
	posts: postsCollection,
	assets: assetsCollection,
	notes: notesCollection,
	projects: projectsCollection,
	about: aboutCollection,
};
