---
title: Redis中常见的数据类型有哪些
published: 2025-09-10
description: 'Redis中常见的数据类型有哪些'
image: ''
tags: [Redis, 中间件, Redis数据类型]
category: '中间件 > Redis'
draft: false 
lang: ''
---
https://www.mianshiya.com/question/1780933295593254915

# Redis中常见的数据类型有哪些
常见的五种数据结构

5种数据类型示意图
![](https://blog.meowrain.cn/api/i/2025/09/10/suhd1q-1.webp)

# String
字符串是Redis种最基本的数据类型，可以存储任何类型的数据，包括文本，数字和二进制数据，最大长度是512MB

使用场景：
- 缓存： 存储临时数据，比如用户会话，页面缓存
- 计数器： 用于统计访问量，点赞数等，通过原子操作增加或者减少
- 分布式锁： 用于分布式锁，通过原子操作设置和释放锁

![](https://blog.meowrain.cn/api/i/2025/09/10/su1qk8-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/suonmx-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/suzbio-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/sv0s0r-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/sv2leb-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/sv4dpg-1.webp)


# List
列表是有序的字符串集合，支持从两端推入和弹出元素，底层实现是双向链表

使用场景： 
- 消息队列： 用于简单任务调度，消息传递场景，通过LPUSH和RPOP操作实现生产者和消费者模式
- 历史记录： 存储用户操作的历史记录，便于快速访问。
![](https://blog.meowrain.cn/api/i/2025/09/10/svjzbo-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/svm8vj-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/svoe51-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/svqxit-1.webp)



# Set
集合是无需而且不重复的字符串集合，使用哈希表实现，支持快速查找和去重操作。
使用场景：
- 标签： 用于存储标签，便于快速查找
- 集合运算： 用于存储集合，便于进行集合运算，如交集，差集，并集等

![](https://blog.meowrain.cn/api/i/2025/09/10/sxh62n-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/sxjlh8-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/sxlmx2-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/sxn9zd-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/sxxtmw-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/sxzjm2-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/10/sy11fg-1.webp)
# ZSet
有序集合是按分数排序的字符串集合，使用跳表实现，支持快速查找和范围查询。
使用场景：
- 排行榜： 用于存储排行榜，便于快速查找
![](https://blog.meowrain.cn/api/i/2025/09/10/sy75as-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/sy8xwf-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/sympbg-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/syqfgo-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/sysm37-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/syuiyd-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/sz50a7-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/sz7ftu-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/sz8r8r-1.webp)

# Hash
哈希是键值对的集合，使用哈希表实现，支持快速查找和存储对象。
使用场景：
- 对象存储： 可以用来缓存对象，比如用户信息，商品信息等

![](https://blog.meowrain.cn/api/i/2025/09/10/sw5vdr-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/sw8g23-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/swc1j3-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/sweoot-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/10/swzinu-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/10/sxei2s-1.webp)


# 其它数据结构
![](https://blog.meowrain.cn/api/i/2025/09/10/szef96-1.webp)