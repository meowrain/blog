---
title: Redis的Hash是什么
published: 2025-09-11
description: ''
image: ''
tags: ['Redis']
category: '中间件 > Redis'
draft: false 
lang: ''
---

# Redis的Hash是什么


Redis的Hash是一种键值对集合，可以把多个字段和值存储在同一个键中，便于管理一些关联数据

比如一个用户信息，可以存储在Hash中，key为user:1，value为name:张三,age:18,gender:男
命令： HSET user:1 name 张三 age 18 gender 男

适合存储小数据，能够在内存中高效存储和操作
支持快速字段操作，比如增删改查，适合存储对象属性

![](https://blog.meowrain.cn/api/i/2025/09/11/111qad1-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/11/111rxfa-1.webp)

# Hash底层
Hash是Redis中的一种数据基础数据结构，类似于数据结构中的哈希表，一个Hash可以存储2的32次方-1个键值对（差不多40亿）。底层结构按照Redis版本分成两种情况：
- Redis6.0之前，Hash的底层是压缩列表加上哈希表的数据结构（ziplist + hashtable）
- Redis7之后，Hash的底层是紧凑列表(Listpack)加上哈希表的数据结构（Listpack + hashtable）

ziplist和listpack的效率差不多，时间复杂度都是O(n)
但是listpack解决了ziplist的级联更新问题



![](https://blog.meowrain.cn/api/i/2025/09/11/114aurs-1.webp)


hash-max-ziplist-entries 512：这是 Hash 类型使用 ziplist（压缩列表）编码的最大条目数阈值。当 Hash 的字段-值对数量 ≤ 512 时，Redis 会优先使用 ziplist 进行内存高效存储，以减少开销。
hash-max-ziplist-value 64：这是每个字段名（key）和值（value）的最大字节长度阈值。当所有字段名和值的字节长度均 ≤ 64 字节时，结合条目数阈值，Hash 会被编码为 ziplist。
优化目的：ziplist 是一种紧凑的序列化存储方式，能显著降低内存使用（平均节省 5 倍，最高 10 倍），但当超过阈值时，Redis 会自动转换为标准哈希表（hashtable），以保证性能。
Redis 版本注意：在 Redis 7.0 中，ziplist 被 listpack 取代（后者是其改进版），配置参数也相应更新为 hash-max-listpack-entries 和 hash-max-listpack-value，但默认值和行为保持一致。为了向后兼容，旧参数仍被支持作为别名。你的描述适用于 7.0 及更早版本。


# Hashtable
当Hash的键值对数量超过hash-max-ziplist-entries或者键和值的长度大于hash-max-ziplist-value时，Redis会自动转换为Hashtable

Hashtable其实就是哈希表实现，查询时间复杂度是O（1），效率很快

# rehash
![](https://blog.meowrain.cn/api/i/2025/09/11/11b5y0t-1.webp)