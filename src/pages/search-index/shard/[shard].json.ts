import { SHARD_COUNT } from "@utils/search-index";
import { getSearchArtifacts } from "@utils/search-index-builder";

/**
 * 倒排表分片。`/search-index/shard/7.json` 里是落到 7 号分片的全部词条。
 *
 * 分片由 `shardForTerm` 的哈希决定，客户端查询时算出自己要哪几片再来取；
 * 所以这里不做「按词查表」的接口，少一次服务端参与，也方便 CDN 长缓存。
 * 文件名不带内容哈希，靠客户端拼 `?v=<构建时间>` 让重新构建后缓存失效。
 */
export function getStaticPaths() {
	return Array.from({ length: SHARD_COUNT }, (_, shard) => ({
		params: { shard: String(shard) },
	}));
}

export async function GET({ params }: { params: { shard?: string } }) {
	const shard = Number.parseInt(params.shard ?? "", 10);
	const { shards } = await getSearchArtifacts();
	const terms = shards[shard] ?? {};

	return new Response(JSON.stringify(terms), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			// 分片内容随文章变化，构建期产物；缓存久一点，换文章重新构建即可
			"Cache-Control": "public, max-age=86400",
		},
	});
}
