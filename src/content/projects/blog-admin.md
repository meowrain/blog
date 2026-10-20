---
title: 博客管理后台
description: 给这个纯 Markdown 博客配的 NestJS 后台，管文章、分类、标签和备份。
repo: https://github.com/meowrain/blog/tree/main/backend
icon: material-symbols:dashboard-customize-outline-rounded
tags: [NestJS, TypeScript, Express]
status: active
featured: false
order: 2
published: 2025-01-19
---

静态博客最麻烦的不是写文章，而是改文章。每次都要打开编辑器、找文件、改 frontmatter，
在手机上基本没法操作，所以写了一个直接读写仓库 Markdown 文件的后台。

## 功能

- 文章的增删改查，frontmatter 按 schema 校验后写回
- 从目录和 frontmatter 自动发现分类、标签，支持批量操作
- 图片上传
- 每次写入和删除保留上一版文件，可以列出和恢复
- 每个请求一个 id，贯穿日志，排查线上问题时能串起来

## 技术细节

没有用数据库，所有状态就是 Git 里的 Markdown 文件。备份目录不参与构建，也不会被
Astro 扫进内容集合。后台和博客在同一个仓库里，部署时只发布 `dist/`，后台单独跑。
