---
title: JVM内存模型分区
published: 2025-07-18
description: ''
image: ''
tags: [JVM,内存模型]
category: 'Java > JVM'
draft: false 
lang: ''
---
# JVM内存模型分⼏个区，每个区放什么对象

![image.png](https://blog.meowrain.cn/api/i/2025/07/18/12an835-1.webp)

![img](https://blog.meowrain.cn/api/i/2025/07/18/12b818c-1.webp)

![image.png](https://blog.meowrain.cn/api/i/2025/07/18/12b1jr4-1.webp)

![image.png](https://blog.meowrain.cn/api/i/2025/07/18/12awf70-1.webp)

分为方法区，堆，本地方法栈，虚拟机栈，程序计数器

方法区（元空间）：用于存储已经被虚拟机加载的类信息，常量，静态变量等数据。虽然方法区被描述为堆的逻辑部分，但有”非堆“的别名。方法区可以选择不实现垃圾收集，内存不足的时候，会抛出OutOfMemoryError异常。

程序计数器： 当前线程所执行的字节码的行号指示器，存储当前线程正在执行的Java方法的JVM指令地址。

JVM虚拟机栈：每个线程都有自己独立的Java虚拟机栈，生命周期和线程相同，每个方法在执行的时候都会创建一个栈帧，用来存储局部变量表，操作数栈，动态链接，方法出口等信息。

本地方法栈： 与Java虚拟机栈差不读多，执行本地方法，其中堆和方法区是线程共有的。

Java堆： 存放和管理对象实例，被所有线程共享。
