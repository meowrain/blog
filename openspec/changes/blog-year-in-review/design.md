## Context

- Astro 5 静态站，文章来自 `src/content/posts` 内容集合，`getSortedPosts()` 已经处理了草稿过滤与置顶排序。
- 站内已有两个「构建期聚合、不带 JS」的先例：`WritingHeatmap.astro`（写作热力图）和 `ArchivePanel.astro`（按年分组归档），两者都用 `published` 的本地时间取年/月/日。年报沿用同一口径，保证热力图、归档、年报三处的年份归属一致。
- 字数与阅读时长只能通过 `await entry.render()` 拿到的 `remarkPluginFrontmatter.words / minutes`（`PostCard.astro` 就是这么用的），与文章卡片、详情页显示的数字完全同源。
- 站点是纯静态输出，构建机时区不一定等于 Asia/Shanghai。Astro 把不带时区的 frontmatter 时间按本地时间解析，因此「本地时间读写」在单次构建内自洽。这是现有代码就已经存在的取舍，本次不引入新的时区逻辑。

## Goals / Non-Goals

**Goals:**

- 任意一个有文章的年份都能通过 `/year/<year>/` 得到纯静态、可分享的年度报告
- 统计口径可解释，且与站内既有展示一致（字数、阅读时长、年份归属）
- 零客户端 JS：禁用 JS 也能读到全部数字，Swup 站内跳转后不需要额外初始化
- 统计逻辑集中在纯函数模块，页面与组件只负责展示

**Non-Goals:**

- 不接入 Umami 访客数据（「年度最受欢迎的文章」需要构建期快照，属于另一条链路，留给后续迭代）
- 不做交互式图表、不做逐屏滚动动画、不追求 Wrapped 式的仪式感
- 不改内容集合 schema，不要求作者补任何 frontmatter
- 不做按年 RSS、也不做年度专属 OG 分享图

## Decisions

### 1. 数据层放在 `src/utils/year-stats.ts`

导出 `buildYearReports(posts)`：输入 `CollectionEntry<posts>[]`，输出按年份倒序的 `YearReport[]`，每条报告一次算齐页面要用的全部指标。

- 年份归属：`new Date(post.data.published).getFullYear()`（本地时间）
- 字数/时长：`(await post.render()).remarkPluginFrontmatter`
- 指标：文章数、总字数、总阅读时长、平均字数、月度分布（12）、时段分布（24）、周几分布（7）、最长连续发文天数、单日最多发文、TOP 标签、分类分布、年度之最
- 同比：与上一年的文章数/字数差值；上一年没有文章时该字段为 `null`，页面隐藏对比块，避免出现失真的「+100%」

放在 `utils` 而不是组件内部，是为了让「年份划分」「连续天数」这类有边界情况的逻辑能被单独阅读、以后也能被别处复用（比如首页的年报入口卡片）。

### 2. 路由：`/year/` 索引 + `/year/[year]/` 详情

`[year].astro` 用 `getStaticPaths()` 为每个有文章的年份生成一页；`index.astro` 列出全部年份与概览。年份页顶部放相邻年份跳转，方便横向浏览。

### 3. 展示拆成三个组件

`YearSummary`（年份标题 + 大数字卡 + 同比）、`YearCharts`（月度柱状图 + 时段分布）、`YearRankings`（TOP 标签 + 分类分布 + 年度之最 + 当年文章清单）。柱状图全部是纯 CSS 柱条 + 内联 CSS 变量，不引图表库、不加脚本。

### 4. 复用站点视觉 token

沿用 `card-base`、`text-90/75/50/30`、`--primary`、`oklch(... var(--hue))` 等既有 token，让年报看起来是站内的一页，而不是外挂的落地页。

## Risks / Trade-offs

- **构建耗时**：取字数需要对文章调用 `render()`，年报生成会渲染当年全部文章。首页分页与归档页本来就在做同样的事，增量可接受。
- **时区漂移**：沿用本地时间口径，构建机不是 Asia/Shanghai 时，跨零点的文章可能被算到相邻年份。与现有热力图/归档行为一致，不在本次修复范围内。
- **词数口径**：`reading-time` 对中文按字、对英文按词，所以「总字数」是混合口径的近似值。沿用站点既有文案（`N 字`），不额外发明第二套计数。
- **冷清年份**：2024 年只有 1 篇文章，报告页会很空。这是数据本身的样子，不做特殊处理。
