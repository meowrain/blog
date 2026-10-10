// 封面压缩：为文章 frontmatter 里的 image 生成小尺寸 WebP 缩略图，
// 落到 public/covers/，并在 frontmatter 的 image 行后面补一行 thumb: /covers/xxx.webp。
//
// 为什么要它：首页列表的封面槽位只有 62x200（手机）到 300x200（桌面）CSS 像素，
// 而 image 往往是手机直出的 3072x4534 / 3MB 原图。列表页会把它们全部下载并解码，
// 解码后的位图超出移动端浏览器的图片缓存就会被反复淘汰重解，表现为滚动卡顿。
// thumb 只给列表卡片用；image 保持原图，正文大图、RSS、Fancybox 不受影响。
//
// 用法：
//   node scripts/compress-covers.js            # 只处理缺失/过期的缩略图
//   node scripts/compress-covers.js --dry-run  # 看看会动哪些文件，不写盘
//   node scripts/compress-covers.js --force    # 全部重新生成
//   node scripts/compress-covers.js --max=1000 --quality=82
//
// 新增或换封面后跑一次即可（幂等：源图没变就不会重复下载、不会重复插 thumb 行）。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { glob } from "glob";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// 列表卡片实际渲染尺寸最长边约 600 设备像素，800 逻辑像素留了余量
const DEFAULT_MAX_EDGE = 800;
const DEFAULT_QUALITY = 80;

const argv = process.argv.slice(2);
const getFlag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.slice(name.length + 3)) : fallback;
};
const FORCE = argv.includes("--force");
const DRY_RUN = argv.includes("--dry-run");
const MAX_EDGE = getFlag("max", DEFAULT_MAX_EDGE);
const QUALITY = getFlag("quality", DEFAULT_QUALITY);

const COVERS_DIR = path.join(rootDir, "public", "covers");
const POSTS_GLOB = "src/content/posts/**/*.md";

