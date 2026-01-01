---
title: Redis数据过期后的删除策略
published: 2025-09-17
description: ''
image: ''
tags: [Redis,删除策略,缓存过期]
category: '中间件 > Redis'
draft: false 
lang: ''
---

![](https://blog.meowrain.cn/api/i/2025/09/17/10egvdw-1.webp)

Redis数据过期主要有两种删除策略

![](https://blog.meowrain.cn/api/i/2025/09/17/10hp6uw-1.webp)
## 定期删除
Redis每隔一段时间会随机检查一定数量的键，如果发现过期的键，就把它删除。这种方式能够在后台持续清除过期数据，防止内存膨胀。

缺点： CPU占用稍微有点儿大
优点：能及时清除过期的键，防止内存膨胀。
## 惰性删除

在每次访问键的时候，去看这个键是不是已经过期了，如果过期了就删除它。
这种策略保证了在使用过程中只删除不再需要的数据，但在不访问过期键的时候不会被清除。

优点： 减少CPU占用
缺点： 如果一直没查到某个key，这个键就可能不会被删除，时间久了可能导致内存膨胀。

# 内存淘汰策略
![](https://blog.meowrain.cn/api/i/2025/09/17/10iw8w4-1.webp)

# Redis键过期时间的设置
![](https://blog.meowrain.cn/api/i/2025/09/17/10f1n1j-1.webp)