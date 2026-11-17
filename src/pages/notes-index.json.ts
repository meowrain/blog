import {
	isSealed,
	noteAnchor,
	noteHeading,
	toPlainText,
} from "@utils/personal-core";
import { getSortedNotes } from "@utils/personal-utils";
import type { APIContext } from "astro";

const EXCERPT_CHARS = 200;

/**
 * 碎碎念索引，给 `/find`、`/assistant` 的 `read_notes` 工具用：agent 主动来拉这份静态文件，
 * 和文章走的 `/posts-index.json` 是一套路子。
 *
 * ⚠️ 封存中的时间胶囊（`unlockAt` 还没到）整条不进索引：正文留在页面 HTML 里只是仪式感
 * （见 src/content/config.ts:55-57），但让 agent 把它讲出来等于提前拆封。
 * 只留一个 `sealedCount`，够模型回答「还有几条封存中」，不够它编内容。
 */
export async function GET(_context: APIContext) {
	// getSortedNotes 已按「置顶优先 + 发布时间倒序」排好，和 /notes/ 页面的顺序一致
	const notes = (await getSortedNotes()).filter(
		(note) => note.data.draft !== true,
	);
	const now = new Date();

	const open = notes.filter((note) => !isSealed(note.data.unlockAt, now));

	const payload = {
		generatedAt: now.toISOString(),
		count: open.length,
		sealedCount: notes.length - open.length,
		notes: open.map((note) => ({
			published: note.data.published.toISOString().slice(0, 10),
			// 没写 title 的用正文首句兜底，跟时间线用的是同一个函数
			title: noteHeading({
				title: note.data.title,
				published: note.data.published,
				body: note.body,
			}),
			tags: note.data.tags,
			mood: note.data.mood,
			location: note.data.location,
			pinned: note.data.pinned,
			excerpt: toPlainText(note.body ?? "").slice(0, EXCERPT_CHARS),
			url: `/notes/#${noteAnchor(note.slug)}`,
		})),
	};

	return new Response(JSON.stringify(payload), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			// 和文章索引一样是构建期产物：短暂缓存即可，改了碎碎念要重新构建
			"Cache-Control": "public, max-age=600",
		},
	});
}
