---
title: JUC-synchronized
published: 2026-02-18T13:28:28
description: '从临界区与竞态条件出发，系统理解 Java synchronized 的原理、用法与常见场景。'
image: ''
tags:
  - JUC
category: Java > JUC
draft: false
lang: ''
---
# JUC：深入理解 synchronized

在并发编程中，`synchronized` 是最基础、也最常用的线程同步手段之一。本文先讲清楚「为什么需要锁」，再通过三个案例理解它的正确用法。

## 1. 临界区与竞态条件

### 临界区（Critical Section）

临界区是指访问共享资源（如共享变量、文件、连接等）的代码片段。这个区域在同一时刻通常只能有一个线程执行。

示例（读-改-写）：

```text
temp = count      // 读取
temp = temp + 1   // 计算
count = temp      // 写回
```

### 竞态条件（Race Condition）

当多个线程在没有同步保护的情况下交错执行临界区，程序结果就会依赖线程调度顺序，从而出现错误，这就是竞态条件。

一句话总结：**临界区是风险区域，竞态条件是风险变成现实后的错误结果。**

---

## 2. synchronized 能解决什么

`synchronized` 是 Java 的内置监视器锁（Intrinsic Lock），主要保证：

1. **互斥（原子性）**：同一时刻只有一个线程进入受保护代码。
2. **可见性**：释放锁前对共享变量的修改，对后续获得同一把锁的线程可见。

> 注意：`synchronized` 不直接提供「公平性」保证。

---

## 3. 第一组案例：共享变量自增/自减

### 非线程安全版本

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

### 线程安全版本

```java
package demo;

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

![](https://blog.meowrain.cn/api/i/2026/02/18/zkak8a-1.png)

通过让两个线程竞争同一把锁（`InterruptSleepDemo.class`），可以保证对 `a` 的复合操作不被打断。

---

## 4. synchronized 加在不同位置，锁的对象不同

| 写法 | 锁对象 |
| :--- | :--- |
| `synchronized` 实例方法 | 当前实例（`this`） |
| `static synchronized` 方法 | 当前类的 `Class` 对象 |
| `synchronized (obj) {}` | 指定对象 `obj` |

---

## 5. 第二组案例：卖票超卖问题

### 非线程安全版本（会超卖）

```java
package demo;

import demo.annotations.NoThreadSafe;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;

public class TicketTest {
    public static void main(String[] args) throws InterruptedException {
        TicketWindow ticketWindow = new TicketWindow(10000);

        List<Integer> list = Collections.synchronizedList(new ArrayList<>());
        List<Thread> threads = new ArrayList<>();

        for (int i = 0; i < 10000; i++) {
            Random random = new Random();
            Thread thread = new Thread(() -> {
                int want = random.nextInt(10);
                int sold = ticketWindow.sell(want);
                list.add(sold);
            });
            threads.add(thread);
            thread.start();
        }

        for (Thread t : threads) {
            t.join();
        }

        int soldTotal = list.stream().mapToInt(Integer::intValue).sum();
        System.out.println("最终剩余: " + ticketWindow.getCount());
        System.out.println("卖出统计: " + soldTotal);
        System.out.println("校验（剩余+卖出）: " + (ticketWindow.getCount() + soldTotal));
    }
}

class TicketWindow {
    private int count;

    public TicketWindow(int count) {
        this.count = count;
    }

    @NoThreadSafe
    public int getCount() {
        return count;
    }

    @NoThreadSafe
    public int sell(int amount) {
        if (count >= amount) {
            count -= amount;
            System.out.println("卖出" + amount + " ==== 剩余: " + count);
            return amount;
        }
        System.out.println("卖出0 ==== 剩余: " + count);
        return 0;
    }
}
```

![](https://blog.meowrain.cn/api/i/2026/02/18/12gce7n-1.png)

问题根因：`sell()` 中的 `if (count >= amount) + count -= amount` 不是原子操作，多个线程会交错执行。

### 线程安全版本

```java
package demo;

import demo.annotations.ThreadSafe;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;

