---
title: ABA问题
published: 2025-07-19
description: ''
image: ''
tags: [JUC, ABA问题]
category: 'Java > JUC'
draft: false 
lang: ''
---

# 介绍

ABA问题是并发编程中，在使用无锁（lock-free）算法，特别是基于 比较并交换（Compare-And-Swap, CAS） 操作时可能出现的一种逻辑错误。

它之所以被称为"ABA"问题，是因为一个变量的值从 A 变成了 B，然后又变回了 A。对于一个只检查当前值是否等于期望值的CAS操作来说，它会认为值没有发生变化，从而成功执行操作，但实际上变量在期间已经被修改过了。

## **ABA问题发生的场景及危害**

想象一个无锁的栈（Stack），其 `pop()` 操作需要原子地更新栈顶元素。

**假设初始状态：**
栈顶 `top` 指向元素 `A`。

**正常 `pop` 操作流程：**

1. 线程1读取当前栈顶元素 `A`。
2. 线程1准备将栈顶更新为 `A.next` (假设是 `null`)。
3. 线程1执行 `top.compareAndSet(A, A.next)`，如果成功，`A` 被弹出。

**ABA问题发生过程：**

1. **线程1** 读取当前栈顶元素，发现是 `A`。它记下 `A`，并准备执行 `CAS(A, C)`。

    ```
    top -> A -> B -> D
    Thread 1 reads top: A
    ```

2. **线程2** 此时突然执行，它将 `A` 弹出。

    ```
    top -> B -> D  (A is now removed)
    Thread 2 pops A
    ```

3. **线程2** 又将一个**新的元素 `A` （或者一个值和 `A` 相同但实际上是不同对象的元素）**压入栈。
    *注意：这里的“新的元素A”指的是一个与最开始的A值相同，但内存地址可能不同，或者即便内存地址相同，其内部状态已经发生过变化的对象。*

    ```
    top -> A -> B -> D  (This A is NOT the original A, it's a new one!)
    Thread 2 pushes A back
    ```

4. **线程1** 恢复执行 `CAS(A, C)`。它检查当前栈顶是否是它之前读取的 `A`。
    由于栈顶现在又指向了 `A`（尽管是新的 `A`），`compareAndSet` 操作会认为当前值等于期望值 `A`，并成功将栈顶更新为 `C`。

    ```
    top -> C       (Thread 1's CAS(A, C) succeeds!)
    ```

**危害：**
尽管线程1的CAS操作成功了，但它操作的实际上是一个**新的 `A`**，而不是它最初读取的那个 `A`。如果 `A` 的内部状态（比如它的 `next` 指针）在这期间被改变了，那么线程1的后续操作可能会导致：

* **数据结构损坏**：例如，在链表中，节点指针可能指向错误的位置。
* **逻辑错误**：程序基于过时的或不正确的状态信息做出决策。
* **内存泄漏**：旧的 `A` （或其他被弹出又压入的元素）可能永远无法被垃圾回收。

---

