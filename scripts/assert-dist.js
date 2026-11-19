// 构建产物守卫：`pnpm build` 的最后一道闸。
//
// 背景：EdgeOne 的静态资源构建器只认构建命令的退出码，退出码为 0 就直接去拷贝
// outputDirectory。2026-11-19 那次部署里 astro 在「Syncing content」之后被提前
// 终止，pnpm 却把退出码报成 0，平台于是拿着一个根本没被创建的 dist 去打包，
// 最后只留下一句 `ENOENT: no such file or directory, lstat '.../dist'`。
//
// 这里在 astro build 之后显式核对产物：缺关键文件或页面数明显不对就以非零码退出，
// 让平台把这次构建当失败，而不是静默上线一个空站点。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

// 阈值故意放得很低：这里只负责抓「整次构建没产出」这类事故。
// 页面数会随文章增删变化，定死了反而每次都要改。
const MIN_HTML_PAGES = 100;

// 这几个文件覆盖了站点最主要的产出路径：首页、错误页、RSS、sitemap、客户端资源。
const REQUIRED_FILES = [
  'index.html',
  '404.html',
  'rss.xml',
  'sitemap-index.xml',
  '_astro',
];

function fail(reason) {
  console.error(`[assert-dist] ✘ ${reason}`);
  console.error('[assert-dist] dist 不完整，构建视为失败');
  process.exit(1);
}

function countHtmlPages(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countHtmlPages(full);
    else if (entry.isFile() && entry.name.endsWith('.html')) count += 1;
  }
  return count;
}

if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
  fail(`dist 目录不存在：${distDir}`);
}

for (const name of REQUIRED_FILES) {
  if (!fs.existsSync(path.join(distDir, name))) {
    fail(`缺少 dist/${name}`);
  }
}

const pages = countHtmlPages(distDir);
if (pages < MIN_HTML_PAGES) {
  fail(`只产出 ${pages} 个 HTML 页面（下限 ${MIN_HTML_PAGES}）`);
}

console.log(`[assert-dist] ✓ dist 完整，共 ${pages} 个 HTML 页面`);
