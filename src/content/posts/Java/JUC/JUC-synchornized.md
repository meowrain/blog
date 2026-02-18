---
title: JUC-synchornized
published: '2026-02-18T13:28:28.031Z'
description: ''
image: ''
tags:
  - JUC
category: Java > JUC
draft: false
lang: ''
---
# JUC synchornized


在并发编程和多线程环境中，**临界区**（Critical Section）和**竞态条件**（Race Condition）是两个紧密相关且至关重要的核心概念。理解它们对于编写正确、安全的并行程序至关重要。

### 1. 临界区 (Critical Section)

**定义**：
临界区是指代码中访问**共享资源**（如全局变量、文件、数据库连接、硬件设备等）的那一段逻辑。这些资源在同一时刻只能被一个线程（或进程）安全地访问。如果多个线程同时执行这段代码，就会导致数据不一致或程序错误。

**关键特征**：
- **互斥性**：在任何给定时刻，只允许一个线程进入临界区执行。
- **共享资源**：涉及的操作对象是被多个线程共用的。
- **原子性需求**：临界区内的操作通常需要作为一个整体（原子操作）完成，中间不能被其他线程打断。

**示例**：
假设有一个全局计数器 `count`，两个线程都要对其进行加 1 操作：
```python
# 临界区开始
temp = count      # 读取
temp = temp + 1   # 计算
count = temp      # 写入
# 临界区结束
```
如果不加保护，这两行代码构成的区域就是临界区。

---

### 2. 竞态条件 (Race Condition)

**定义**：
竞态条件是指程序的最终结果依赖于多个线程执行的**相对时序**或**调度顺序**的一种错误状态。当两个或多个线程在没有适当同步的情况下，交替访问和修改同一个共享数据时，就会发生竞态条件。

**为什么会发生**？
因为现代操作系统对线程的调度是不可预测的。如果线程 A 和线程 B 同时试图修改同一个变量，而它们的“读 - 改 - 写”过程发生了交错，最终的数据就会出错。

**经典场景分析**（基于上面的计数器例子）
假设 `count` 初始值为 0，线程 A 和线程 B 都想让它变成 2。

1.  **线程 A** 读取 `count` (得到 0)。
2.  *(此时发生线程切换)*
3.  **线程 B** 读取 `count` (也得到 0，因为 A 还没写回)。
4.  **线程 B** 计算 0+1=1，并将 `count` 写回为 1。
5.  *(线程切换回 A)*
6.  **线程 A** 继续之前的逻辑，计算 0+1=1，并将 `count` 写回为 1。

**结果**：两个线程都执行了加 1，但 `count` 的最终结果是 **1** 而不是预期的 **2**。这就是典型的竞态条件。

---

### 3. 两者的关系

它们是**问题**与**解决方案对象**的关系：

*   **临界区**是代码中**潜在危险**的区域，即如果不加控制就会产生问题的地方。
*   **竞态条件**是当多个线程**不受控制地同时进入临界区**时所导致的**实际错误后果**。

简单来说：**因为没有保护好临界区，所以导致了竞态条件**。

---

### 4. 如何解决？

要消除竞态条件，必须确保同一时刻只有一个线程能进入临界区。这通常通过**同步机制**来实现：

| 机制 | 描述 | 适用场景 |
| :--- | :--- | :--- |
| **互斥锁 **(Mutex) | 最基本的锁，保证一次只有一个线程持有锁并进入临界区。 | 绝大多数需要互斥访问的场景。 |
| **信号量 **(Semaphore) | 允许指定数量的线程同时访问资源（计数信号量），或作为互斥锁使用（二元信号量）。 | 限制资源池大小（如数据库连接池）。 |
| **监视器 **(Monitor) | 高级同步构造（如 Java 的 `synchronized`，Python 的 `Lock`），将数据和操作封装在一起自动管理锁。 | 面向对象语言中的常用模式。 |
| **原子操作 **(Atomic) | 利用 CPU 指令直接保证操作的原子性，无需显式加锁，性能更高。 | 简单的计数器、标志位更新。 |

# syncronized介绍

synchronized 是 Java 提供的 内置锁（intrinsic lock）机制，用于：

🔐 保证共享变量在多线程环境下的线程安全

它主要解决两个问题：

- 互斥（原子性）

- 可见性（内存可见性）


这个代码是非线程安全的
```java
package demo;


import demo.annotations.NoThreadSafe;

public class InterruptSleepDemo {
    private static int a = 0;



    @NoThreadSafe
    public static void main(String[] args) throws InterruptedException {


        Thread t1 = new Thread(() -> {
            for (int i = 0; i < 100000; i++) {
                a++;
            }
        });


        Thread t2 = new Thread(() -> {
            for (int i = 0; i < 100000; i++) {
                a--;
            }
        });
        t1.start();
        t2.start();

        t1.join();
        t2.join();
        System.out.println(a);

    }
}
```


![](https://blog.meowrain.cn/api/i/2026/02/18/zfhbw9-1.png)

---

```java
package demo;


import demo.annotations.NoThreadSafe;
import demo.annotations.ThreadSafe;

public class InterruptSleepDemo {
    private static int a = 0;



    @ThreadSafe
    public static void main(String[] args) throws InterruptedException {


        Thread t1 = new Thread(() -> {
            synchronized (InterruptSleepDemo.class) {
                for (int i = 0; i < 100000; i++) {
                    a++;
                }
            }
        });


        Thread t2 = new Thread(() -> {
            synchronized (InterruptSleepDemo.class) {
                for (int i = 0; i < 100000; i++) {
                    a--;
                }
            }
        });
        t1.start();
        t2.start();

        t1.join();
        t2.join();
        System.out.println(a);

    }
}
```
这个我们用监控锁控制住，就能保证线程安全了。这个结果现在符合预期了！


![](https://blog.meowrain.cn/api/i/2026/02/18/zkak8a-1.png)


# synchronized加到不同地方的效果

| 写法                       | 锁对象           |
| ------------------------ | ------------- |
| `synchronized` 实例方法      | 当前对象（this）    |
| `static synchronized` 方法 | 当前类的 Class 对象 |

