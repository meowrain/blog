# MeowRain Blog

基于 [Fuwari](https://github.com/saicaca/fuwari) 二次开发并持续定制的个人技术博客。前端使用 Astro 生成静态站点，内容以 Markdown/MDX 文件维护；仓库内还包含一个 NestJS 管理后台，用于直接管理 `src/content/posts` 下的文章、分类、标签和备份。

线上站点：

- EdgeOne CN: <https://blog.meowrain.cn>
- Global: <https://blog2.meowrain.cn>
- Global: <https://www.meowrain.cn>

> 这个仓库包含较多个人定制，已经不是简单的上游主题模板。若要二次使用，建议先阅读 `src/config.ts`、`astro.config.mjs`、`src/content/config.ts` 和 `backend/README.md`。

## 功能

- Astro 5 静态站点，构建产物可直接部署到任意静态托管平台
- 文章、归档、分类、标签、相册、友链和赞助页面
- 个人主页化：`/about/` 自我介绍、`/projects/` 项目卡片（含详情页）、`/notes/` 碎碎念时间线，首页顶部也有入口
- 年度报告页与归档页「那年今天」卡片：按年聚合写作统计，回看往年同一天发布的文章
- Markdown/MDX 内容集合，带 frontmatter 校验
- 站内搜索：正文分片倒排索引（中文 bigram + 单字），按查询词只拉命中的分片与正文块，中文多关键词 AND、字段加权排序，支持 ⌘K 快捷键及分类/标签筛选
- 系列（合集）导航：用 `series` frontmatter 把同一主题的文章串成系列，正文顶部给出上一章 / 下一章和阅读进度条，`/series/` 汇总全部系列
- 响应式布局、深色/浅色主题和主题色自定义
- Swup 页面过渡、目录、阅读时长、代码高亮和复制按钮
- 移动端目录抽屉与顶部阅读进度条：窄屏下右下角按钮唤出目录，当前章节高亮跟随 IntersectionObserver，页面顶部细条显示正文阅读进度
- 文章分享卡片：复用文章 OG 图，支持系统分享、复制链接和下载卡片
- KaTeX 数学公式、GitHub 风格的提示块和仓库卡片
- 图片画廊、图片放大预览和渐进图片回退
- 音乐页：云函数代理网易云歌单接口，直接播放歌单、歌词滚动，支持私有歌单
- RSS、Sitemap、robots.txt 和 SEO 元信息
- 可选 NestJS 管理后台，支持文章 CRUD、分类/标签管理、图片上传和文件备份恢复

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端框架 | Astro 5 |
| 交互组件 | Svelte 5 |
| 样式 | Tailwind CSS、Stylus |
| Markdown | remark、rehype、KaTeX、Expressive Code |
| 包管理 | pnpm 9 |
| 管理后台 | NestJS 11、Express、TypeScript |
| 代码质量 | Biome、TypeScript、ESLint、Prettier、Jest |

## 快速开始

### 环境要求

- Node.js 18+
- pnpm 9.x

如果本机还没有 pnpm，可以通过 Corepack 启用：

```bash
corepack enable
```

### 安装依赖

```bash
pnpm install
```

### 启动开发服务器

```bash
pnpm dev
```

默认开发端口配置在 `astro.config.mjs` 中，为 `http://localhost:25544`。

### 构建和预览

```bash
pnpm build
pnpm preview
```

构建产物位于 `dist/`。

### 常用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动 Astro 开发服务器 |
| `pnpm build` | 构建生产站点 |
| `pnpm preview` | 预览生产构建 |
| `pnpm type-check` | 运行 TypeScript 类型检查 |
| `pnpm test` | 运行搜索核心、分片倒排索引、个人主页等 Node 单元测试 |
| `pnpm new-post <path>` | 创建新文章 |
| `pnpm new-note [slug]` | 创建一条碎碎念 |
| `pnpm gallery:index` | 扫描图床目录，生成相册索引 `images.json`（`pnpm build` 会自动先跑） |
| `pnpm clean` | 清理 `src/content/assets` 下未被引用的图片 |
| `pnpm format` | 使用 Biome 格式化 `src` |
| `pnpm lint` | 使用 Biome 检查并修复 `src` |

## 编写文章

文章位于 `src/content/posts/`，可以使用 Markdown 或 MDX。内置脚本会根据参数创建目录和后缀为 `.md` 的文件：

```bash
pnpm new-post java/spring-boot
```

生成的路径为 `src/content/posts/java/spring-boot.md`。

文章支持以下 frontmatter 字段：

```yaml
---
title: 文章标题
published: 2026-10-08T12:00:00
updated: 2026-10-09T09:00:00
description: 文章简介
image: ./cover.jpg
tags: [Astro, NestJS]
category: 开发/博客
series: JUC
seriesOrder: 1
draft: false
lang: zh_CN
pinned: false
---
```

字段说明：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `title` | string | 是 | - | 文章标题 |
| `published` | date | 是 | - | 发布时间 |
| `updated` | date | 否 | - | 更新时间 |
| `description` | string | 否 | `""` | 文章摘要 |
| `image` | string | 否 | `""` | 封面图片 |
| `tags` | string[] | 否 | `[]` | 标签列表 |
| `category` | string \| string[] | 否 | - | 分类，可使用路径形式 |
| `draft` | boolean | 否 | `false` | 是否为草稿 |
| `lang` | string | 否 | `""` | 文章语言 |
| `pinned` | boolean | 否 | `false` | 是否置顶 |
| `series` | string | 否 | `""` | 所属系列名，同名文章自动串成系列并可上一章 / 下一章翻页 |
| `seriesOrder` | number | 否 | - | 系列内的章节序号，留空按发布时间排序 |

## 个人主页内容

除了文章，站点还有三个内容集合，都是 `src/content/` 下的 Markdown 文件：

### 碎碎念 `src/content/notes/`

```yaml
---
published: 2026-10-20T23:40:00
title: 可选，不写就用正文第一句
tags: [站务]
mood: 可选
location: 可选
pinned: false
draft: false
---
```

`/notes/` 按月份分组渲染整条正文，`pinned: true` 的排最前。每一条都有锚点
（`/notes/#文件名`），首页「最近在记」和单独的 `/notes/rss.xml` 都指向它。

### 项目 `src/content/projects/`

```yaml
---
title: 项目名
description: 一句话说明
url: https://example.com      # 可选，项目主页
repo: https://github.com/...  # 可选，源码
icon: material-symbols:rocket-launch-outline-rounded
tags: [Astro]
status: active                # active / wip / archived
featured: true                # 在 /projects/ 的「精选」区单独列出
order: 1                      # 可选，数字越小越靠前
published: 2026-01-01
draft: false
---
```

`/projects/` 列卡片，`/projects/<文件名>/` 渲染正文，并给出上一个 / 下一个和标签相同的相关项目。

### 关于 `src/content/about/about.md`

只放一份，`/about/` 的名片区、站点数据（文章数、碎碎念数、项目数、系列数）和正文
都来自它和内容集合。

## 站点配置

主要站点配置位于 `src/config.ts`：

- `siteConfig`: 标题、描述、语言、主题色、横幅、背景、目录、favicon 和站点链接
- `navBarConfig`: 导航栏链接
- `profileConfig`: 头像、昵称、简介和个人链接
- `licenseConfig`: 文章版权协议
- `umamiConfig`: Umami 统计
- `expressiveCodeConfig`: 代码高亮主题
- `gitHubEditConfig`: 文章编辑链接
- `musicConfig`: 音乐页要展示的网易云歌单

构建和 Markdown 处理配置位于 `astro.config.mjs`，包括重定向、Swup、Sitemap、图标、Expressive Code、KaTeX、提示块和外部链接处理。

## 相册

相册图片放在按日期组织的目录中：

```text
public/api/i/YYYY/MM/DD/<filename>.<ext>
```

生成或更新相册索引：

```bash
pnpm gallery:index
```

脚本会扫描 `public/api/i`，并写入 `public/api/i/images.json`。相册页面读取该索引并生成瀑布流和灯箱预览。

`pnpm build` 会先跑一次这个脚本再 `astro build`，所以本地把图放进目录、直接构建就能看到更新。目录不存在时脚本打印一行提示后跳过（退出码 0），不写空索引——线上 `/api/i/*` 是 EdgeOne Pages Function 代理到 CNB 图床，构建机上没有 `public/api/i` 是正常的。

图床不在默认位置时用 `--dir` 或 `GALLERY_BED_DIR` 指定，两者和 `src/plugins/dev-image-bed.mjs` 的环境变量同名：

```bash
pnpm gallery:index --dir ../img-bed/public/api/i
```


## 音乐页

`/music/` 用来直接播放网易云歌单，歌单、曲目和歌词都来自网易云音乐。浏览器不直接请求上游：上游不返回 CORS 头，还会按 Referer / Cookie 风控，所以统一走同源代理：

- 线上：`cloud-functions/api/music/[[default]].js`（EdgeOne Makers 云函数，部署时按文件路径自动生成 `^/api/music/(.*)$` 路由）
- 本地：`src/plugins/dev-music-api.mjs` 在 `astro dev` 里复用同一个 `onRequest`，两边行为一致

代理有三个动作：`/api/music/playlist?id=`、`/api/music/song?id=` 和 `/api/music/lyric?id=`。播放地址带时效（约 20 分钟），因此只在前端真要播放时才去取。歌单接口会顺手探一遍可播性，把无版权的歌滤掉；歌单详情一次只给 1000 首，更大的歌单会再按 `trackIds` 补齐（上限 2000 首）。

在 `src/config.ts` 的 `musicConfig.playlists` 里填歌单 ID 就能用，ID 就是歌单分享链接里 `id=` 后面那串数字；每一项还可以用 `name` 覆盖歌单显示名。默认放的是本人的「我喜欢的音乐」（`158197454`）。

会员歌和私密歌单需要登录 Cookie，配到部署环境的 `NETEASE_COOKIE`（控制台环境变量）；本地调试用 `NETEASE_COOKIE="MUSIC_U=..." pnpm dev`。这个变量只从服务端读，不接受请求方传入，否则代理就成了任何人拿你的账号听歌的入口。

没配 Cookie 时，会员曲目只能拿到 30 秒试听片段：这些歌在页面上会标「试听」，曲目列表底部也会说明有多少首是这种情况。

## 管理后台

管理后台位于 `backend/`，通过文件 API 直接读写博客文章，不需要数据库。

```bash
cd backend
pnpm install
pnpm run start:dev
```

启动后访问：

- 管理后台: <http://localhost:3009/admin/>
- API: <http://localhost:3009/api/>
- 健康检查: <http://localhost:3009/api/health>

默认情况下，后台使用仓库根目录下的 `src/content/posts` 作为文章目录，并将备份写入 `backend/backups`。可以通过环境变量覆盖：

```bash
PORT=3010
POSTS_DIR=../src/content/posts
BACKUPS_DIR=./backups
API_TOKEN=your-token
```

> `API_TOKEN` 会保护 `/api` 路由，但内置管理后台目前不会自动发送 Bearer Token。启用该变量后，后台页面将无法直接调用 API，适合只开放 API 的场景或由反向代理统一鉴权。

更多接口、DTO、备份和配置说明见 [backend/README.md](backend/README.md)。

## 项目结构

```text
.
├── src/
│   ├── components/         # Astro 和 Svelte 组件
│   ├── content/
│   │   ├── posts/         # Markdown/MDX 文章
│   │   ├── notes/         # 碎碎念（短笔记）
│   │   ├── projects/      # 项目介绍
│   │   ├── about/         # 关于页正文
│   │   └── assets/        # 内容资源
│   ├── layouts/            # 页面布局
│   ├── pages/              # Astro 路由
│   ├── plugins/            # Markdown 和构建插件
│   ├── styles/             # 全局样式
│   ├── utils/              # 通用工具
│   └── config.ts           # 站点配置
├── backend/
│   ├── src/admin/          # 管理后台静态页面
│   ├── src/articles/       # 文章模块
│   ├── src/categories/     # 分类模块
│   ├── src/tags/           # 标签模块
│   └── src/common/         # 文件、索引、日志等公共模块
├── cloud-functions/        # EdgeOne Makers 云函数（图片 OG、历史、音乐代理）
│   └── api/music/          # /api/music/* 网易云音乐代理
├── scripts/                # 文章、相册和图片清理脚本
├── public/                 # 静态资源
├── astro.config.mjs        # Astro 构建配置
├── edgeone.json            # EdgeOne 重定向配置
└── docker-compose.yml      # EasyImage 可选服务
```

## 构建和部署

### 静态站点

```bash
pnpm build
```

将 `dist/` 部署到静态托管平台即可。`edgeone.json` 包含 EdgeOne 使用的重定向规则；`astro.config.mjs` 中也维护了开发构建时的重定向配置。

### 管理后台

```bash
cd backend
pnpm run build
pnpm run start:prod
```

管理后台需要能够读写文章目录，适合部署在可信网络或受反向代理保护的环境中。

### 可选图片服务

仓库根目录的 `docker-compose.yml` 可以启动 EasyImage：

```bash
docker compose up -d
```

默认映射端口为 `8087`，相关数据挂载在 `public/config` 和 `public/api/i`。

## 许可证

- 项目代码使用 [MIT License](LICENSE)。
- 原创文章使用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)。
- 主题基础来自 [saicaca/fuwari](https://github.com/saicaca/fuwari)，并在其基础上进行了个人定制。
