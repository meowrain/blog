---
title: Jvm常见垃圾收集器
published: 2025-07-18
description: ''
image: ''
tags: [Java,JVM,垃圾收集器]
category: 'Java > JVM'
draft: false 
lang: ''
---
# Java中常见的垃圾收集器

GC收集器有哪些?

1.serial收集器
单线程，工作时必须暂停其他工作线程。多用于client机器上，使用复制算法
2.ParNew收集器
serial收集器的多线程版本，server模式下虚拟机首选的新生代收集器。复制算法
3.Parallel Scavenge收集器
复制算法，可控制吞吐量的收集器。吞吐量即有效运行时间。
4.Serial Old收集器
serial的老年代版本，使用整理算法。
5.Parallel Old收集器
第三种收集器的老年代版本，多线程，标记整理
6.CMS收集器
目标是最短回收停顿时间。

7.G1收集器,基本思想是化整为零，将堆分为多个Region，优先收集回收价值最大的Region。

[垃圾收集器_java垃圾收集器-CSDN博客](https://blog.csdn.net/binbinxyz/article/details/141821712)

![image.png](https://blog.meowrain.cn/api/i/2025/07/18/10lr31h-1.webp)

![image.png](https://blog.meowrain.cn/api/i/2025/07/18/10lrj5p-1.webp)

![image.png](https://blog.meowrain.cn/api/i/2025/07/18/10lrmof-1.webp)

![image.png](https://blog.meowrain.cn/api/i/2025/07/18/10lrvwa-1.webp)

![image.png](https://blog.meowrain.cn/api/i/2025/07/18/10ls1dm-1.webp)

# G1垃圾回收器

[G1垃圾回收](Java%E4%B8%AD%E5%B8%B8%E8%A7%81%E7%9A%84%E5%9E%83%E5%9C%BE%E6%94%B6%E9%9B%86%E5%99%A8%2022a49a1194e98020a75ced52b5d871d7/G1%E5%9E%83%E5%9C%BE%E5%9B%9E%E6%94%B6%2022a49a1194e980e9bbf7e2a6c0f3e4c6.md)
