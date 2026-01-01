---
title: MySQL-binlog
published: 2025-09-16
description: ''
image: ''
tags: [MYSQL,binlog,MySQL]
category: '中间件 > MySQL'
draft: false 
lang: ''
---

![](https://blog.meowrain.cn/api/i/2025/09/16/11ci8hc-1.webp)
# binlog（二进制日志）
二进制日志主要用于记录所有针对数据库表结构的变更
以及对表数据的修改操作，不包括SELECT,SHOW等读取类的操作。
Binlog是在事务提交成功以后，在服务层生成的日志文件

作用：
1. 数据恢复： 通过详尽的记录所有影响数据状态的SQL命令，binlog为从特定时间点或者由于意外操作导致的数据丢失提供了恢复手段。一旦发生数据损坏或者丢失事件，可以通过重放binlog中的历史更改来恢复到先前的状态。
2. 主从复制： 对于需要跨多台服务器实现数据备份的应用场景，binlog提供了基础。通过将主服务器的binlog传输到从服务器，从服务器可以重放这些日志以实现数据的同步。

# binlog格式类型
MySQL支持三种类型的binlog格式：
`STATEMENT`,`ROW`和`MIXED `

- STATEMENT模式： 在这个模式下，每一条引起数据变化的SQL语句都会被记录下来。这种方式的优点在于减少了日志大小并且提高了处理速度。
然而，如果使用了SYSDATE（），NOW()之类的非确定性函数，就有可能导致在执行数据恢复或主从复制过程中产生一致性问题。

- ROW模式： 与记录整个SQL不同，ROW模式仅追踪实际受到影响的数据行的变化情况。这种方法避免了STATEMENT模式下的动态内容带来的挑战，但是代价是增加了日志文件的体积

- MIXED模式： 前两者的折中方案。根据具体情况自动选择最合适的记录方式。当系统认为STATEMENT更优的时候，使用STATEMENT模式；当系统认为ROW更优的时候，使用ROW模式。


# 记录方式
![](https://blog.meowrain.cn/api/i/2025/09/16/11buhw1-1.webp)

# 主从复制

![](https://blog.meowrain.cn/api/i/2025/09/16/11c1t5t-1.webp)
