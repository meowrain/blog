---
title: Redis主从复制的实现原理是什么
published: 2025-09-17
description: ''
image: ''
tags: [主从复制,中间件,Redis]
category: '中间件 > Redis'
draft: false 
lang: ''
---

# 为什么需要主从复制
1. 降低数据冗余
2. 提高故障恢复
3. 支持负载均衡
4. 高可用


# 主从库之间采用读写分离方式：
![](https://blog.meowrain.cn/api/i/2025/09/17/upct3j-1.webp)


# 两种同步方式
1. 全量复制： 第一次同步的时候
2. 增量复制： 只会把主从库网络断联期间主库收到的命令同步给从库

## 全量复制
![](https://blog.meowrain.cn/api/i/2025/09/17/w9rfaa-1.webp)


## 增量复制

![](https://blog.meowrain.cn/api/i/2025/09/17/w9vq4z-1.webp)