---
title: Jvm分代回收机制
published: 2025-07-18
description: ''
image: ''
tags: [分代回收,JVM]
category: 'Java > JVM'
draft: false 
lang: ''
---
# 分代回收

[juejin.cn](https://juejin.cn/post/7474503566154858536)

[【GC系列】JVM堆内存分代模型及常见的垃圾回收器-腾讯云开发者社区-腾讯云](https://cloud.tencent.com/developer/article/1755848)

[Eden与Survivor区 · Homurax's Blog](https://blog.homurax.com/2018/09/17/eden-survivor/)

[Java 虚拟机之垃圾收集](https://dunwu.github.io/waterdrop/pages/587898a0/)

[JVM内存分配策略](https://linqiankun.github.io/hexoblog/md/jvm/JVM%E5%86%85%E5%AD%98%E5%88%86%E9%85%8D%E7%AD%96%E7%95%A5/)

现代JVM堆内存的典型划分：

1. 年轻代（Young Generation）
2. 老年代（Old Generation）
3. 永久代/元空间（Permanent Gen/Metaspace）

## JDK7堆空间内部结构

![image.png](https://blog.meowrain.cn/api/i/2025/07/18/10mvpvg-1.webp)

特点：

永久代位于堆内存中

字符串常量池存放在永久代

方法区使用永久代实现

## JDK8堆空间内部结构

![image.png](https://blog.meowrain.cn/api/i/2025/07/18/10mvro2-1.webp)

永久代被元空间替换，元空间不属于堆内存。

元空间使用本地内存

字符串常量池移至堆内存

方法区改由元空间实现。

## 年轻代与老年代

JVM 内置的通用垃圾回收原则。堆内存划分为 Eden、Survivor(年轻代) ， Tenured/Old (老年代)空间：

![image.png](https://blog.meowrain.cn/api/i/2025/07/18/10mvw5e-1.webp)

核心规则：

1. 对象优先在Eden区分配
2. 大对象直接进入老年代
3. 长期存活对象进入老年代（默认年龄阈值15）
4. 动态年龄判断（Survivor区中相同年龄对象总和超过50%时候晋升）

在 JVM 中，**年龄阈值（Tenuring Threshold）** 是一个关键的参数，它决定了新生代（Young Generation）中的对象需要经历多少次垃圾回收（Minor GC）仍然存活，才会被晋升（Promotion）到老年代（Old Generation）。

年轻代分为Eden区和Survivor区，Survivor区又分为S0,S1，S0,S1其中一个作为使用区（from)，一个作为空闲区(to)（不固定，可能S0是空闲区，也可能是使用区）
在Minor GC开始以后（会回收Eden区和使用区中的对象），逃过第一轮GC的，在Eden区和使用区中的对象，会被丢在空闲区,接下来将使用区和空闲区互换（空闲区变使用区，使用区变空闲区），等待下一次Eden区满进行Minor GC，以此不断循环（每复制一次，年龄就会 + 1）

![image.png](https://blog.meowrain.cn/api/i/2025/07/18/10mw6vd-1.webp)

![image.png](https://blog.meowrain.cn/api/i/2025/07/18/10mwdnp-1.webp)

# 堆空间大小设置

![image.png](https://blog.meowrain.cn/api/i/2025/07/18/10mwjcx-1.webp)

![image.png](https://blog.meowrain.cn/api/i/2025/07/18/10mwpa5-1.webp)
