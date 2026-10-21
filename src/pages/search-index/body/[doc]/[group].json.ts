import { getSearchArtifacts } from "@utils/search-index-builder";
import type { APIContext } from "astro";

/**
 * 正文块文件：`/search-index/body/12/1.json` 是 12 号文档的第 2 组正文块。
 *
 * 只有命中的搜索结果才会来取，所以正文不会随索引一起下发；
 * 分组大小见 `search-index.ts` 的 `CHUNKS_PER_FILE`。
 */
export async function getStaticPaths() {
	const { bodies } = await getSearchArtifacts();
	return bodies.map((body) => ({
		params: { doc: String(body.doc), group: String(body.group) },
	}));
}

export async function GET({ params }: APIContext) {
	const doc = Number.parseInt(params.doc ?? "", 10);
	const group = Number.parseInt(params.group ?? "", 10);
	const { bodies } = await getSearchArtifacts();
	const body = bodies.find((item) => item.doc === doc && item.group === group);

	if (!body) {
		return new Response(JSON.stringify({ chunks: [], start: 0 }), {
			status: 404,
			headers: { "Content-Type": "application/json; charset=utf-8" },
		});
	}

	return new Response(
		JSON.stringify({
			doc: body.doc,
			group: body.group,
			start: body.start,
			chunks: body.chunks,
		}),
		{
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "public, max-age=86400",
			},
		},
	);
}
