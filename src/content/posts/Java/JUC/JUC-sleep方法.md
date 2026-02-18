---
title: JUC-Thread.sleep
published: 2026-02-18T18:28:23
description: ''
image: ''
tags: [JUC,Java]
category: 'Java > JUC'
draft: false 
lang: ''
---


# 深入理解 Java 并发：Thread.sleep() 与线程状态流转

在 Java 并发编程中，控制线程的执行节奏是基础且重要的技能。

## 1. 什么是 Thread.sleep()？

`Thread.sleep(long millis)` 是 `Thread` 类的静态方法。它的主要作用是：

* **暂停执行**：让**当前正在执行的线程**暂停一段指定的时间。
* **不释放锁**：这是它最关键的特性。如果当前线程持有了某个对象的锁，在睡觉（sleep）的过程中，它**不会**释放这个锁，其他线程依然无法访问该锁保护的资源。
* **状态变化**：它会让线程从 `RUNNABLE` 状态变为 `TIMED_WAITING`（计时等待）状态。

## 2. 实战演示：代码重构

```java
package demo;

import java.util.concurrent.TimeUnit;

public class SleepStateDemo {

    public static void main(String[] args) {
        // 1. 创建线程
        Thread thread = new Thread(() -> {
            try {
                // 模拟耗时操作或等待，睡眠 3 秒
                TimeUnit.SECONDS.sleep(3); 
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        }, "customThread");

        // 此时线程对象已创建，但尚未启动
        System.out.println(thread.getName() + " state: " + thread.getState()); // 预期：NEW

        // 2. 启动线程
        thread.start();
        // 启动后，线程通常处于 RUNNABLE 状态（取决于操作系统调度）
        System.out.println(thread.getName() + " state: " + thread.getState()); // 预期：RUNNABLE

        // 3. 主线程暂停，观察子线程状态
        try {
            // 主线程睡眠 100 毫秒，确保子线程有足够的时间开始执行并进入 sleep 状态
            TimeUnit.MILLISECONDS.sleep(100);
        } catch (InterruptedException e) {
            e.printStackTrace();
        }

        // 子线程正在执行 sleep(3)，此时应处于计时等待状态
        System.out.println(thread.getName() + " state: " + thread.getState()); // 预期：TIMED_WAITING
    }
}

```

### 运行结果解析

执行上述代码，控制台将输出如下内容（这解释了你截图中看到的现象）：

```text
customThread state: NEW
customThread state: RUNNABLE
customThread state: TIMED_WAITING

```

**状态流转图解：**

1. **NEW**: `new Thread(...)` 被调用后，线程对象被创建，但还没调用 `start()`，此时就像一个还没通电的灯泡。
2. **RUNNABLE**: 调用 `start()` 后，线程进入可运行池。注意，Java 中的 `RUNNABLE` 涵盖了操作系统层面的 "Running"（正在跑）和 "Ready"（等待CPU调度）。
3. **TIMED_WAITING**: 当子线程执行到 `TimeUnit.SECONDS.sleep(3)` 时，它会主动交出 CPU 使用权，进入计时等待状态。主线程在等待了 100ms 后去查看它，正好抓到了它在 "睡觉" 的瞬间。

## 3. 关键知识点总结

在面试或实际开发中，关于 `sleep()` 有几个核心细节需要注意：

### 3.1 sleep() vs wait() (高频面试题)

这是最容易混淆的一点。虽然它们都能让线程暂停，但本质完全不同：

| 特性 | Thread.sleep() | Object.wait() |
| --- | --- | --- |
| **所属类** | **Thread** 类 (静态方法) | **Object** 类 (实例方法) |
| **锁的释放** | **不释放锁** (抱着锁睡觉) | **释放锁** (让出资源给别人) |
| **使用场景** | 仅仅是让线程暂停执行 | 用于线程间的通信 (配合 notify) |
| **唤醒方式** | 时间到了自动醒，或被 interrupt | 需要 notify/notifyAll 或时间到 |

### 3.2 InterruptedException

`sleep` 方法强制要求捕获 `InterruptedException`。这意味着当一个线程正在睡眠时，其他线程可以使用 `thread.interrupt()` 方法来 "叫醒" 它。被中断时，sleep 会抛出异常并清除中断标志位。

```java
package demo;

import java.util.concurrent.TimeUnit;

public class Demo1 {

    public static void main(String[] args) {
        Thread thread = new Thread(() -> {
            try {

                Thread.sleep(3000);
            } catch (InterruptedException e) {
                throw new RuntimeException(e);
            }


        },"customeThread");
        System.out.println(thread.getName()+ " state: " + thread.getState());
        thread.start();
        System.out.println(thread.getName()+ " state: " + thread.getState());


        try {
            Thread.sleep(100);
            // 打断会抛出异常
            thread.interrupt();
        } catch (InterruptedException e) {
            throw new RuntimeException(e);
        }
        System.out.println(thread.getName() + " state: " + thread.getState());



    }



}

```

![](https://blog.meowrain.cn/api/i/2026/02/18/u9sm5j-1.png)

### 3.3 推荐使用 TimeUnit

在 JDK 1.5 之后，强烈建议使用 `TimeUnit` 来替代直接调用 `Thread.sleep`。

* **Bad:** `Thread.sleep(180000)` (这是多久？3分钟？还是30秒？)
* **Good:** `TimeUnit.MINUTES.sleep(3)` (清晰明了)
