/**
 * 本地开发用的搜索索引路径修正（只在 astro dev 生效）。
 *
 * 索引端点的 URL 都以 `.json` 结尾（`/search-index/shard/7.json`），静态托管直接按文件
 * 返回。但站点的 `trailingSlash` 是 `always`，Astro dev 的路由匹配会把动态段
 * （`[shard]`）当成需要补斜杠的页面，于是 `/search-index/shard/7.json` 在 dev 里 404，
 * 只有 `/search-index/shard/7.json/` 能命中 —— 浏览器请求的是前者。
 *
 * 这里在 Astro 路由之前把这类请求改写成带斜杠的形式，dev 与线上行为就一致了。
 */

const PREFIX = "/search-index/";

export function devSearchIndex() {
	return {
		name: "dev-search-index",
		apply: "serve",
		configureServer(server) {
			server.middlewares.use((req, _res, next) => {
				const rawUrl = req.url ?? "";
				const pathname = rawUrl.split("?")[0];
				if (!pathname.startsWith(PREFIX) || pathname.endsWith("/")) {
					return next();
				}
				if (!pathname.endsWith(".json")) return next();
				req.url = rawUrl.replace(pathname, `${pathname}/`);
				next();
			});
		},
	};
}

export default devSearchIndex;
