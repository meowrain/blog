/**
 * Bangumi 同源代理 —— EdgeOne Pages Function
 *
 * 路由由文件路径决定：本文件对应 `/api/bangumi/*`。
 * 页面里 `PUBLIC_BANGUMI_API_BASE` 默认为 `/api/bangumi`，请求路径这样映射：
 *
 *   /api/bangumi/v0/users/<name>/collections?subject_type=2&type=3
 *     -> https://api.bgm.tv/v0/users/<name>/collections?subject_type=2&type=3
 *   /api/bangumi/img/lain.bgm.tv/pic/cover/l/xx.jpg
 *     -> https://lain.bgm.tv/pic/cover/l/xx.jpg
 *
 * 之所以要代理：api.bgm.tv 与 lain.bgm.tv 在部分网络里会被 DNS 污染，
 * 浏览器直连既取不到数据也取不到封面。
 *
 * 只放行 bgm.tv 域名、只接受 GET、不转发 Cookie / Authorization，
 * 因此这里不是一个可以访问任意地址的开放代理。
 */

const API_PREFIX = "/api/bangumi/";
const TIMEOUT_MS = 10000;
const DEFAULT_UPSTREAM_UA =
  "meowrain-blog-bangumi/1.0 (+https://blog.meowrain.cn/bangumi/)";

// api.bgm.tv 之外的封面/头像域名都归到这两台，收紧白名单避免被当成图床代理。
const ALLOWED_IMAGE_HOSTS = new Set(["lain.bgm.tv", "other.bgm.tv", "bgm.tv"]);

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function jsonResponse(body, status, headers = JSON_HEADERS) {
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(message, status) {
  return jsonResponse({ title: message, description: "bangumi proxy", status }, status);
}

/**
 * 把 /api/bangumi/ 之后的路径映射成上游 URL。
 * 返回 null 表示不在放行范围内。
 */
export function resolveUpstream(pathname, search = "") {
  if (!pathname.startsWith(API_PREFIX)) return null;

  // pathname 正常不该带 query / hash，这里再剥一次，避免拼出两个 "?"。
  const rawPath = pathname.split("?")[0].split("#")[0].slice(API_PREFIX.length);
  const segments = rawPath.split("/");

  if (segments.length === 0 || segments.some((part) => part === "" || part === "." || part === "..")) {
    return null;
  }

  const [first, ...rest] = segments;

  if (first === "v0") {
    if (rest.length === 0) return null;
    return `https://api.bgm.tv/v0/${rest.join("/")}${search}`;
  }

  if (first === "img") {
    const host = (rest[0] || "").toLowerCase();
    if (!ALLOWED_IMAGE_HOSTS.has(host) || rest.length < 2) return null;
    return `https://${host}/${rest.slice(1).join("/")}${search}`;
  }

  return null;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse("只支持 GET 请求", 405);
  }

  const url = new URL(request.url);
  const target = resolveUpstream(url.pathname, url.search);

  if (!target) {
    return errorResponse("不支持的代理路径", 404);
  }

  const isImageRequest = url.pathname.startsWith(`${API_PREFIX}img/`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(target, {
      method: "GET",
      // 只带必要的请求头：不转发 Cookie 与 Authorization，避免代理带上网民的凭据。
      headers: {
        Accept: isImageRequest ? "image/avif,image/webp,image/*,*/*" : "application/json",
        "User-Agent": env?.BANGUMI_UPSTREAM_USER_AGENT || DEFAULT_UPSTREAM_UA,
      },
      redirect: "follow",
      signal: controller.signal,
    });

    const headers = new Headers();
    headers.set(
      "content-type",
      upstream.headers.get("content-type") || (isImageRequest ? "image/jpeg" : "application/json; charset=utf-8"),
    );
    headers.set(
      "cache-control",
      isImageRequest
        ? "public, max-age=86400"
        : "public, max-age=120, stale-while-revalidate=600",
    );
    headers.set("x-upstream-status", String(upstream.status));

    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    const aborted = error?.name === "AbortError";
    return errorResponse(aborted ? "上游请求超时" : "代理请求失败", aborted ? 504 : 502);
  } finally {
    clearTimeout(timer);
  }
}
