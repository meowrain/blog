---
title: MySQL-undolog（回滚日志）
published: 2025-09-16
description: ''
image: ''
tags: [MYSQL,undolog,MySQL]
category: '中间件 > MySQL'
draft: false 
lang: ''
---
![](https://blog.meowrain.cn/api/i/2025/09/16/11ci8hc-1.webp)
# 回滚日志 Undo Log

回滚日志是数据库引擎层生成的一种日志，主要用于确保事务的ACID特性中的`原子性`。它记录的是逻辑操作，也就是**数据在被修改之前的状态。** 
这些逻辑操作包括 插入，删除和更新

## 主要功能
1. 事务回滚： 当事务需要回滚的时候，通过执行undo log记录的逆向操作来恢复到事务开始前的数据状态
2. 多版本并发控制 MVCC： 结合ReadView机制，利用undo log实现多版本并发控制，从而支持高并发读写操作

## 记录内容
![](https://blog.meowrain.cn/api/i/2025/09/16/u7dxwr-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/16/u80n69-1.webp)

## 事务回滚
每条记录在进行更新操作的时候，产生的undo日志都包含一个roll_pointer指针和一个trx_id事务标识符。
- trx_id用于识别对特定记录执行修改的操作的具体事务
- roll_pointer 则允许把一系列相关的undolog日志链接起来形成所谓的**版本链**

![](https://blog.meowrain.cn/api/i/2025/09/16/ua6n2r-1.webp)

当某一个事务需要回滚的时候，并不是通过逆向执行SQL语句来恢复数据状态的，而是依据事务中roll_pointer指向的undolog日志条目来进行数据复原。

![](https://blog.meowrain.cn/api/i/2025/09/16/vqnibz-1.webp)