/**
 * 本地开发用的语音合成接口中间件（只在 astro dev 生效，build 时被 apply:"serve" 丢掉）。
 *
 * 线上 /api/tts/* 由 EdgeOne 云函数 cloud-functions/api/tts/[[default]].js 提供，
 * 与音乐接口同理：astro dev 不会挂载云函数，本地电台串词就只剩浏览器语音。
 * 这里直接复用同一个 onRequest，只搬运 Node 侧的请求 / 响应。
 *
 * 合成要连微软的 WebSocket；公司网络 / 代理环境连不上时，前端会自动回落
 * 浏览器语音，不影响本地调试其它功能。
 */

import { onRequest } from "../../cloud-functions/api/tts/[[default]].js";

const PREFIX = "/api/tts/";

/** Node 的 IncomingMessage 不是标准 Request，读 body 要自己拼 */
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

export function devTtsApi() {
	return {
		name: "dev-tts-api",
		apply: "serve",
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				const rawUrl = req.url ?? "";
				if (!rawUrl.startsWith(PREFIX)) return next();

				try {
					const body = req.method === "POST" ? await readBody(req) : undefined;
					const request = new Request(new URL(rawUrl, "http://localhost"), {
						method: req.method ?? "GET",
						headers: {
							"content-type": req.headers["content-type"] ?? "application/json",
							"x-forwarded-for": req.socket.remoteAddress ?? "127.0.0.1",
						},
						body: body?.length ? body : undefined,
					});
					const response = await onRequest({ request, env: process.env });
					res.statusCode = response.status;
					response.headers.forEach((value, key) => {
						res.setHeader(key, value);
					});
					res.end(Buffer.from(await response.arrayBuffer()));
				} catch (error) {
					res.statusCode = 502;
					res.setHeader("content-type", "application/json; charset=utf-8");
					res.end(
						JSON.stringify({
							error: `本地语音代理失败：${error instanceof Error ? error.message : String(error)}`,
						}),
					);
				}
			});
		},
	};
}
