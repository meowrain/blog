---
title: HashMap和ConcurrentHashMap的区别
published: 2025-08-11
description: ''
image: ''
tags: [ConcurrentHashMap,Java]
category: 'Java > 集合框架'
draft: false 
lang: ''
---

# JDK1.7版本
- 内存结构： HashMap采用数组+链表的结构，数组是HashMap的主体，链表用于解决哈希冲突。当两个不同的键通过哈希函数计算得到相同的索引时，它们会被存储在同一个数组位置的链表中。ConcurrentHashMap在JDK1.7中采用了分段锁的机制，内部是一个Segment数组，每个Segment类似一个小的HashMap，有自己的数组和链表。

- 线程安全性： HashMap不是线程安全的，在多线程环境下，如果多个线程同时对HashMap进行读写操作，可能会导致数据不一致，死循环的问题。ConcurrentHashMap是线程安全的，它通过分段锁的机制来保证并发访问时的线程安全。只有当多个线程访问同一个Segment时，才会发生锁竞争，从而提高了并发性能。

- 性能： hashmap由于没有锁的开销，所以在单线程环境下性能较好，但是在多线程环境下，为了保证线程安全，需要额外的同步机制，这回降低性能。但是ConcurrentHashMap通过分段所机制，在多线程环境下可以实现更高的并发性能，不同的线程可以同时访问不同的Segment，从而减少了锁竞争的可能性。


# JDK1.8版本
内存结构： hashMap引入了红黑树，从Jdk1.8开始，hashmap采用数组+ 链表+ 红黑树的结构。当链表长度超过一定阈值（8）的时候，链表会转换为红黑树，小于6的时候会转换为链表，以提高查找效率。ConcurrentHashMap放弃了分段锁机制，采用`CAS + synchronized`的方式保证线程安全，内部结构和HashMap一样，也引入了红黑树，是数组+ 链表+ 红黑树的结构。

线程安全性： ConcurrentHashMap通过CAS和synchronized的方式保证线程安全。在插入元素的时候，首先会尝试用CAS更新节点，如果CAS失败，则使用synchronized锁住当前节点，再进行插入操作。

性能： hashmap在单线程环境下，由于红黑树的引入，当链表较长的时候查找效率会有所提升。ConcurrentHashMap在多线程环境下，由于摒弃了分段锁，减少了锁的粒度，进一步提高了并发性能。同时，红黑树的引入也提高了查找效率。