/**
 * 本地开发用的音乐接口中间件（只在 astro dev 生效，build 时被 apply:"serve" 丢掉）。
 *
 * 线上 /api/music/* 由 EdgeOne 云函数 cloud-functions/api/music/[[default]].js 提供，
 * 但 astro dev 不会挂载云函数，本地打开 /music/ 就只剩一个空壳。这里直接把同一个
 * onRequest 拿来用 —— 同一个文件，本地与线上行为一致 —— 只负责 Node 侧请求/响应
 * 的搬运。
 *
 * 想在本地听会员歌：NETEASE_COOKIE="MUSIC_U=xxx" pnpm dev
 * （只在本机进程里生效，不会写进构建产物。）
 */

import { onRequest } from "../../cloud-functions/api/music/[[default]].js";

const PREFIX = "/api/music/";

export function devMusicApi() {
	return {
		name: "dev-music-api",
		apply: "serve",
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				const rawUrl = req.url ?? "";
				if (!rawUrl.startsWith(PREFIX)) return next();

				try {
					// 客户端请求头一个都不转给上游，云函数只认它自己那套头
					const request = new Request(new URL(rawUrl, "http://localhost"), {
						method: req.method ?? "GET",
					});
					const response = await onRequest({ request, env: process.env });
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
							error: `本地音乐代理失败：${error instanceof Error ? error.message : String(error)}`,
						}),
					);
				}
			});
		},
	};
}

export default devMusicApi;