public class TicketTest {
    public static void main(String[] args) throws InterruptedException {
        TicketWindow ticketWindow = new TicketWindow(10000);

        List<Integer> list = Collections.synchronizedList(new ArrayList<>());
        List<Thread> threads = new ArrayList<>();

        for (int i = 0; i < 10000; i++) {
            Random random = new Random();
            Thread thread = new Thread(() -> {
                int want = random.nextInt(10);
                int sold = ticketWindow.sell(want);
                list.add(sold);
            });
            threads.add(thread);
            thread.start();
        }

        for (Thread t : threads) {
            t.join();
        }

        int soldTotal = list.stream().mapToInt(Integer::intValue).sum();
        System.out.println("最终剩余: " + ticketWindow.getCount());
        System.out.println("卖出统计: " + soldTotal);
        System.out.println("校验（剩余+卖出）: " + (ticketWindow.getCount() + soldTotal));
    }
}

class TicketWindow {
    private int count;

    public TicketWindow(int count) {
        this.count = count;
    }

    @ThreadSafe
    public synchronized int getCount() {
        return count;
    }

    @ThreadSafe
    public synchronized int sell(int amount) {
        if (count >= amount) {
            count -= amount;
            System.out.println("卖出" + amount + " ==== 剩余: " + count);
            return amount;
        }
        System.out.println("卖出0 ==== 剩余: " + count);
        return 0;
    }
}
```

![](https://blog.meowrain.cn/api/i/2026/02/18/12h6fx9-1.png)

---

## 6. 第三组案例：转账（涉及两个对象）

当一个操作同时涉及两个账户对象时，只锁 `this` 往往不够。

### 非线程安全版本

```java
package demo;

import java.util.ArrayList;
import java.util.List;

public class TransferTest {
    public static void main(String[] args) {
        Account a = new Account(10000);
        Account b = new Account(10000);
        List<Thread> threads = new ArrayList<>();

        for (int i = 0; i < 1000; i++) {
            Thread thread = new Thread(() -> {
                a.transfer(b, 1000);
                b.transfer(a, 1000);
            });
            thread.start();
            threads.add(thread);
        }

        for (Thread thread : threads) {
            try {
                thread.join();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }

        System.out.println("a.getAmount() = " + a.getAmount());
        System.out.println("b.getAmount() = " + b.getAmount());
        System.out.println(a.getAmount() + b.getAmount());
    }
}

class Account {
    private long amount;

    public Account(long amount) {
        this.amount = amount;
    }

    public long getAmount() {
        return amount;
    }

    public void setAmount(long amount) {
        this.amount = amount;
    }

    public void transfer(Account target, long money) {
        if (this.amount >= money) {
            this.setAmount(this.getAmount() - money);
            target.setAmount(target.getAmount() + money);
        }
    }
}
```

![](https://blog.meowrain.cn/api/i/2026/02/18/12qzc87-1.png)

### 改进版本（按固定顺序锁两个账户，避免死锁）

> 你原来使用 `synchronized (Account.class)` 也能保证正确性，但并发度会很低（所有账户互相串行）。

```java
package demo;

import demo.annotations.ThreadSafe;

class Account {
    private long amount;

    public Account(long amount) {
        this.amount = amount;
    }

    public long getAmount() {
        return amount;
    }

    @ThreadSafe
    public void transfer(Account target, long money) {
        if (target == null || target == this || money <= 0) {
            return;
        }

        Account first = this;
        Account second = target;

        if (System.identityHashCode(first) > System.identityHashCode(second)) {
            first = target;
            second = this;
        }

        synchronized (first) {
            synchronized (second) {
                if (this.amount >= money) {
                    this.amount -= money;
                    target.amount += money;
                }
            }
        }
    }
}
```

这种做法的优点：

- 正确性：同时保护两个账户余额。
- 安全性：固定加锁顺序，降低死锁风险。
- 并发性：不同账户对之间仍可并行执行，不会像类锁那样全局串行。

---

## 7. 小结

- `synchronized` 的核心是：**同一把锁保护同一份共享状态**。
- 只要是「读-改-写」复合操作，就要警惕竞态条件。
- 涉及多个共享对象时，必须设计好锁粒度和加锁顺序。

如果你正在系统学习 JUC，下一步建议对比：`synchronized`、`ReentrantLock` 与 `Atomic*` 的适用边界与性能差异。
