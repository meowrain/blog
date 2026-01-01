---
title: IO多路复用技术
published: 2025-07-19
description: ''
image: ''
tags: [IO,操作系统]
category: '操作系统'
draft: false 
lang: ''
---

# 参考资料

[万字图解| 深入揭秘IO多路复用](https://cloud.tencent.com/developer/article/2383534)

# 为什么要有IO多路复用技术？

在没有 I/O 多路复用（如 select/poll/epoll）时，同步 I/O 确实主要分为以下两种模式：

![](https://blog.meowrain.cn/api/i/2025/07/19/squh53-1.webp)

![](https://blog.meowrain.cn/api/i/2025/07/19/sqxtqj-1.webp)
![](https://blog.meowrain.cn/api/i/2025/07/19/sqzp5w-1.webp)

当处理 大量并发连接 时，上述两种同步模型存在致命缺陷：

阻塞 I/O：需要 1 线程/连接 → 线程切换开销大（C10K 问题）
非阻塞 I/O：CPU 空转轮询 → 资源浪费严重

![](https://blog.meowrain.cn/api/i/2025/07/19/srg062-1.webp)
![](https://blog.meowrain.cn/api/i/2025/07/19/srhn4e-1.webp)

# IO多路复用技术

IO多路复用是一种允许单个进程同时监视多个文件描述符的技术，使得程序能高效处理多个并发连接而无需创建大量线程。

## **select/poll/epoll**

select 的缺点是单个进程能监视的文件描述符数量有限，一般为 1024 个，且每次调用都需要将文件描述符集合从用户态复制到内核态，然后遍历找出就绪的描述符，性能较差。

poll 的优点是没有最大文件描述符数量的限制，但是每次调用仍然需要将文件描述符集合从用户态复制到内核态，依然需要遍历，性能仍然较差。

epoll 是 Linux 特有的 IO 多路复用机制，支持大规模并发连接，使用事件驱动模型，性能更高。其工作原理是将文件描述符注册到内核中，然后通过事件通知机制来处理就绪的文件描述符，不需要轮询，也不需要数据拷贝，更没有数量限制，所以性能非常高。

epoll使用了事件驱动模型

![](https://blog.meowrain.cn/api/i/2025/07/19/u32dv8-1.webp)
