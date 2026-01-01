import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const IMAGE_DIR = path.join(rootDir, 'public', 'api', 'i');
const OUTPUT_FILE = path.join(IMAGE_DIR, 'images.json');

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

async function generateGalleryIndex() {
  console.log('正在扫描图片目录...');

  // 扫描所有图片文件
  const pattern = path.join(IMAGE_DIR, '**/*.*').replace(/\\/g, '/');
  const files = await glob(pattern, {
    ignore: [
      '**/images.json',      // 忽略索引文件本身
      '**/cache/**',         // 忽略缓存目录
      '**/gallery-meow/**',  // 忽略其他目录
      '**/favicon.ico',      // 忽略 favicon
      '**/index.html'        // 忽略 index.html
    ]
  });

  console.log(`找到 ${files.length} 个文件`);

  // 解析并过滤图片
  const images = [];
  for (const file of files) {
    // 获取相对路径
    const relativePath = path.relative(IMAGE_DIR, file).replace(/\\/g, '/');

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

  console.log(`共找到 ${images.length} 张图片`);

  // 写入 JSON 文件
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(images, null, 2), 'utf-8');
  console.log(`已生成索引文件: ${OUTPUT_FILE}`);
}

generateGalleryIndex().catch(console.error);
