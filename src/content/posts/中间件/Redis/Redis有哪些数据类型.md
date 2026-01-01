---
title: Redis有哪些数据类型
published: 2025-07-19
description: ''
image: 'https://blog.meowrain.cn/api/i/2025/07/19/p9zr81-1.webp'
tags: [Redis, 中间件, Redis数据类型]
category: '中间件 > Redis'
draft: false 
lang: ''
---


# 官方文档

[Redis官方文档](https://redis.io/docs/latest/develop/data-types/)
![](https://blog.meowrain.cn/api/i/2025/07/19/pesc98-1.webp)

![JavaBetter](https://javabetter.cn/sidebar/sanfene/redis.html#_3-%F0%9F%8C%9Fredis%E6%9C%89%E5%93%AA%E4%BA%9B%E6%95%B0%E6%8D%AE%E7%B1%BB%E5%9E%8B)

# 基本数据类型

Redis支持五种基本数据类型

## 字符串

![](https://blog.meowrain.cn/api/i/2025/07/19/pfuo04-1.webp)

![Redis数据类型-字符串](https://redis.io/docs/latest/develop/data-types/#strings)
![详细文档](https://redis.io/docs/latest/develop/data-types/strings/)

    字符串是最基本的数据类型，可以存储文本，数字或者二进制数据，最大的容量是512MB。适合缓存单个对象，比如验证码,token，计数器等。

## 列表

![](https://blog.meowrain.cn/api/i/2025/07/19/phht75-1.webp)

![Redis数据类型-列表](https://redis.io/docs/latest/develop/data-types/#lists)
![详细文档](https://redis.io/docs/latest/develop/data-types/lists/)

    列表是一个有序的字符串集合，可以在头部或尾部插入元素，适合用于消息队列，任务调度等场景。

## 哈希

![](https://blog.meowrain.cn/api/i/2025/07/19/pldpst-1.webp)

![Redis数据类型-哈希](https://redis.io/docs/latest/develop/data-types/#hashes)
![详细文档](https://redis.io/docs/latest/develop/data-types/hashes/)

    哈希是一个键值对集合，适合用于存储对象。可以通过字段名快速访问字段值，支持对单个字段的操作，节省内存。

## 集合

![](https://blog.meowrain.cn/api/i/2025/07/19/plo11d-1.webp)

![Redis数据类型-集合](https://redis.io/docs/latest/develop/data-types/#sets)
![详细文档](https://redis.io/docs/latest/develop/data-types/sets/)

    集合是一个无序的字符串集合，支持快速的成员查找，适合用于标签，好友关系等场景。
    可以进行集合运算，如交集，差集，并集等。
    平常拿来做一些去重操作。

## 有序集合

![](https://blog.meowrain.cn/api/i/2025/07/19/plwl0i-1.webp)

![Redis数据类型-有序集合](https://redis.io/docs/latest/develop/data-types/#sorted-sets)
![详细文档](https://redis.io/docs/latest/develop/data-types/sorted-sets/)

    有序集合是一个有序的字符串集合，每个元素都有一个分数，支持根据分数进行范围查询，适合用于排行榜，消息队列等场景。

![](https://blog.meowrain.cn/api/i/2025/07/19/pmk3s0-1.webp)

![](https://blog.meowrain.cn/api/i/2025/07/19/pn3s6u-1.webp)

# 扩展数据类型

[redis3种特殊类型详解](https://pdai.tech/md/db/nosql-redis/db-redis-data-type-special.html#redis%E5%85%A5%E9%97%A8---%E6%95%B0%E6%8D%AE%E7%B1%BB%E5%9E%8B3%E7%A7%8D%E7%89%B9%E6%AE%8A%E7%B1%BB%E5%9E%8B%E8%AF%A6%E8%A7%A3)

## 位图bitmap

[详细文档](https://redis.io/docs/latest/develop/data-types/bitmaps/)

![](https://blog.meowrain.cn/api/i/2025/07/19/rfx8t3-1.webp)

位图是一个特殊的字符串类型，用于存储二进制位。可以用来统计用户活跃度，签到等场景。

## 基数统计HyperLogLog

[详细文档](https://redis.io/docs/latest/develop/data-types/probabilistic/hyperloglogs/)

![](https://blog.meowrain.cn/api/i/2025/07/19/rek2t9-1.webp)
![](https://blog.meowrain.cn/api/i/2025/07/19/repxn1-1.webp)

基数统计通常用于统计不重复的元素数量，比如网站访问量，用户注册量等。

## 地理位置Geo

存储地理信息

## Bloom Filter

[详细文档](https://redis.io/docs/latest/develop/data-types/probabilistic/bloom-filter/)
