---
title: 站内 AI 助手
description: 跑在 EdgeOne 云函数上的两个 agent：找文章 / 学习助手，以及通用聊天。
url: https://blog.meowrain.cn/chat/
icon: material-symbols:smart-toy-outline-rounded
tags: [边缘计算, Agent, TypeScript]
status: wip
featured: true
order: 3
published: 2026-10-10
---

博客右下角那个胶囊和 `/chat/` 页面背后是同一套 agent 运行时，部署在 EdgeOne Pages 的
Node 云函数里，没有单独的服务器。

## 两个入口，两种分工

- `/find`：站内找文章 + 当前文章的学习助手。文章索引放在服务端当工具数据源，
  模型自己决定搜什么、读什么；正文只存在于浏览器，所以文章页会把正文一起递上来
- `/assistant`：通用聊天，能力靠联网搜索和网页正文抓取

路由名字和页面路径刻意错开：EdgeOne 的 `routes.json` 先匹配静态文件，
`POST /chat` 会被 `/chat/index.html` 整个接走，接口只能放 `/assistant`。

## 还在改的地方

- 索引里只有标题、小节标题和首段，长尾关键词召回还不够
- 工具调用的过程已经能如实显示，但多轮任务的成功率还依赖模型的规划
