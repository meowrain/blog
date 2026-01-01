---
title: concurrenthashmap的实现原理
published: 2025-08-06
description: ''
image: ''
tags: [ConcurrentHashMap,Java]
category: 'Java > 集合框架'
draft: false 
lang: ''
---


#  ConcurrentHashMap实现原理

ConcurrentHashMap是Java并发包中一种线程安全的哈希表实现。
HashMap在多线程环境下扩容会出现CPU接近100%的情况，因为HashMap并不是线程安全的，我们可以通过Collections里面的Map<K,V> synchronizedMap(Map<K,V> m) 把HashMap包装成一个线程安全的map

比如SynchronizedMap的put方法就是加锁过的


# ConcurrentHashMap的变化
ConcurrentHashMap在JDK1.7中，提供了一种粒度更细的加锁机制，这种机制叫分段锁，整个哈希表被分为多个段，每个段都独立锁定。读取操作不需要锁，写入操作仅锁定相关的段，这减小了锁冲突的几率，提高了并发性能。

这种机制的优点是： 在并发环境下将实现更高的吞吐量，在单线程环境下只损失非常小的性能。

可以这样理解分段锁，就是将数据分段，对每一段数据分配一把锁，当一个线程占用锁访问其中一个段数据的时候，其他段的数据也能被其他线程访问。

有些方法需要跨段，比如size(),isEmpty(),containsValue()，它们可能需要锁定整个表而不仅仅是某个段，这需要按顺序锁定所有段，操作完以后，再按顺序释放所有段的锁。


ConcurrentHashMap是由Segment数组结构和HashEntry构成的，Segment是一种可重入的锁，HashEntry则用于存储键值对数据。

一个ConcurrentHashMap里面包含一个Segment数组，Segment的结构和HashMap类似，是一种数组和链表结构，一个Segment里包含一个HashEntry数组，每个HashEntry是一个链表结构的元素，每个Segment守护着一个HashEntry数组里的元素，当HashEntry数组的数据进行修改的时候，必须首先获得它对应的Segment锁。

在外部：有一个 Segment 数组，作为并发控制的“总入口”，每个 Segment 都是一个独立的锁喵～
在内部：每个 Segment 自己就是一个完整的小型 HashMap！它有自己的哈希表数组，里面的每个桶都可以通过 next 指针挂着一个或多个 Entry 组成的链表.



# ConcurrentHashMap 读写过程

## get方法
- 为输入的key做hash运算，得到hash值
- 通过Hash值，定位到对应的Segment对象
- 	再次通过hash值，定位到Segment当中数组的具体位置


## put方法
- 为输入的key做hash运算，得到hash值
- 通过hash值，定位到对应的Segment对象
- 获取可重入锁
- 再次通过hash值，定位到Segment当中数组的具体位置
- 插入或者覆盖HashEntry对象
- 释放锁


# JDK1.8
在JDK1.8中，ConcurrentHashMap主要做了两个优化：
- 和HashMap一样，链表也会在长度到达8的时候转换为红黑树，这样可以提升大量冲突的时候的查询效率。
- 以某个位置的头结点为锁，配合自旋 + CAS 避免不必要的锁开销，进一步提升并发性能。
- 相比JDK1.7中的ConcurrentHashMap,JDK1.8的ConcurrentHashMap取消了Segment分段锁，采用CAS + synchronized来保证并发安全性。整个容器只分为一个Segment，也就是table数组。
- JDK1.8中的ConcurrentHashMap对节点Node类中的共享变量，和JDK1.7一样，使用volatile关键字，保证多线程操作的时候，变量的可见性。


# ConcurrentHashMap的字段
1. table
这个装载Node的数组，作为ConcurrentHashMap的底层容器，采用加载的方式，直到第一次插入数据的时候才会进行初始化操作
数组的大小是2的幂次方。

