---
title: 说说TCP的三次握手
published: 2025-09-16
description: ''
image: ''
tags: [TCP,计算机网络]
category: '计算机网络'
draft: false 
lang: ''
---

# 流程
客户端给服务端发送一个SYN（同步序列号消息）给服务器，服务器收到后回复一个SYN + ACK（同步序列编号-确认）消息，最后客户端再发送一个ACK(确认)消息确认服务器已经收到了SYN-ACK消息，从而完成三次握手，建立起可靠的TCP连接。

![](https://blog.meowrain.cn/api/i/2025/09/16/qkipdz-1.webp)

# 为什么需要三次握手
- 避免历史错误连接的建立，减少通信双方不必要的资源消耗
- 帮助通信双方同步初始化序列号

> 所以为什么三次能解决历史错误连接的问题？
网络情况可能比较复杂，发送方第一次发送请求后，可能由于网络原因被阻塞住了，这个时候发送方可能又会再次发送请求，如果说握手只有两次，那么接收方只能拒绝或者接受，但是无法分清请求是旧的还是新的

![](https://blog.meowrain.cn/api/i/2025/09/16/qz2t5q-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/16/qzb8ro-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/16/r2w1yc-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/16/qnblw0-1.webp)


![](https://blog.meowrain.cn/api/i/2025/09/16/r3b7la-1.webp)

# 为什么不是四次握手
中间的syn + ack把两步合并了，精简了连接过程。