function hash(text) {
  return crypto.createHash("sha1").update(text).digest("hex").slice(0, 10);
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)}KB`;
}

/** 读取裸文本 frontmatter，返回 [{key, value, lineIndex}] 与块边界（行号从 0 起）。 */
function parseFrontmatter(lines) {
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end === -1) return null;
  const entries = [];
  for (let i = 1; i < end; i++) {
    const m = lines[i].match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (m) entries.push({ key: m[1], value: unquote(m[2]), lineIndex: i });
  }
  return { start: 1, end, entries };
}

function unquote(raw) {
  const v = raw.trim();
  if (v.length >= 2 && /^(['"]).*\1$/.test(v)) return v.slice(1, -1);
  return v;
}

/** 缩略图文件名：保留原图 basename 便于辨认，再加源标识哈希防重名。 */
function thumbNameFor(sourceKey, originalValue) {
  const base = path
    .basename(originalValue.split(/[?#]/)[0])
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "")
    .slice(-48);
  const tag = hash(sourceKey);
  return `${base ? `${base}-` : "cover-"}${tag}.webp`;
}

/** 把 frontmatter 里的 image 值解析成磁盘上的源文件，或需要下载的 URL。 */
function resolveSource(mdFile, imageValue) {
  const relFromRoot = path.relative(rootDir, mdFile).replace(/\\/g, "/");
  if (/^https?:\/\//i.test(imageValue)) {
    return { kind: "remote", sourceKey: imageValue, url: imageValue, label: relFromRoot };
  }
  if (imageValue.startsWith("/")) {
    const local = path.join(rootDir, "public", imageValue.replace(/^\/+/, ""));
    return fs.existsSync(local)
      ? { kind: "local", sourceKey: imageValue, file: local, label: relFromRoot }
      : { kind: "missing", label: relFromRoot, detail: `public${imageValue} 不存在` };
  }
  // 相对路径相对于 md 文件所在目录
  const local = path.resolve(path.dirname(mdFile), imageValue);
  return fs.existsSync(local)
    ? { kind: "local", sourceKey: `${relFromRoot}::${imageValue}`, file: local, label: relFromRoot, detail: imageValue }
    : { kind: "missing", label: relFromRoot, detail: `${imageValue} 未找到` };
}

async function readSourceBuffer(src) {
  if (src.kind === "local") return fs.readFileSync(src.file);
  const res = await fetch(src.url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * 只在原文本上做定点手术：替换已有 thumb 行的值，或在 image 行后插入一行。
 * 其余字节原样保留，避免重新序列化 YAML 打乱注释和键顺序。
 */
function upsertThumbLine(raw, imageLineIndex, imageValue, thumbValue, newline) {
  const lines = raw.split(/\r?\n/);
  const fm = parseFrontmatter(lines);
  const existing = fm?.entries.find((e) => e.key === "thumb");
  const line = `thumb: ${thumbValue}`;
  if (existing) {
    if (lines[existing.lineIndex] === line) return { changed: false, raw };
    lines[existing.lineIndex] = line;
    return { changed: true, raw: lines.join(newline) };
  }
  if (!fm) return { changed: false, raw };
  const idx = fm.entries.find((e) => e.key === "image")?.lineIndex ?? imageLineIndex;
  lines.splice(idx + 1, 0, line);
  return { changed: true, raw: lines.join(newline) };
}

async function main() {
  const files = await glob(POSTS_GLOB, { cwd: rootDir, nodir: true });
  files.sort();

  const stats = {
    total: files.length,
    noImage: 0,
    generated: [],
    cached: 0,
    fmUpdated: 0,
    missing: [],
    failed: [],
    skippedSmall: [],
    beforeBytes: 0,
    afterBytes: 0,
  };

  if (!DRY_RUN) fs.mkdirSync(COVERS_DIR, { recursive: true });

  const counted = new Set();

  for (const file of files) {
    const mdFile = path.join(rootDir, file);
    const raw = fs.readFileSync(mdFile, "utf8");
    const newline = raw.includes("\r\n") ? "\r\n" : "\n";
    const lines = raw.split(/\r?\n/);
    const fm = parseFrontmatter(lines);
    if (!fm) continue;

    const imageEntry = fm.entries.find((e) => e.key === "image" && e.value);
    if (!imageEntry) {
      stats.noImage++;
      continue;
    }
    const imageValue = imageEntry.value;
    if (imageValue.startsWith("data:")) continue;

    const src = resolveSource(mdFile, imageValue);
    if (src.kind === "missing") {
      stats.missing.push({ file: src.label, detail: src.detail });
      continue;
    }

    const name = thumbNameFor(src.sourceKey, imageValue);
    const outPath = path.join(COVERS_DIR, name);
    const thumbValue = `/covers/${name}`;
    const exists = fs.existsSync(outPath) && fs.statSync(outPath).size > 0;

    if (exists && !FORCE) {
      // 缩略图已在，只补/校对 frontmatter
      const { changed, raw: next } = upsertThumbLine(raw, imageEntry.lineIndex, imageValue, thumbValue, newline);
      if (changed) {
        if (!DRY_RUN) fs.writeFileSync(mdFile, next, "utf8");
        stats.fmUpdated++;
        console.log(`  · 补 thumb  ${src.label}`);
      }
      stats.cached++;
      continue;
    }

    try {
      const input = await readSourceBuffer(src);
      const meta = await sharp(input, { failOn: "none" }).metadata();
      const info = {
        file: src.label,
        from: `${meta.width ?? "? "}x${meta.height ?? "?"}`,
        before: input.length,
      };
      const out = await sharp(input, { failOn: "none" })
        .rotate()
        .resize({
          width: MAX_EDGE,
          height: MAX_EDGE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: QUALITY, effort: 6 })
        .toBuffer();

      // 已经够小的图（或压完反而变大的 webp/png）不值得再生成一份：
      // 列表卡片没有 thumb 时会回退到 image 原图，体积一样能接受。
      const worthIt = out.length < input.length * 0.8 && input.length - out.length > 5 * 1024;
      if (!worthIt) {
        stats.skippedSmall.push({
          file: src.label,
          detail: `${info.from} ${kb(input.length)} → ${kb(out.length)}`,
        });
        continue;
      }

      info.to = `${Math.round((out.length / input.length) * 100)}%`;
      info.after = out.length;

      if (!DRY_RUN) {
        fs.writeFileSync(outPath, out);
        const { changed, raw: next } = upsertThumbLine(raw, imageEntry.lineIndex, imageValue, thumbValue, newline);
        if (changed) fs.writeFileSync(mdFile, next, "utf8");
      }

      stats.generated.push(info);
      // 多篇文章共用同一张封面时，体积只按一份统计
      if (!counted.has(path.basename(outPath))) {
        counted.add(path.basename(outPath));
        stats.beforeBytes += info.before;
        stats.afterBytes += info.after;
      }
      console.log(
        `  ✓ ${DRY_RUN ? "将生成" : "已生成"} ${path.basename(outPath)}  ` +
          `${info.from} ${kb(info.before)} → ${kb(info.after)} (${info.to})  ${src.label}`
      );
    } catch (err) {
      stats.failed.push({ file: src.label, error: String(err?.message ?? err) });
      console.error(`  ✗ 失败 ${src.label}: ${err?.message ?? err}`);
    }
  }

  console.log("");
  console.log(`扫描 ${stats.total} 篇，无封面 ${stats.noImage} 篇`);
  console.log(`新生成 ${stats.generated.length} 张，已存在跳过 ${stats.cached} 张，frontmatter 更新 ${stats.fmUpdated} 篇`);
  if (stats.generated.length) {
    console.log(
      `体积 ${kb(stats.beforeBytes)} → ${kb(stats.afterBytes)}，` +
        `省了 ${(stats.beforeBytes / Math.max(stats.afterBytes, 1)).toFixed(1)} 倍`
    );
  }
  if (stats.skippedSmall.length) {
    console.log(`\n原图已够小，不生成 thumb（列表卡片直接用 image）：`);
    for (const s of stats.skippedSmall) console.log(`  - ${s.file}: ${s.detail}`);
  }
  if (stats.missing.length) {
    console.log(`\n源文件缺失 ${stats.missing.length} 个：`);
    for (const m of stats.missing.slice(0, 20)) console.log(`  - ${m.file}: ${m.detail}`);
  }
  if (stats.failed.length) {
    console.log(`\n处理失败 ${stats.failed.length} 个：`);
    for (const f of stats.failed.slice(0, 20)) console.log(`  - ${f.file}: ${f.error}`);
    process.exitCode = 1;
  }
  if (stats.generated.length && !DRY_RUN) {
    console.log(`\n缩略图目录：${path.relative(rootDir, COVERS_DIR).replace(/\\/g, "/")}（已写入 thumb，记得 pnpm build）`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
