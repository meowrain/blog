import { siteConfig } from "@/config";
import { noteAnchor, noteHeading } from "@/utils/personal-core";
import { getSortedNotes } from "@/utils/personal-utils";
import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

const markdownParser = new MarkdownIt();

/**
 * 碎碎念单独一份 RSS：它们没有 `/posts/` 详情页，条目只能链到 `/notes/#锚点`。
 * 和文章 feed 分开，订了文章 feed 的人不会被短笔记刷屏。
 */
export async function GET(context: APIContext) {
	if (!context.site) throw new Error("site not set");

	const notes = await getSortedNotes();

	return rss({
		title: `${siteConfig.title} · 碎碎念`,
		description: "短笔记和随手记。",
		site: context.site,
		items: notes.map((note) => {
			const body = markdownParser.render(note.body ?? "");
			return {
				title: noteHeading({
					title: note.data.title,
					published: note.data.published,
					body: note.body,
				}),
				pubDate: note.data.published,
				link: `/notes/#${noteAnchor(note.slug)}`,
				content: sanitizeHtml(body, {
					allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
				}),
			};
		}),
		customData: `<language>${siteConfig.lang}</language>`,
	});
}
