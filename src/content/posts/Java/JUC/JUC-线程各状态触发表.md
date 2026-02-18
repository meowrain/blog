---
title: JUC-线程各状态触发表
published: 2026-02-18T18:33:21
description: ''
image: 'https://blog.meowrain.cn/api/i/2026/02/18/ubkq6z-1.png'
tags: [JUC,Java]
category: 'Java > JUC'
draft: false 
lang: ''
---

# JUC-线程各状态触发表

![](https://blog.meowrain.cn/api/i/2026/02/18/ubkq6z-1.png)


# 操作系统线程状态和java线程状态的区别


![](https://blog.meowrain.cn/api/i/2026/02/18/ucj8lx-1.png)


![](https://blog.meowrain.cn/api/i/2026/02/18/ucq4sl-1.png)

![](https://blog.meowrain.cn/api/i/2026/02/18/uda2da-1.png)

Java 的 RUNNABLE 状态 涵盖了 操作系统层面的 Ready、Running 以及部分 Blocked（主要是 I/O 阻塞）状态。
