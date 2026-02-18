---
title: JUC-创建线程
published: 2026-02-18T17:44:02
description: ''
image: ''
tags: [JUC,Java]
category: 'Java > JUC'
draft: false 
lang: ''
---


# JUC 笔记-创建线程



## 继承Thread类

```java
package demo;

public class Demo1 {

    public static void main(String[] args) {
        Demo1Thread demo1Thread = new Demo1Thread();
        demo1Thread.start();

    }
}
class Demo1Thread extends Thread {
    @Override
    public void run() {
        System.out.println(Thread.currentThread().getName());
    }
}

```



![](https://blog.meowrain.cn/api/i/2026/02/18/sms8im-1.png)

> 不过这样还是有缺陷的，因为java是单继承，所以一个类一旦继承了Thread类，就没办法继承其它类了



## 实现Runnable接口

```java
package demo;

public class Demo1 {

    public static void main(String[] args) {
        new Thread(new Demo1Thread()).start();

    }
}
class Demo1Thread implements Runnable {
    @Override
    public void run() {
        System.out.println(Thread.currentThread().getName());
    }
}

```

![](https://blog.meowrain.cn/api/i/2026/02/18/somi9e-1.png)





![](https://blog.meowrain.cn/api/i/2026/02/18/spob7o-1.png)

![](https://blog.meowrain.cn/api/i/2026/02/18/spua8q-1.png)





## Callable接口

前面的线程运行不会返回数据，Callable接口就是为了能接收会返回数据的线程的结果的。





```java
package demo;

import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;

public class Demo1 {

    public static void main(String[] args) {
        Callable callable = new Demo1Thread(3,10);
        FutureTask<Integer> futureTask = new FutureTask(callable);
        Thread t = new Thread(futureTask);
        t.start();
        try {
            Integer i = futureTask.get();

            System.out.println("result: " + i);
        } catch (InterruptedException e) {
            throw new RuntimeException(e);
        } catch (ExecutionException e) {
            throw new RuntimeException(e);
        }


    }
}
class Demo1Thread implements Callable<Integer> {
    private int a;
    private int b;
    public Demo1Thread(int a,int b) {
        this.a = a;
        this.b = b;
    }

    public int getA() {
        return a;
    }

    public int getB() {
        return b;
    }

    public void setA(int a) {
        this.a = a;
    }

    public void setB(int b) {
        this.b = b;
    }

    @Override
    public Integer call() throws Exception {
        Thread.sleep(1000);
        return a + b;
    }

}

```

![](https://blog.meowrain.cn/api/i/2026/02/18/stf4hy-1.png)







