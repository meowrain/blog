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
- Markdown/MDX 内容集合，带 frontmatter 校验
- 站内搜索，基于构建出的 RSS 内容进行客户端检索
- 响应式布局、深色/浅色主题和主题色自定义
- Swup 页面过渡、目录、阅读时长、代码高亮和复制按钮
- KaTeX 数学公式、GitHub 风格的提示块和仓库卡片
- 图片画廊、图片放大预览和渐进图片回退
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
| `pnpm new-post <path>` | 创建新文章 |
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

## 站点配置

主要站点配置位于 `src/config.ts`：

- `siteConfig`: 标题、描述、语言、主题色、横幅、背景、目录、favicon 和站点链接
- `navBarConfig`: 导航栏链接
- `profileConfig`: 头像、昵称、简介和个人链接
- `licenseConfig`: 文章版权协议
- `umamiConfig`: Umami 统计
- `expressiveCodeConfig`: 代码高亮主题
- `gitHubEditConfig`: 文章编辑链接

构建和 Markdown 处理配置位于 `astro.config.mjs`，包括重定向、Swup、Sitemap、图标、Expressive Code、KaTeX、提示块和外部链接处理。

## 相册

相册图片放在按日期组织的目录中：

```text
public/api/i/YYYY/MM/DD/<filename>.<ext>
```

生成或更新相册索引：

```bash
node scripts/generate-gallery-index.js
```

脚本会扫描 `public/api/i`，并写入 `public/api/i/images.json`。相册页面读取该索引并生成瀑布流和灯箱预览。

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
