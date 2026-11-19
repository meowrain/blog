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
- 数据分享卡：歌单、追番、监控、年度报告页复用同一套 resvg 管线生成分享图
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

代理有五个动作：`/api/music/playlist?id=`、`/api/music/song?id=`、`/api/music/lyric?id=`、`/api/music/search?q=` 和 `/api/music/artist?id=|q=`。播放地址带时效（约 20 分钟），因此只在前端真要播放时才去取。歌单接口会顺手探一遍可播性，把无版权的歌滤掉；歌单详情一次只给 1000 首，更大的歌单会再按 `trackIds` 补齐（上限 2000 首）。

`search` / `artist` 是给聊天页电台用的，返回的每一首都**已经探过可播放性**（搜索结果里同名翻唱、无版权的一大堆）。`search&lyric=1` 会顺带取每首开头的两三句歌词，给模型写串词用。

在 `src/config.ts` 的 `musicConfig.playlists` 里填歌单 ID 就能用，ID 就是歌单分享链接里 `id=` 后面那串数字；每一项还可以用 `name` 覆盖歌单显示名。默认放的是本人的「我喜欢的音乐」（`158197454`）。

会员歌和私密歌单需要登录 Cookie，配到部署环境的 `NETEASE_COOKIE`（控制台环境变量）；本地调试用 `NETEASE_COOKIE="MUSIC_U=..." pnpm dev`。这个变量只从服务端读，不接受请求方传入，否则代理就成了任何人拿你的账号听歌的入口。

没配 Cookie 时，会员曲目只能拿到 30 秒试听片段：这些歌在页面上会标「试听」，曲目列表底部也会说明有多少首是这种情况。

### AI 电台

聊天页（`/chat/`）里说「放点适合深夜写代码的」，助手会挑歌、给每首写一句串词，回一张播放卡；点「开始收听」后先念串词再放歌，放完自动接下一首。

- 工具在 `agents/assistant/_radio.ts`：`radio_tracks` 找歌（走 `/api/music/search` 与 `/artist`，结果已滤掉不能播的），`radio_play` 出卡。id 只认本次真的搜出来过的曲目，模型自己拼的一律丢掉。
- 播放卡是 `src/components/chat/RadioCard.svelte`，播放本身交给常驻的 `MusicPlayerHost`；`player.svelte.ts` 里的 `playRadio` / `stopRadio` 管队列，队列开着时 `tracks()` 优先读它，`advance()` 不改就跟着走。
- 串词用浏览器自带的 `speechSynthesis`（`src/utils/speech.ts`），零配置；要换音质只改 `speak()` 的实现。
- 实测边界：搜索接口只在歌手名/歌名上准，题材词是字面匹配。所以系统提示要求模型先用 `web_search` 查到具体歌手，再回来搜歌。

## 数据分享卡

除了文章 OG 图，歌单、追番、监控和年度报告页也各有分享卡。它们复用同一条 satori + resvg 渲染管线（`cloud-functions/api/og/[[default]].js`），只是换一份 `buildTree`：

```text
GET /api/og/<slug>?type=playlist|bangumi|monitor|year
    &title=&subtitle=&badge=&stats=标签:数值|标签:数值&tags=&bars=
```

- 云函数只排版，不请求任何上游：数据由页面算好后拼进查询参数。歌单和监控的数据要等接口返回才有，页面脚本通过 `publishOgCardData()` 推给 `DataShareCard` 组件，卡片地址随之更新。
- 布局按高度预算逐级降级：指标超过一行就去掉柱条、收副标题，保证内容不会顶穿底栏（satori 不裁切溢出）。
- 参数拼装收在 `src/utils/og-card.ts`（纯函数，有单测），不要在页面里手拼查询串。

## 站内 AI 助手（`/chat/`）

`/chat/` 是一个通用助手，接口在 `agents/assistant/`（EdgeOne Makers 的 agent 路由，挂在 `POST /assistant`）。页面占着 `/chat/`，接口不能同名，否则静态文件会把 POST 整个接走。

能力与边界：

