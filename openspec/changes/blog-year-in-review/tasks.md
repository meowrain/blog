## 1. 统计模块

- [x] 1.1 新增 `src/utils/year-stats.ts`，定义报告与指标类型
- [x] 1.2 实现按年份分组并倒序产出报告数组
- [x] 1.3 实现字数、阅读时长、平均字数聚合（用 `render()` 的 `remarkPluginFrontmatter`）
- [x] 1.4 实现月度、时段、周几分布统计
- [x] 1.5 实现最长连续发文天数与单日最多发文
- [x] 1.6 实现 TOP 标签与分类分布
- [x] 1.7 实现年度之最与同比（上一年无数据时为 `null`）

## 2. 展示组件

- [x] 2.1 `src/components/year/YearSummary.astro`：年份标题、数字卡、同比
- [x] 2.2 `src/components/year/YearCharts.astro`：月度柱状图、时段分布
- [x] 2.3 `src/components/year/YearRankings.astro`：TOP 标签、分类分布、年度之最、文章清单
- [x] 2.4 组件复用 `card-base` 与站点颜色 token，且不引入客户端 JS

## 3. 页面

- [x] 3.1 `src/pages/year/[year].astro`：用 `getStaticPaths()` 生成每年一页
- [x] 3.2 `src/pages/year/index.astro`：年份索引页
- [x] 3.3 年份页提供相邻年份跳转
- [x] 3.4 `src/pages/archive/index.astro` 加入 `/year/` 入口

## 4. 验证

- [x] 4.1 `pnpm type-check` 通过（本次新增代码无报错）
- [x] 4.2 `pnpm build` 通过，`dist/year/<year>/index.html` 正常生成
- [x] 4.3 抽查 2025/2026/2024 三年报告：文章数、总字数、年度之最与手工统计一致
- [x] 4.4 确认草稿不泄漏（仓库当前无 `draft: true` 文章）、无空年份页
