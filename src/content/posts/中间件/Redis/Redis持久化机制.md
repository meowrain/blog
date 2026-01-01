---
title: Redis持久化机制
published: 2025-09-17
description: ''
image: ''
tags: []
category: '中间件 > Redis'
draft: false 
lang: ''
---
![](https://blog.meowrain.cn/api/i/2025/09/17/umd7ep-1.webp)

# Redis 持久化机制
# Redis和Memcached的不同
Redis 不同于 Memcached 的很重要一点就是，Redis 支持持久化，而且支持 3 种持久化方式:
- 快照（snapshotting，RDB）
- 只追加文件（append-only file, AOF）
- RDB 和 AOF 的混合持久化(Redis 4.0 新增)


Redis支持丰富的数据结构，Memcached仅仅支持简单的键值对存储，而且只能是字符串


![](https://blog.meowrain.cn/api/i/2025/02/22/EXaKzG1740216393513470290.avif)

# RDB持久化
Redis 可以通过创建快照来获得存储在内存里面的数据在 某个时间点 上的副本。Redis 创建快照之后，可以对快照进行备份，可以将快照复制到其他服务器从而创建具有相同数据的服务器副本（Redis 主从结构，主要用来提高 Redis 性能），还可以将快照留在原地以便重启服务器的时候使用。

快照持久化是 Redis 默认采用的持久化方式，在 redis.conf 配置文件中默认有此下配置：
```
save 900 1           #在900秒(15分钟)之后，如果至少有1个key发生变化，Redis就会自动触发bgsave命令创建快照。

save 300 10          #在300秒(5分钟)之后，如果至少有10个key发生变化，Redis就会自动触发bgsave命令创建快照。

save 60 10000        #在60秒(1分钟)之后，如果至少有10000个key发生变化，Redis就会自动触发bgsave命令创建快照。
```
# RDB 创建快照时会阻塞主线程吗？
![](https://blog.meowrain.cn/api/i/2025/02/22/IzY7nu1740216454633699951.avif)

# 什么是 AOF 持久化？
与快照持久化相比，AOF 持久化的实时性更好。默认情况下 Redis 没有开启 AOF（append only file）方式的持久化（Redis 6.0 之后已经默认是开启了），可以通过 appendonly 参数开启：
```
appendonly yes
```
开启 AOF 持久化后每执行一条会更改 Redis 中的数据的命令，Redis 就会将该命令写入到 AOF 缓冲区 server.aof_buf 中，然后再写入到 AOF 文件中（此时还在系统内核缓存区未同步到磁盘），最后再根据持久化方式（ fsync策略）的配置来决定何时将系统内核缓存区的数据同步到硬盘中的。

只有同步到磁盘中才算持久化保存了，否则依然存在数据丢失的风险，比如说：系统内核缓存区的数据还未同步，磁盘机器就宕机了，那这部分数据就算丢失了。

AOF 文件的保存位置和 RDB 文件的位置相同，都是通过 dir 参数设置的，默认的文件名是 appendonly.aof。

AOF持久化功能的实现：

1. 命令追加
2. 文件写入 （写到内核缓冲区了，还没同步到硬盘）
3. 文件同步 （根据持久化方式向硬盘做同步操作）
4. 文件重写： 随着AOF文件越来越大，需要定期对AOF文件进行重写，达到压缩目的。
5. 重启加载： Redis重启的时候，可以加载AOF文件进行数据恢复。

![](https://blog.meowrain.cn/api/i/2025/02/22/XSEcK61740216646975756864.avif)


# AOF 持久化方式有哪些？
![](https://blog.meowrain.cn/api/i/2025/02/22/DZSVso1740216693705553035.avif)


# AOF 为什么是在执行完命令之后记录日志
![](https://blog.meowrain.cn/api/i/2025/02/22/3nEOWT1740216736909899485.avif)


