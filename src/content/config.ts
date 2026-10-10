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
