---
title: RedisZset实现原理
published: 2025-09-11
description: ''
image: ''
tags: ['Redis']
category: '中间件 > Redis'
draft: false 
lang: ''
---

# Redis ZSet实现原理

是一种由跳表和哈希表组成的数据结构。ZSet结合了集合的特性和排序功能，能存储具有唯一性的成员，并且根据成员的分数进行排序。

由
- 跳表： 用于存储数据的排序和快速查找
- 哈希表： 用于存储成员和它分数的映射，提供快速查找


当元素数量较少的时候，Redis采用压缩列表来节省内存。
元素个数<=zset-max-ziplist-entries，并且每个元素的值小于zset-max-ziplist-value

如果任何一个条件都不满足，Zset采用跳表加哈希表作为底层实现。


![](https://blog.meowrain.cn/api/i/2025/09/11/12i8qms-1.webp)