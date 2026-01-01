---
title: MySQLbinlog,redolog和undolog
published: 2025-08-09
description: ''
image: ''
tags: [MySQL, binlog, redolog, undolog]
category: '中间件 > MySQL'
draft: false 
lang: ''
---

# MySQL的binlog、redolog和undolog详解
![](https://blog.meowrain.cn/api/i/2025/08/09/kh6tf8-1.webp)

## binlog
binlog
用途： 
1. 主从复制
2. 数据恢复
3. 审计

## redolog（保证持久性）
redo log
目的： 确保事务的持久性
作用： 记录了数据被修改之后的值。当事务提交以后，即使数据还没有完全写入磁盘，只要redo log已经落盘,数据库在发生宕机等意外情况之后，仍然可以通过redo log来'重做'这些修改，从而恢复到宕机前的最新状态，保证了已提交事务的数据不可丢失，这是一种前滚操作。


## undolog（保证原子性）

目的： 保证事务的原子性和实现多版本并发控制。
作用： 记录的是数据被修改之前的旧版本。当一个事务需要回滚的时候，数据库可以利用undo log中的信息将数据恢复到事务开始前的状态。

![](https://blog.meowrain.cn/api/i/2025/08/09/lnk04g-1.webp)

![](https://blog.meowrain.cn/api/i/2025/08/09/lmvm5q-1.webp)



# 区别
![](https://blog.meowrain.cn/api/i/2025/08/09/kexum3-1.webp)

![](https://blog.meowrain.cn/api/i/2025/08/09/kgn410-1.webp)