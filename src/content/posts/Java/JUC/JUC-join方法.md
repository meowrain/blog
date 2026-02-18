---
title: JUC-join方法
published: 2026-02-18T18:44:10
description: ''
image: 'https://blog.meowrain.cn/api/i/2026/02/18/umxyzl-1.png'
tags: [JUC,Java]
category: 'Java > JUC'
draft: false 
lang: ''
---

# JUC-join方法

在多线程编程中，我们经常遇到一种场景：线程 A 的执行必须依赖于线程 B 的执行结果。

比如：

- 必须先“下载图片”（线程 B），才能“显示图片”（线程 A）。
- 必须先“加载数据库数据”（线程 B），才能“计算报表”（线程 A）。

如果不加控制，线程 A 可能会在 B 还没结束时就跑完了，导致数据错误。这时候，就是 Thread.join() 登场的时候了。

![](https://blog.meowrain.cn/api/i/2026/02/18/ukdni5-1.png)

```java
package demo;

import java.util.concurrent.TimeUnit;

public class Demo1 {

    public static void main(String[] args) {

        new Thread(()->{
            System.out.println("妈妈开始做饭");
            try {
                TimeUnit.SECONDS.sleep(1);
            } catch (InterruptedException e) {
                throw new RuntimeException(e);
            }
            System.out.println("妈妈做好饭了");

        }).start();

        System.out.println("家人们可以吃饭了");
    }


}

```

# join 到底做了什么？

当在 main 方法中执行 mom.join() 时，发生的事情如下：

    谁在等待？ 是 Main 线程（调用者）在等待。

    等谁？ 等 mom 线程（被调用者）。

    状态变化：

        Main 线程：从 RUNNABLE 变为 WAITING（无限期等待）。

        mom 线程：继续欢快地运行。

    何时唤醒？ 当 mom 线程运行结束（Terminated），JVM 会自动唤醒所有在 mom 对象上等待的线程（这里就是 Main 线程）。

![](https://blog.meowrain.cn/api/i/2026/02/18/um5z1o-1.png)

t.join() 插队 调用方 等待 t 执行完 Yes (释放 t 的锁) RUNNABLE -> WAITING

![](https://blog.meowrain.cn/api/i/2026/02/18/umxyzl-1.png)
# 进阶用法：join(long millis)

如果你不想死等，可以使用 join(long millis)。
