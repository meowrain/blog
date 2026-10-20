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
		category: z.union([
			z.string(),
			z.array(z.string()),
		]).optional(),
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
	type: 'data',
	schema: z.object({
		title: z.string().optional(),
		description: z.string().optional(),
	}),
});

export const collections = {
	posts: postsCollection,
	assets: assetsCollection,
};
