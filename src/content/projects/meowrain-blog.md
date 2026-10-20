---
title: MeowRain Blog
description: 你现在看到的这个站：Astro 静态博客，加上搜索、系列、碎碎念和站内 AI。
url: https://blog.meowrain.cn
repo: https://github.com/meowrain/blog
icon: material-symbols:globe
tags: [Astro, TypeScript, Tailwind CSS]
status: active
featured: true
order: 1
published: 2021-01-02
---

这个站的前身是 2021 年在 GitHub Pages 上搭的第一个博客，换过好几次主题，最后停在
[Fuwari](https://github.com/saicaca/fuwari) 上，然后按自己的习惯一点点改成了现在这个样子。

## 做了哪些改造

- **站内搜索**：构建期生成 `posts-index.json`，客户端按中文 bigram 切词，支持分类和标签筛选
- **系列导航**：用 `series` frontmatter 把文章串成章节，自动生成上一章 / 下一章和进度条
- **碎碎念**：独立的短笔记集合，时间线展示，不需要每一条都够得上一篇长文
- **年度报告**：按年聚合写作数据，归档页还有「那年今天」
- **AI 助手**：EdgeOne 云函数里跑 agent，能检索站内文章，也能读当前文章出题讲解

## 一些取舍

静态站点没有数据库，所有数据都来自构建期的 Markdown。评论、搜索索引、AI 的
工具数据要么在构建时生成，要么交给云函数在运行时拉取。

图片没有做 Astro 的构建期优化，而是直接走图床和懒加载——构建 140 多篇文章时，
图片处理和 Markdown 渲染的开销比省下来的那点流量更贵。
