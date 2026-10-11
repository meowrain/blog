## ADDED Requirements

### Requirement: 年份划分与统计范围

系统 SHALL 以文章 `published` 的本地时间年份作为年报归属年份，SHALL 只统计生产构建下可见的文章（排除草稿），并 SHALL 为每一个至少有一篇文章的年份生成一份年报。

#### Scenario: 生成年份列表

- **WHEN** 站点构建时聚合全部文章
- **THEN** 得到去重后的年份集合，按年份倒序排列
- **AND** 每个年份恰好对应一个 `/year/<year>/` 页面

#### Scenario: 草稿不计入

- **WHEN** 生产构建（`import.meta.env.PROD`）聚合文章
- **THEN** `draft: true` 的文章不出现在任何年份的统计与清单里

#### Scenario: 空年份

- **WHEN** 某一年没有任何文章
- **THEN** 不生成该年的报告页，索引页也不列出该年

### Requirement: 年度索引页

系统 SHALL 提供 `/year/` 页面，列出所有有文章的年份及其年度概览，并链接到对应的年度报告页。

#### Scenario: 访问索引页

- **WHEN** 访客访问 `/year/`
- **THEN** 页面按年份倒序列出每一年
- **AND** 每一年显示文章数、总字数、总阅读时长中的至少两项
- **AND** 每一年可点击跳转到 `/year/<year>/`

### Requirement: 年度报告指标

系统 SHALL 在年度报告页展示该年的核心统计指标，且指标数值 SHALL 与站内文章卡片对同一篇文章展示的字数、阅读时长一致。

#### Scenario: 核心数字

- **WHEN** 渲染某年报告
- **THEN** 展示该年文章数、总字数、总阅读时长
- **AND** 字数为该年各文章 `remarkPluginFrontmatter.words` 之和
- **AND** 阅读时长为该年各文章 `remarkPluginFrontmatter.minutes` 之和

#### Scenario: 时间分布

- **WHEN** 渲染某年报告
- **THEN** 展示 12 个月的月度发文分布
- **AND** 展示按发布时刻小时数聚合的时段分布
- **AND** 展示最长连续发文天数

#### Scenario: 内容分布

- **WHEN** 渲染某年报告
- **THEN** 展示该年出现次数最多的标签及其次数
- **AND** 展示该年的分类分布

#### Scenario: 年度之最

- **WHEN** 渲染某年报告
- **THEN** 展示该年最长与最短的文章（按字数）
- **AND** 展示该年第一篇与最后一篇文章
- **AND** 展示单日发文最多的一天

#### Scenario: 同比

- **WHEN** 上一年存在文章
- **THEN** 展示该年相对上一年的文章数变化
- **WHEN** 上一年没有文章
- **THEN** 隐藏同比区块，不显示失真的增长百分比

### Requirement: 纯静态渲染

年度报告页 SHALL 在构建期完成全部渲染，SHALL NOT 依赖客户端 JS 才能显示数据，也 SHALL NOT 在构建期发起外部网络请求。

#### Scenario: 无 JS 可读

- **WHEN** 访客禁用 JavaScript 打开年度报告
- **THEN** 所有统计数字、图表与文章清单照常显示

### Requirement: 可发现性

系统 SHALL 让访客能从站内到达年度报告。

#### Scenario: 归档页入口

- **WHEN** 访客打开 `/archive/`
- **THEN** 页面上存在指向 `/year/` 的可见入口

#### Scenario: 年份间跳转

- **WHEN** 访客在某年报告页
- **THEN** 可以直接跳到相邻的其它年份报告页
