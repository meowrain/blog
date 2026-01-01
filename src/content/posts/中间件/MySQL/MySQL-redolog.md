---
title: MySQL-redolog
published: 2025-09-16
description: ''
image: ''
tags: [MYSQL,redolog,MySQL]
category: '中间件 > MySQL'
draft: false 
lang: ''
---
![](https://blog.meowrain.cn/api/i/2025/09/16/11ci8hc-1.webp)
# Redo Log（实现持久化）
在InnoDB存储引擎中，大部分Redo Log记录的是物理日志，也就是对特定数据页进行的具体修改。
那么为啥要称呼它为大部分是物理日志呢？是因为Redo Log系统由两部分构成：
- 一是位于内存中的重做日志缓冲区（redolog buffer），这部分信息容易因为断电等原因丢失。
- 二是保存于磁盘上的重做日志文件（redolog file）提供持久化存储

## 引入redo log的必要性
尽管buffer pool确实极大提升了数据库操作的性能，但是由于它基于内存的特点，存在着固有的不稳定性，一旦发生系统崩溃或断电等故障，内存中的数据就可能会丢失。为了避免这种情况，Redo Log应运而生。
通过与buffer pool和change buffer协同工作，redolog负责记录所有尚未同步到磁盘的更改操作，确保即使发生故障重启以后也能恢复这些更新，直到相关页面被最终安全地写入到磁盘为止。

![](https://blog.meowrain.cn/api/i/2025/09/16/10r7qnc-1.webp)

## redo log和undo log之间的差异

- Redo Log专注于 记录事务完成后的新状态，也就是变更后的值
- Undo Log用来追踪事务开始前的原始状态，保存的是变更前的旧值

![](https://blog.meowrain.cn/api/i/2025/09/16/10uklpi-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/16/10wvrf2-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/16/10xmq2l-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/16/10xp98x-1.webp)


## 崩溃恢复
![](https://blog.meowrain.cn/api/i/2025/09/16/10xs9rk-1.webp)