```java
package org.example.aba;

import java.util.concurrent.atomic.AtomicReference;

class Node {
    public final String item; // 节点内容
    public Node next; // 下一个节点的引用

    public Node(String item) {
        this.item = item;
    }

    @Override
    public String toString() {
        return item;
    }
}

class LockFreeStackABA {
    private AtomicReference<Node> top = new AtomicReference<>();

    // 压入栈顶
    public void push(String item) {
        Node newHead = new Node(item);
        Node oldHead;
        do {
            oldHead = top.get();
            newHead.next = oldHead;
        } while (!top.compareAndSet(oldHead, newHead));
        System.out.println(Thread.currentThread().getName() + " 压入: " + item + " (当前栈顶: " + top.get() + ")");
    }

    // 弹出栈顶
    public Node pop() {
        Node oldHead;
        Node newHead;
        do {
            oldHead = top.get();
            if (oldHead == null) {
                System.out.println(Thread.currentThread().getName() + " 尝试弹出，但栈为空！");
                return null;
            }
            newHead = oldHead.next;
            System.out.println(Thread.currentThread().getName() + " 尝试弹出 " + oldHead.item +
                    " (期望栈顶: " + oldHead + ", 更新栈顶至: " + newHead + ")");
        } while (!top.compareAndSet(oldHead, newHead)); // CAS操作：如果当前栈顶仍是oldHead，则更新为newHead
        System.out.println(Thread.currentThread().getName() + " 成功弹出: " + oldHead.item + " (当前栈顶: " + top.get() + ")");
        return oldHead;
    }

    // 打印栈内容
    public void printStack() {
        System.out.print("当前栈: ");
        Node current = top.get();
        if (current == null) {
            System.out.println("空");
            return;
        }
        StringBuilder sb = new StringBuilder();
        while (current != null) {
            sb.append(current.item).append(" -> ");
            current = current.next;
        }
        sb.setLength(sb.length() - 4); // 移除最后的 " -> "
        System.out.println(sb.toString());
    }

    // 获取栈顶节点
    public Node getTop() {
        return top.get();
    }
}

public class AbaAppear {
    public static void main(String[] args) throws InterruptedException {
        LockFreeStackABA stack = new LockFreeStackABA();

        // 1. 初始状态：栈中逐步压入 A、B、C
        stack.push("C"); // 栈顶：C
        stack.push("B"); // 栈顶：B → C
        stack.push("A"); // 栈顶：A → B → C

        Node originalNodeA = stack.getTop(); // 获取当前栈顶的 A 节点引用

        System.out.println("\n--- 初始栈内容 ---");
        stack.printStack();

        // 2. 线程1 启动，读取栈顶元素后等待
        Thread thread1 = new Thread(() -> {
            Node readNode = stack.getTop(); // 线程1在原栈中看到栈顶元素 A
            System.out.println("\n线程-1 读取到栈顶节点: " + readNode);
            try {
                Thread.sleep(200); // 等待线程2的干扰行为发生
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
            System.out.println("\n线程-1 开始尝试弹出栈顶节点...");
            Node popNode = stack.pop(); // 线程1尝试弹出栈顶（被线程2修改为新 A）
            if (readNode == popNode) {
                System.out.println("同一个节点");
            }else {
                System.out.println("不是同一个节点，ABA问题已重现！");
            }
        }, "线程-1");

        // 3. 线程2 启动，执行 ABA 序列
        Thread thread2 = new Thread(() -> {
            System.out.println("\n--- 线程-2 执行 ABA 序列 ---");
            stack.pop(); // 弹出 A，栈顶变为 B
            stack.pop(); // 弹出 B，栈顶变为 C
            stack.push("X"); // 压入一个新节点 X，栈顶变为 X → C
            stack.push("A"); // 再压入一个新的 A，栈顶变为 A → X → C
            System.out.println("--- 线程-2 完成 ABA 序列 ---");
            stack.printStack();
        }, "线程-2");

        thread1.start(); // 启动线程1
        thread2.start(); // 启动线程2

        thread1.join(); // 等待线程1完成
        thread2.join(); // 等待线程2完成

        System.out.println("\n--- 最终栈内容 ---");
        stack.printStack();
        System.out.println("当前栈顶节点: " + stack.getTop());
        if (stack.getTop() != null) {
            System.out.println("栈顶节点的 next: " + stack.getTop().next);
        }
    }
}

```

![](https://blog.meowrain.cn/api/i/2025/05/28/117anny-0.webp)

![](https://blog.meowrain.cn/api/i/2025/05/28/11banhc-0.webp)

![](https://blog.meowrain.cn/api/i/2025/05/28/11betve-0.webp)

# 如何解决ABA问题

解决ABA问题的主要方法是引入一个 版本号（或时间戳） 机制。每次修改变量时，不仅修改值，也同时修改版本号。CAS操作时，需要同时比较值和版本号。

![](https://blog.meowrain.cn/api/i/2025/05/28/10lo3io-0.webp)

使用AtomicStampedReference解决问题

```java
package org.example.aba;

import lombok.extern.slf4j.Slf4j;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicStampedReference;

@Slf4j
public class AbaSolve {
    static AtomicStampedReference<String> ref = new AtomicStampedReference<>("A", 0);

    public static void main(String[] args) {
        log.debug("main start ....");
        String prev = ref.getReference();
        int stamp = ref.getStamp();
        log.debug("stamp: {}", stamp);

        other();
        try {
            TimeUnit.SECONDS.sleep(1);
        } catch (InterruptedException e) {
            throw new RuntimeException(e);
        }
        log.debug("change A -> C {} ", ref.compareAndSet(prev, "C", stamp, stamp + 1));
    }

    private static void other() {
        new Thread(() -> {
            int stamp = ref.getStamp();
            log.debug("{} 's stamp is : {}",Thread.currentThread().getName(),stamp);
            log.debug("change A-> B {} ", ref.compareAndSet(ref.getReference(), "B", stamp, stamp + 1));
            stamp = ref.getStamp();
            log.debug("{} 's changed stamp is : {}",Thread.currentThread().getName(),stamp);
        }, "t1").start();
        try {
            TimeUnit.MILLISECONDS.sleep(500);
        } catch (InterruptedException e) {
            throw new RuntimeException(e);
        }
        new Thread(()->{
            int stamp = ref.getStamp();
            log.debug("{} 's stamp is : {}",Thread.currentThread().getName(),stamp);
            log.debug("change B->A {}",ref.compareAndSet(ref.getReference(),"A",stamp,stamp + 1));
            stamp = ref.getStamp();
            log.debug("{} 's changed stamp is : {}",Thread.currentThread().getName(),stamp);
        },"t2").start();
    }
}

```

![](https://blog.meowrain.cn/api/i/2025/05/31/t2rzcb-0.webp)
