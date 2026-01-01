---
title: volatile-实现单例模式的双重锁
published: 2025-08-07
description: ''
image: ''
tags: [JUC,JAVA,volatile,双重锁]
category: 'Java > JUC'
draft: false 
lang: ''
---

# 什么是单例模式的双重锁
单例模式的双重锁是一种实现单例模式的技术，通过两次检查实例是否为null，结合同步锁来保证在多线程环境下只创建一个实例，并试图通过减少同步的次数来提高性能。为了确保线程安全，尤其在涉及到对象创建的指令重排的问题的时候，通常需要使用 `volatile`关键字来修饰单例类的实例变量。

# 非线程安全的单例模式
```java
public class Singleton {
    private static Singleton instance;
    private Singleton() {
        
    }
    public static Singleton getInstance() {
        if (instance == null) {
            instance = new Singleton();
        }
        return instance;
    }
}

```

> 多线程环境下，上面的简单实现在并发调用 `getInstance()`方法时候可能出现问题。

![](https://blog.meowrain.cn/api/i/2025/04/24/rajbl4-0.webp)

常见的做法是使用synchronized
```java
public class Singleton {
    private static Singleton instance;
    private Singleton() {

    }
    public static synchronized Singleton getInstance() {
        if (instance == null) {
            instance = new Singleton();
        }
        return instance;
    }
}

```

这种同步方式能确保线程安全，因为在同一时间，只有一个线程能够进入getInstance方法，但是每次调用`getInstance`方法都需要获取锁，即使在实例已经创建之后也是如此，这样会带来额外的性能开销，尤其是在频繁调用`getInstance()`的情况下
# 什么是单例模式的双重检查锁定 -> 可能会导致半初始化问题
双重检查锁定就是为了保证在线程安全的前提下，尽量减少同步带来的性能开销

核心思想：
1. 第一次检查： 在进入同步块之前，先检查insatnce是否为null，如果不是null，说明实例已经创建，可以直接返回，避免进入同步块。
2. 同步块： 如果第一次检查发现instance是null，就进入同步块
3. 第二次检查： 在同步块内，再次检查instance是否为null，这是至关重要的一部，因为可能多个线程都通过了第一次检查，但只有一个线程进入同步块，在同步块内再次检查可以确保只有一个线程会智行对象的创建操作。
4. 创建实例：如果第二次检查发现instance仍然为null，才真正创建对象并把引用赋值给instance


 ```java
 public class Singleton {
    private static Singleton instance;
    private Singleton() {

    }
    public static Singleton getInstance() {
        if (instance == null) {
            synchronized (Singleton.class) {
                if (instance == null) {
                    instance = new Singleton();
                }
            }
        }
        return instance;
    }
}

```


> 尽管双重检查锁看起来聪明地减少了同步磁化，但是在JMM(JAVA 内存模型）种，没有使用`volatile`的双重检查锁仍然存在`指令重排`的问题。

对象创建的过程 `instance = new SimpleSingleton();` 实际上能分解为三个步骤：
1. 为对象分配内存空间
2. 初始化对象
3. 将分配的内存空间的地址赋值给`instance`变量

在某些情况下，JVM为了优化性能，可能会对这三个步骤进行重排序，例如，可能会将步骤三排在步骤2之前


![](https://blog.meowrain.cn/api/i/2025/04/24/s9qvuj-0.webp)

# 为什么用volatile？
1. 可见性： volatile确保了所有线程都能看到instance变量的最新值，当一个线程修改了instance值，这个改变会立即对其他线程可见。
2. 禁止指令重排：解决了半初始化的问题，确保instance变量被赋值为非null之前，对象已经被完全初始化。

```java
public class Singleton {
    private static volatile Singleton instance;
    private Singleton() {

    }
    public static Singleton getInstance() {
        if (instance == null) {
            synchronized (Singleton.class) {
                if (instance == null) {
                    instance = new Singleton();
                }
            }
        }
        return instance;
    }
}

```
