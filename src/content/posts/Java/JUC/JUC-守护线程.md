---
title: JUC-守护线程
published: '2026-02-18T21:15:17.000Z'
description: ''
image: ''
tags:
  - JUC
  - Java
category: Java > JUC
draft: false
lang: ''
---

# JUC-守护线程

在 Java 中，线程分为两类：

    用户线程 (User Thread)：系统的工作线程，执行业务逻辑（比如 main 线程）。

    守护线程 (Daemon Thread)：为其他线程提供服务的后台线程（比如 垃圾回收线程 GC）


JVM 的退出机制只看用户线程：

    只要有一个用户线程还在运行，JVM 就不会退出。

    如果所有用户线程都结束了，JVM 就会退出，不管此时有没有守护线程在运行。

        JVM 会直接“杀掉”所有剩下的守护线程，不留任何情面。
  
  
  ![](https://blog.meowrain.cn/api/i/2026/02/18/z2g42b-1.png)
  
  ```java
  
  package demo;

import java.util.concurrent.TimeUnit;

import java.util.concurrent.TimeUnit;

public class InterruptSleepDemo {
    public static void main(String[] args) throws InterruptedException {
        Thread t1 = new Thread(() -> {
            while (true) {
                if(Thread.currentThread().isInterrupted()) {
                    break;
                }
                try {
                    TimeUnit.SECONDS.sleep(1);
                    System.out.println(Thread.currentThread().getName() + "开始监控");
                } catch (InterruptedException e) {
                    System.out.println("监控线程被终止,当前interrupted状态: " + Thread.currentThread().isInterrupted());
                    System.out.println("手动设置为已终止状态，让这个循环能正常退出");
                    Thread.currentThread().interrupt();
                    System.out.println("档期那监控线程interrupted状态：" + Thread.currentThread().isInterrupted());
                }
            }
        });



        t1.start();

    }
}
```
可以看到这个java程序因为t1还没结束，就一直运行，因为t1是用户线程。JVM只有在用户线程全部停止后才会停止。




![](https://blog.meowrain.cn/api/i/2026/02/18/z3h6p5-1.png)

我们把t1设置为守护线程，能看到，t1还没执行，主线程就退出了，随着主线程的退出，t1也不再继续运行了。
