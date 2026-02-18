---
title: JUC-start()和run()的区别
published: 2026-02-18T17:44:02
description: ''
image: ''
tags: [JUC,Java]
category: 'Java > JUC'
draft: false 
lang: ''
---
# Thread.start()和Thread.run()的区别

`start()` 和 `run()` 最大的区别就一句话：**`start()` 会真的开新线程；`run()` 只是普通方法调用，不会并发。**

------

## 1）`run()`：普通方法调用（不新建线程）

你直接调用 `run()`，代码就在**当前线程**里顺序执行：

```java
Thread t = new Thread(() -> System.out.println(Thread.currentThread().getName()));
t.run(); // 还是 main 线程
```

输出通常是：`main`

------

## 2）`start()`：启动新线程（并发执行）

调用 `start()` 后，JVM 会创建一个新的操作系统线程，然后在**新线程**里回调你的 `run()`：

```java
Thread t = new Thread(() -> System.out.println(Thread.currentThread().getName()));
t.start(); // 新线程
```

输出通常是：`Thread-0`（或类似名字）

> 注意：`start()` 只是“让线程进入可运行状态”，什么时候真正执行由调度器决定，所以输出时序不固定。

------

![](https://blog.meowrain.cn/api/i/2026/02/18/txrk2e-1.png)
