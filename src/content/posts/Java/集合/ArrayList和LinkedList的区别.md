---
title: ArrayList和LinkedList的区别
published: 2025-08-06
description: ''
image: ''
tags: ['ArrayList', 'LinkedList']
category: 'Java > 集合框架'
draft: false 
lang: ''
---


# Java ArrayList和LinkedList的区别

ArrayList基于动态数组实现，LinkedList基于双向链表实现，这是它们所有性能差异的根本原因

ArrayList随机访问是O(1)，但是中间插入是O(n),LinkedList则相反，随机访问是O（n），但在已知位置的插入删除是O(1)

LinkedList由于要存储前后节点的引用，每个元素的内存开销更大，ArrayList更节省内存，但可能因为扩容机制造成一定的浪费。

# 实际应用场景

在实际项目中，如果需要频繁随机访问元素，会选择ArrayList，如果需要频繁在两端添加删除元素，比如实现队列和栈，我会选择LinkedList



ArrayList和LinkedList都是Java中常见的集合类，它们都实现了List接口。
底层数据结构不同：ArrayList使用数组实现，通过索引进行快速访问元素。
LinkedList使用链表实现，通过节点之间的指针进行元素的访问和操作。
插入和删除操作的效率不同：ArrayList在尾部的插入和删除操作效率较高，但在中间或开头的插入和删除操作效率较低，需要移动元素。
LinkedList在任意位置的插入和删除操作效率都比较高，因为只需要调整节点之间的指针。随机访问的效率不同：ArrayList支持通过索引进行快速随机访问，时间复杂度为O(1)。
LinkedList需要从头或尾开始遍历链表，时间复杂度为O(n)。
空间占用：ArrayList在创建时需要分配一段连续的内存空间，因此会占用较大的空间。LinkedList每个节点只需要存储元素和指针，因此相对较小。
使用场景：ArrayList适用于频繁随机访问和尾部的插入删除操作，而LinkedList适用于频繁的中间插入删除操作和不需要随机访问的场景。
线程安全：这两个集合都不是线程安全的，Vector是线程安全的