- **多会话**：会话列表只存在浏览器 `localStorage`（`eo_chat_conversations`，最多 30 条，按更新时间倒序），正文才从 `/history` 拉。**不要**改成服务端列表：`store.listConversations` 是账号级的、没有 userId 维度，取出来等于把这个 EdgeOne 项目下所有访客的会话标题一起列出去。删除走 `POST /history { action: 'delete' }`，服务端真删。
- **图片输入**：粘贴 / 拖拽 / 文件选择三种入口，收 png / jpeg / webp / gif，单张 ≤5MB、单条 ≤3 张；浏览器先压到最长边 1024、JPEG q0.85（GIF 不重编码，否则只剩第一帧），再 `POST /api/chat-image/upload` 由云函数代传图床。**图床 token 只在服务端**（`cloud-functions/api/chat-image/[[default]].js` 读 `IMAGE_BED_TOKEN`）；后台 `backend/src/admin/public/app.js` 里的硬编码直传只适用于管理员页面，聊天页任何访客都能打开，不能照抄。
- **消息里只留图片 URL**，agent 收到后自己抓回来转 base64 内联（15s 超时、≤8MB）。只有**最后一轮**带图，更早的轮次换成 `[历史消息中的图片已省略]` —— 否则每轮重新抓图计费，3 张 base64 ≈ 3~5k tokens，多聊几轮就撑爆 `MAX_HISTORY_TOKENS`。
- **视觉能力未知也不要紧**：默认模型 `@makers/deepseek-v4-flash` 文档没声明多模态。代码乐观发送 → 上游 400 且报错里提到 image / content / multimodal 时，压回纯文本重试一次并发一条 `notice`，同时在这个实例里记住「不支持」。想跳过试探就配 `AI_GATEWAY_VISION_MODEL`（图片轮换到视觉模型）或 `AI_GATEWAY_VISION=0`（直接按纯文本走）。`node scripts/probe-vision.mjs` 可以手动探一次（不进 CI，会真的打上游）。
- **联网**：`web_search` 走腾讯云元宝搜索（TC3 签名，`WSA_SECRET_ID` / `WSA_SECRET_KEY`）。没配这对密钥时 system prompt 会禁用它，首轮前也会发一条 `notice`：「本次未启用联网」。
- SSE 除 `ai_response` / `tool_call` / `tool_result` / `usage` / `error_message` 外，新增 `notice`（`level` + `code` + `message`），前端渲染成消息区顶部可关闭的细条；未知 type 旧客户端会静默忽略。

环境变量见 `.env.example` 的 `AI_GATEWAY_*` / `WSA_SECRET_*` / `IMAGE_BED_*` 段。

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
│   ├── api/og/            # /api/og/* 文章与数据分享卡（satori + resvg）
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

`pnpm build` 开头会跑 [scripts/build-env.js](scripts/build-env.js) 打一行构建机规格（Node 版本 / 核数 / 内存），结尾跑 [scripts/assert-dist.js](scripts/assert-dist.js) 核对产物：`dist` 不存在、缺 `index.html` / `404.html` / `rss.xml` / `sitemap-index.xml` / `_astro/`、或 HTML 页面数异常偏少时直接以非零码退出。这是为了防止「astro 中途被杀但退出码仍是 0」被平台当成构建成功——那样的结果是拿着不存在的 `dist` 去打包，最后只报一句 `ENOENT: lstat '.../dist'`（2026-11-19 的 EdgeOne 构建就是这么挂的）。

构建机出网受限时，可以用 `LINK_CARD=0 pnpm build` 跳过链接卡片的外链抓取，避免几十个 URL 各自超时 5s×2。

### 持续集成

CNB 仓库（<https://cnb.cool/meowyyds/blog>）的 `main` 分支推送后会由 [.cnb.yml](.cnb.yml) 自动构建并部署：

1. `node:20` 环境里安装 pnpm 9，然后执行 `edgeone makers deploy -n blog-learn`
2. CLI 按 [edgeone.json](edgeone.json) 的 `installCommand` / `buildCommand` 构建 `.edgeone` 并整体上传；它会一并打包 `cloud-functions/` 和 `agents/`，只传 `./dist` 会丢云函数

`EDGEONE_API_TOKEN` 不写在仓库里，而是通过 `imports` 从私有密钥仓库 `meowyyds/blog-envs` 的 `envs.yml` 注入。

需要注意：公开域名 `blog-edgeone.meowrain.cn` 绑定的是 GitHub 连线的另一个 EdgeOne 项目（`blog-meowrain`），由 GitHub `main` 推送自动部署；CNB 这条流水线只更新它自己的 upload 项目。

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
