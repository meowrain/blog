---
title: Redis如何实现分布式锁
published: 2025-09-13
description: ''
image: ''
tags: ['Redis','中间件','分布式锁']
category: '中间件 > Redis'
draft: false 
lang: ''
---


# 分布式锁
在Redis中实现分布式锁的常见方法是通过 set ex nx命令+lua脚本组合使用，确保多个客户端不会获得同一个资源锁的同时，也保证了安全解锁和意外情况下锁的自动释放。

## 理解Redis实现的分布式锁
如果基于Redis来实现分布式锁，需要使用set ex nx命令+ lua脚本

加锁： `SET lock_key uniqueValue EX expiretime NX`
解锁： 使用lua脚本，先get获取key的value判断锁是否是自己加的，如果是则del
```lua
if redis.call("GET",KEYS[1]) == ARGV[1]
then
    return redis.call("DEL",KEYS[1])
else
    return 0
end
```

锁需要有过期机制，假设某个客户端加锁后宕机了，锁没设置过期机制，就会让其他客户端抢不到锁。

EX expiretime 设置的单位是秒，PX expiretime设置的是毫秒

上面为啥要用`uniqueValue`呢，这个就是唯一的值，是为了防止锁被其他客户端释放掉。

## 实现分布式锁的步骤
1. 加锁：使用`SET lock_key uniqueValue EX expiretime NX`命令加锁
2. 解锁：使用lua脚本，先get获取key的value判断锁是否是自己加的，如果是则del
3. 锁需要有过期机制，假设某个客户端加锁后宕机了，锁没设置过期机制，就会让其他客户端抢不到锁。
4. EX expiretime 设置的单位是秒，PX expiretime设置的是毫秒
5. 上面为啥要用`uniqueValue`呢，这个就是唯一的值，是为了防止锁被其他客户端释放掉。
6. 锁需要有过期机制，假设某个客户端加锁后宕机了，锁没设置过期机制，就会让其他客户端抢不到锁。
