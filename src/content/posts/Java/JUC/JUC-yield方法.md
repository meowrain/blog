---
title: JUC-yield方法
published: 2026-02-18T18:37:38
description: ''
image: ''
tags: [JUC,Java]
category: 'Java > JUC'
draft: false 
lang: ''
---

# JUC-yield方法 


## 核心概念

    定义：yield 是 Thread 类的静态方法。它告诉当前正在执行的线程：“如果你现在不急的话，可以把 CPU 让给其他线程去跑一跑。”

    作用：它会提示线程调度器（Scheduler），当前线程愿意放弃当前的 CPU 使用权。

    结果：

        线程从 Running（运行中） 状态转变为 Ready（就绪） 状态。

        注意：在 Java 的线程状态定义中，这两个都属于 RUNNABLE。所以调用 yield() 后，线程状态依然是 RUNNABLE，不会变成 WAITING 或 BLOCKED。

yield() 只是给操作系统的线程调度器发送一个建议。

    调度器完全可以忽略这个建议。

    如果 CPU 资源很空闲，或者没有其他同优先级的线程在等待，调度器可能让当前线程继续执行，yield 就跟没调一样。

> 注意： yield也不会让出锁，和sleep是一样的。