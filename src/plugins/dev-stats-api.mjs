/**
 * 本地开发用的访问统计中间件（只在 astro dev 生效，build 时被 apply:"serve" 丢掉）。
 *
 * 线上 /api/stats/* 由 EdgeOne 云函数 cloud-functions/api/stats/[[default]].js 提供，
 * astro dev 不会挂载云函数，本地打开 /stats/ 就只会空着。这里直接复用同一个
 * onRequest —— 本地与线上行为一致，只负责 Node 侧请求/响应搬运。
 *
 * 注意：Blob 存储需要 EdgeOne 凭据，本地没登录时云函数会报错，页面显示“加载失败”。
 * 想在本地看真实数据，可 `edgeone login` 后在边缘跑；仅做界面联调时不影响。
 * clientIp 在本地取不到，用一个占位 IP 兜底（访客去重仍能工作）。
 */

import { onRequest } from "../../cloud-functions/api/stats/[[default]].js";

// 前端请求形如 /api/stats/page?...（子路径后面没有斜杠），所以这里按前缀
// `/api/stats` 匹配、再用边界判断，避免误吃 /api/statsfoo。
const PREFIX = "/api/stats";

export function devStatsApi() {
	return {
		name: "dev-stats-api",
		apply: "serve",
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				let rawUrl = req.url ?? "";
				let pathname = rawUrl.split("?")[0];
				if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) {
					return next();
				}
				// Astro dev 的 trailingSlash: "always" 会把 /api/stats/page 当无斜杠页面 404，
				// 与 devSearchIndex 同样的处理：补上尾斜杠再交给云函数。
				if (pathname.startsWith(`${PREFIX}/`) && !pathname.endsWith("/")) {
					rawUrl = rawUrl.replace(pathname, `${pathname}/`);
					pathname = `${pathname}/`;
				}

				try {
					const chunks = [];
					for await (const chunk of req) chunks.push(chunk);
					const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

					const headers = new Headers();
					for (const [key, value] of Object.entries(req.headers)) {
						if (typeof value === "string") headers.set(key, value);
					}

					const request = new Request(new URL(rawUrl, "http://localhost"), {
						method: req.method ?? "GET",
						headers,
						body:
							req.method === "GET" || req.method === "HEAD" ? undefined : body,
					});
					const response = await onRequest({
						request,
						env: process.env,
						clientIp: "127.0.0.1",
					});
					res.statusCode = response.status;
					response.headers.forEach((value, key) => {
						res.setHeader(key, value);
					});
					res.end(await response.text());
				} catch (error) {
					res.statusCode = 502;
					res.setHeader("content-type", "application/json; charset=utf-8");
					res.end(
						JSON.stringify({
							error: `本地统计代理失败：${error instanceof Error ? error.message : String(error)}`,
						}),
					);
				}
			});
		},
	};
}

export default devStatsApi;
