---
title: JUC-interrupt方法
published: 2026-02-18T19:06:36
description: ''
image: ''
tags: [JUC,Java]
category: 'Java > JUC'
draft: false 
lang: ''
---

> Java中的thread.interrupt()方法和linux中的kill -9命令有着本质的区别。 
> interrupt()方法的唯一作用是： 设置一个标志位
>
> 至于线程是立刻停止，稍后停止，还是完全无视这个信号，完全取决于线程内部的代码逻辑。

# 三种使用场景

## 场景A 线程处于阻塞状态
如果线程正在执行sleep(),wait()和join()等阻塞方法（会让线程进入TIMED_WAITING状态），调用interrupt()会抛出InterruptedException异常。

> 重要细节：抛出异常的同时，中断标志位会被自动清除（置为 false）。


## 场景B 线程处于运行状态

如果线程正在正常运行（RUNNABLE状态），调用interrupt()不会抛出异常，而是将中断标志位设置为 true。

此时，线程需要在适当的地方检查这个标志位，以决定是否应该停止执行。


## 场景C IO阻塞
- 传统的IO阻塞（如InputStream.read()）不会响应interrupt()，线程会继续阻塞，直到IO操作完成。
- NIO (New IO) 的 SocketChannel 等是支持中断的，会抛出 ClosedByInterruptException。

# 实战演示


打断sleep中的线程
```java
package demo;

import java.util.concurrent.TimeUnit;

import java.util.concurrent.TimeUnit;

public class InterruptSleepDemo {
    public static void main(String[] args) throws InterruptedException {
        Thread t1 = new Thread(() -> {
            try {
                System.out.println("T1: 我准备睡 10 秒...");
                TimeUnit.SECONDS.sleep(10);
                System.out.println("T1: 睡醒了 (但这句通常不会执行)");
            } catch (InterruptedException e) {
                // 捕获异常，响应中断
                System.out.println("T1: 谁打扰我睡觉！(检测到中断异常)");
                // 此时 flag 已经被 JVM 清除了
            }
        });

        t1.start();

        // 主线程歇 1 秒，确保 t1 已经睡着
        TimeUnit.SECONDS.sleep(1);

        System.out.println("Main: 我要打断 T1");
        t1.interrupt(); // 拍拍 T1 的肩膀
    }
}
```


![](https://blog.meowrain.cn/api/i/2026/02/18/wbkc4v-1.png)



中断“跑着”的线程 (需要配合检查)

```java
package demo;

import java.util.concurrent.TimeUnit;

import java.util.concurrent.TimeUnit;

public class InterruptSleepDemo {
    public static void main(String[] args) throws InterruptedException {
        Thread t1 = new Thread(() -> {
            while(!Thread.currentThread().isInterrupted()) {
                System.out.println("计算中");
            }
            System.out.println("收到终止信号，结束线程: " + Thread.currentThread().getName());
        });

        t1.start();

        // 主线程歇 1 秒，确保 t1 已经睡着
        TimeUnit.SECONDS.sleep(1);

        System.out.println("Main: 我要打断 T1");
        t1.interrupt(); // 拍拍 T1 的肩膀
    }
}

```


![](https://blog.meowrain.cn/api/i/2026/02/18/wd5msv-1.png)




# 两阶段终止


先看第一版代码：
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
                    System.out.println("监控线程被终止");
                }
            }
        });



        System.out.println("Main: 我要打断 T1");

        t1.start();
        TimeUnit.SECONDS.sleep(5);
        t1.interrupt(); // 拍拍 T1 的肩膀

    }
}
```

这里的缺陷是：当 t1 在 sleep 中被打断时，抛出 InterruptedException 异常后，线程会继续执行 while 循环，导致监控线程无法正常结束。

为什么呢？因为抛出异常后，线程的中断标志位会被 JVM 自动清除（置为 false），所以 while 循环中的 isInterrupted() 永远返回 false，线程就一直在监控。

![](https://blog.meowrain.cn/api/i/2026/02/18/yqkjep-1.png)



我们改一下
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



        System.out.println("Main: 我要打断 T1");

        t1.start();
        TimeUnit.SECONDS.sleep(5);
        t1.interrupt(); // 拍拍 T1 的肩膀

    }
}
```

这里的 Thread.currentThread().interrupt(); 是为了在捕获 InterruptedException 异常后，手动将线程的中断标志位重新设置为 true，这样 while 循环中的 isInterrupted() 就能正确地检测到中断信号，从而正常退出循环，结束线程。

这就是两阶段终止的典型实现：第一阶段通过 interrupt() 发出终止信号，第二阶段在线程内部通过检查中断标志位来决定何时真正结束线程。