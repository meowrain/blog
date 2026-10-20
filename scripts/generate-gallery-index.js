// 相册索引：扫描图床目录，生成 `images.json` 给 /gallery/ 读取。
//
// 图片按 public/api/i/YYYY/MM/DD/<filename>.<ext> 组织，索引写到同目录下的
// images.json，字段为 { url, filename, year, month, day, date }。
//
// 扫描目录默认是 public/api/i（本地 EasyImage 或直接放图），要扫别处就用：
//
//   pnpm gallery:index --dir ../img-bed/public/api/i
//   GALLERY_BED_DIR=../img-bed/public/api/i pnpm gallery:index
//
// 注意不自动去扫兄弟目录的图床仓库：那等于往另一个 git 仓库里写文件，
// 会让构建悄悄改动别的仓库。
//
// 找不到目录时直接跳过并以 0 退出：线上的 /api/i/* 由 EdgeOne Pages Function
// 代理到 CNB 图床，构建机器上没有图床是正常情况，不该让 build 失败；也不写空索引，
// 免得把线上正在用的那份覆盖成 []。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 支持的图片扩展名
const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'
]);

function parseImagePath(relativePath) {
  // 路径格式: public/api/i/YYYY/MM/DD/filename.ext
  const match = relativePath.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\/([^/]+)\.(.+)$/);
  if (!match) return null;

  const [, year, month, day, filename, ext] = match;

  return {
    url: `/api/i/${year}/${month}/${day}/${filename}.${ext}`,
    filename: `${filename}.${ext}`,
    year,
    month: month.padStart(2, '0'),
    day: day.padStart(2, '0'),
    date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  };
}

/** `--dir <path>` / `--dir=<path>`，没给就取 GALLERY_BED_DIR，再没有就用 public/api/i */
function resolveImageDir(argv = process.argv.slice(2)) {
  const flagIndex = argv.findIndex(arg => arg === '--dir' || arg.startsWith('--dir='));
  let explicit = null;
  if (flagIndex !== -1) {
    const arg = argv[flagIndex];
    explicit = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[flagIndex + 1];
  }
  explicit = explicit || process.env.GALLERY_BED_DIR || null;

  const dir = path.resolve(rootDir, explicit || path.join('public', 'api', 'i'));
  return fs.existsSync(dir) ? dir : null;
}

async function generateGalleryIndex() {
  const imageDir = resolveImageDir();
  if (!imageDir) {
    console.log('[gallery] 未找到图床目录，跳过相册索引生成');
    console.log('[gallery] 需要的话用 --dir <path> 或 GALLERY_BED_DIR 指定');
    return;
  }

  const outputFile = path.join(imageDir, 'images.json');
  console.log(`[gallery] 扫描目录: ${imageDir}`);

  const pattern = path.join(imageDir, '**/*.*').replace(/\\/g, '/');
  const files = await glob(pattern, {
    ignore: [
      '**/images.json',      // 忽略索引文件本身
      '**/_t/**',            // 忽略缩略图目录：路径里同样带年/月/日，收进来会变成重复项
      '**/cache/**',         // 忽略缓存目录
      '**/gallery-meow/**',  // 忽略其他目录
      '**/favicon.ico',      // 忽略 favicon
      '**/index.html'        // 忽略 index.html
    ]
  });

  // 解析并过滤图片
  const images = [];
  for (const file of files) {
    // 获取相对路径
    const relativePath = path.relative(imageDir, file).replace(/\\/g, '/');

    // 检查文件扩展名
    const ext = path.extname(file).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) {
      continue;
    }

    // 解析路径信息
    const parsed = parseImagePath(relativePath);
    if (parsed) {
      images.push(parsed);
    }
  }

  // 按日期倒序排序
  images.sort((a, b) => b.date.localeCompare(a.date));

  // 写入 JSON 文件
  fs.writeFileSync(outputFile, JSON.stringify(images, null, 2), 'utf-8');
  console.log(`[gallery] ${files.length} 个文件中解析出 ${images.length} 张图片`);
  console.log(`[gallery] 已生成索引: ${outputFile}`);
}

generateGalleryIndex().catch(error => {
  console.error('[gallery] 生成相册索引失败:', error);
  process.exitCode = 1;
});
