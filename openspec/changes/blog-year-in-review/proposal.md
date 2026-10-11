## Why

博客已经攒下 141 篇文章（2025 年 112 篇、2026 年 28 篇），但站点只能按归档、分类、标签平铺地看文章，没有任何地方把「这一年我写了什么」讲成一个整体。年度报告能把零散的文章列表变成有情绪、可分享的年度总结，也顺手把只有作者才关心的写作习惯（什么时候写、写多长、最常写什么）暴露出来。

## What Changes

- 新增 `/year/` 年度报告索引页，列出所有有文章发布的年份与年度概览
- 新增 `/year/<year>/` 年度报告页，纯构建期渲染、零客户端 JS
- 报告内容：发文数、总字数、总阅读时长、月度分布、发文时段分布、最长连续写作天数、TOP 标签、分类分布、年度之最（最长/最短/首篇/末篇/单日最多）、与上一年的对比、当年文章清单
- 新增 `src/utils/year-stats.ts`，把文章集合聚合成年度统计数据
- 新增 `src/components/year/` 下的年报展示组件
- 归档页新增「年度报告」入口

## Capabilities

### New Capabilities

- `year-in-review`: 按年份聚合文章统计并渲染年度报告，覆盖年份划分口径、统计指标、页面路由、纯静态渲染与可发现性

### Modified Capabilities

（无。归档页只是多一个指向 `/year/` 的链接，不改变归档页自身的行为契约。）

## Impact

- 新增：`src/utils/year-stats.ts`、`src/components/year/*.astro`、`src/pages/year/index.astro`、`src/pages/year/[year].astro`
- 修改：`src/pages/archive/index.astro`（入口链接）
- 构建：新增若干静态页；不引入新依赖、不新增运行时接口、不修改内容集合 schema
- 复用：`getSortedPosts()` 与 `remark-reading-time` 产出的 `words`/`minutes`，与文章卡片口径同源
