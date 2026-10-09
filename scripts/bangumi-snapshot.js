// 追番页数据快照：在本地抓一次 Bangumi 公开收藏，把 JSON 和封面图落到仓库里。
// 线上（EdgeOne 边缘函数）和访客浏览器都到不了 api.bgm.tv / lain.bgm.tv，
// 所以这页不做任何运行时外网请求，数据全部来自这里生成的静态文件。
//
//   NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:2080 pnpm bangumi:snapshot
//
// bgm.tv 系域名在部分网络里被 DNS 污染，直连会 fetch failed，必须带代理跑。
// 收藏设成私密时接口不报错、只返回 total 0，所以抓出来是空是正常的。

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const USERNAME = process.env.BANGUMI_USERNAME || '1288878';
const API_ROOT = 'https://api.bgm.tv/v0';
const PAGE_SIZE = 50;
// 单个档位最多抓这么多条，防止接口 total 异常时把脚本变成死循环。
const MAX_ITEMS_PER_STATUS = 2000;
const REQUEST_TIMEOUT_MS = 20000;
const USER_AGENT = 'meowrain-blog-bangumi/1.0 (+https://blog.meowrain.cn/bangumi/)';

// 与页面档位顺序保持一致：在看 / 想看 / 看过 / 搁置 / 抛弃
const STATUS_TYPES = [3, 1, 2, 4, 5];

const DATA_FILE = path.join(rootDir, 'src', 'data', 'bangumi.json');
const ASSET_DIR = path.join(rootDir, 'public', 'bangumi');
const COVER_DIR = path.join(ASSET_DIR, 'covers');

async function fetchBuffer(url, accept) {
  const response = await fetch(url, {
    headers: { Accept: accept, 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${url} -> HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function fetchJson(url) {
  return JSON.parse((await fetchBuffer(url, 'application/json')).toString('utf-8'));
}

// 卡片封面显示宽度约 92px，r/400 的 common 够清晰又不至于让仓库涨太快；
// 老接口偶尔缺字段，所以按体积从大到小兜底找。
function pickCoverUrl(subject) {
  const images = subject?.images;
  return (
    images?.common || images?.medium || images?.small || images?.grid || images?.large || ''
  );
}

function extnameFromUrl(url, fallback) {
  const pathname = url.split('?')[0];
  const ext = path.extname(pathname).toLowerCase();
  return /^\.(jpg|jpeg|png|webp|gif)$/.test(ext) ? ext : fallback;
}

async function saveAsset(url, destBase, fallbackExt) {
  if (!url) return null;
  const dest = `${destBase}${extnameFromUrl(url, fallbackExt)}`;
  const bytes = await fetchBuffer(url, 'image/avif,image/webp,image/*,*/*');
  await fs.writeFile(dest, bytes);
  // 存成站点根路径，页面直接当 img src 用。
  return `/${path.relative(path.join(rootDir, 'public'), dest).split(path.sep).join('/')}`;
}

function normalizeTags(item) {
  const subjectTags = Array.isArray(item.subject?.tags) ? item.subject.tags : [];
  const names = subjectTags
    .map((tag) => (typeof tag === 'string' ? tag : tag?.name))
    .filter(Boolean);
  return (names.length > 0 ? names : item.tags || []).slice(0, 3);
}

async function collectStatus(username, type) {
  const items = [];
  const seen = new Set();

  for (let offset = 0; offset < MAX_ITEMS_PER_STATUS; offset += PAGE_SIZE) {
    const query = new URLSearchParams({
      subject_type: '2',
      type: String(type),
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    const page = await fetchJson(
      `${API_ROOT}/users/${encodeURIComponent(username)}/collections?${query}`
    );
    const batch = Array.isArray(page.data) ? page.data : [];
    if (batch.length === 0) break;

    for (const item of batch) {
      if (item.subject_id == null || seen.has(item.subject_id)) continue;
      seen.add(item.subject_id);
      items.push(item);
    }

    if (typeof page.total === 'number' && items.length >= page.total) break;
    if (batch.length < PAGE_SIZE) break;
  }

  return items;
}

async function main() {
  await fs.mkdir(COVER_DIR, { recursive: true });

  const profile = await fetchJson(`${API_ROOT}/users/${encodeURIComponent(USERNAME)}`);
  const avatarPath = await saveAsset(
    profile.avatar?.medium || profile.avatar?.small || profile.avatar?.large,
    path.join(ASSET_DIR, 'avatar'),
    '.jpg'
  );

  const counts = {};
  const snapshotItems = [];

  for (const type of STATUS_TYPES) {
    const items = await collectStatus(USERNAME, type);
    counts[type] = items.length;
    console.log(`  档位 ${type}: ${items.length} 条公开`);

    for (const item of items) {
      const subject = item.subject || {};
      // 同名条目重复抓时覆盖即可，封面文件名用 subject_id 保证稳定。
      const cover = await saveAsset(
        pickCoverUrl(subject),
        path.join(COVER_DIR, String(item.subject_id)),
        '.jpg'
      );

      snapshotItems.push({
        subjectId: item.subject_id,
        type: item.type || type,
        title: subject.name_cn || subject.name || `动画 #${item.subject_id}`,
        originalTitle: subject.name && subject.name !== (subject.name_cn || subject.name) ? subject.name : '',
        cover,
        date: subject.date || '',
        eps: Number(subject.eps || 0),
        score: Number(subject.score || 0),
        rank: Number(subject.rank || 0),
        rate: Number(item.rate || 0),
        epStatus: Number(item.ep_status || 0),
        tags: normalizeTags(item),
        comment: item.comment || '',
        updatedAt: item.updated_at || '',
      });
    }
  }

  // 删掉已经不在收藏里的封面，避免 public/bangumi/covers 只增不减。
  const keep = new Set(snapshotItems.map((item) => path.basename(String(item.cover || ''))));
  for (const entry of await fs.readdir(COVER_DIR)) {
    if (!keep.has(entry)) await fs.unlink(path.join(COVER_DIR, entry));
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    username: profile.username || USERNAME,
    user: {
      nickname: profile.nickname || '',
      sign: profile.sign || '',
      url: profile.url || `https://bgm.tv/user/${USERNAME}`,
      avatar: avatarPath,
    },
    counts,
    items: snapshotItems,
  };

  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8');

  console.log(`\n已写入 ${path.relative(rootDir, DATA_FILE)}（${snapshotItems.length} 条）`);
  console.log(`封面目录 ${path.relative(rootDir, COVER_DIR)}`);
}

main().catch((error) => {
  console.error('快照失败：', error?.message || error);
  console.error('若是 fetch failed，检查代理变量：NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:2080');
  process.exit(1);
});
