import fs from "node:fs";
import path from "node:path";

/**
 * 本地开发用的图床中间件（只在 astro dev 生效，build 时被 apply:"serve" 丢掉）。
 *
 * 线上相册的图片走 EdgeOne Pages Function `functions/api/i/[[path]].js`
 * 代理到 CNB 图床仓库；`astro dev` 不跑 Pages Function，所以本地打开 /gallery/
 * 拿不到 images.json，也拿不到缩略图。这里把同一段路径直接映射到本地图床仓库的
 * public/api/i 目录，本地就能看到和线上一致的表现（包括 _t/ 缩略图）。
 *
 * 图床仓库位置：默认取兄弟目录 ../img-bed/public/api/i，
 * 想换位置用环境变量 GALLERY_BED_DIR 覆盖。目录不存在时中间件直接放行，
 * 行为跟加这个插件之前一样。
 */

const PREFIX = "/api/i/";

const CONTENT_TYPES = {
	webp: "image/webp",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	avif: "image/avif",
	bmp: "image/bmp",
	svg: "image/svg+xml",
	ico: "image/x-icon",
	json: "application/json; charset=utf-8",
	mp4: "video/mp4",
	webm: "video/webm",
};

function contentTypeFor(filePath) {
	const ext = path.extname(filePath).slice(1).toLowerCase();
	return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export function devImageBed(options = {}) {
	const bedDir = path.resolve(
		options.dir ?? process.env.GALLERY_BED_DIR ?? "../img-bed/public/api/i",
	);

	return {
		name: "dev-image-bed",
		apply: "serve",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const rawUrl = req.url ?? "";
				if (!rawUrl.startsWith(PREFIX)) return next();
				if (!fs.existsSync(bedDir)) return next();

				const pathname = rawUrl.split("?")[0];
				let rel;
				try {
					rel = decodeURIComponent(pathname.slice(PREFIX.length));
				} catch {
					return next();
				}
				if (!rel || rel.split("/").some((seg) => seg === ".." || seg === ".")) {
					return next();
				}

				const file = path.resolve(bedDir, rel);
				if (!file.startsWith(bedDir + path.sep) && file !== bedDir) {
					return next();
				}
				if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
					res.statusCode = 404;
					res.setHeader("Content-Type", "application/json; charset=utf-8");
					res.end('{"errcode": 404, "errmsg": "Not Found"}');
					return;
				}

				const stat = fs.statSync(file);
				res.setHeader("Content-Type", contentTypeFor(file));
				res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
				res.setHeader("Access-Control-Allow-Origin", "*");
				// 本地图纸会随 npm run thumbs 变化，别让它进浏览器缓存
				res.setHeader("Cache-Control", "no-store");
				res.setHeader("Last-Modified", stat.mtime.toUTCString());
				res.setHeader(
					"Etag",
					`W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`,
				);

				if (req.method === "HEAD") {
					res.setHeader("Content-Length", String(stat.size));
					res.end();
					return;
				}

				fs.createReadStream(file).pipe(res);
			});
		},
	};
}

export default devImageBed;
