---
title: HashMap原理
published: 2025-07-18
description: ''
image: ''
tags: [HashMap,Java]
category: 'Java > 集合框架'
series: Java 集合
draft: false 
lang: ''
---


# 说说HashMap的原理

HashMap是基于哈希表的数据结构，用于存储键值对。
核心是将键的哈希值映射到数组索引位置，通过数组+链表+红黑树来解决哈希冲突。

HashMap使用键的hashCode()方法计算哈希值，通过`(n-1) &hash`确定元素在数组中的存储位置。

哈希值是经过一定的扰动处理的，防止哈希值分布不均，从而减少冲突，

HashMap的默认初始容量为16，负载因子为0.75，也就是说，当存储的元素数量超过16 * 0.75 = 12个的时候，HashMap会触发扩容操作，容量x2并重新分配元素位置，这种扩容是比较耗时的操作，频繁扩容会影响性能。

# 通过源码深入了解HashMap

```java
    // 默认初始容量 - 必须是 2 的幂次方。
    static final int DEFAULT_INITIAL_CAPACITY = 1 << 4; // 即 16

    // 最大容量，如果构造函数中通过参数隐式指定了更高的值，则使用此最大容量。
    // 必须是小于等于 1 << 30 的 2 的幂次方。
    // 由于你可以随时指定非常大（甚至超过了1亿）的值，为了防止内存溢出或数组长度无效，HashMap内部通过MAXIMUM_CAPACITY做了一个“保险”，来确保容量不会超过某个安全极限。
    static final int MAXIMUM_CAPACITY = 1 << 30;

    // 构造函数中未指定时使用的负载因子。
    static final float DEFAULT_LOAD_FACTOR = 0.75f;

    // 在向存储单元添加元素时，存储单元使用树结构而不是链表结构的存储单元计数阈值。
    // 当向存储单元添加元素，且该存储单元至少有此数量的节点时，存储单元将转换为树结构。
    // 该值必须大于 2，并且应该至少为 8，以与移除元素时转换回普通存储单元的假设相匹配。
    static final int TREEIFY_THRESHOLD = 8;

    // 在调整大小操作期间将（拆分的）存储单元转换为非树结构存储单元的存储单元计数阈值。
    // 应该小于 TREEIFY_THRESHOLD，并且最多为 6，以与移除元素时的收缩检测相匹配。
    static final int UNTREEIFY_THRESHOLD = 6;

    // 存储单元可以树化的最小表容量。
    // （否则，如果存储单元中有太多节点，表将进行扩容。）
    // 应该至少是 4 * TREEIFY_THRESHOLD，以避免扩容和树化阈值之间的冲突。
    static final int MIN_TREEIFY_CAPACITY = 64;

```

![](https://blog.meowrain.cn/api/i/2025/06/13/nm8tvy-0.webp)

# HashMap的存储结构

从源码上看，HashMap的每个存储单元都是一个链表或者红黑树，也就是下面的Node类，那么我们可以用下面的图来展示一个完成初始化的HashMap的存储结构。

![](https://blog.meowrain.cn/api/i/2025/06/13/nnlf4v-0.webp)

### 为什么采用数组？

因为数组的随机访问速度非常快，HashMap通过哈希函数将键映射到数组索引位置，从而实现快速查找。

数组的每一个元素称为一个桶（bucket），对于一个给定的键值对key,value，HashMap会计算出一个哈希值（计算的是key的hash），然后通过`(n-1) & hash`来确定该键值对在数组中的位置。

### 如何定位key value该存储在桶数组的哪个位置上？（获取index）

HashMap通过`(n - 1) & hash`来计算索引位置，其中n是数组的长度，hash是键的哈希值。

### 如何计算hash值？

HashMap使用键的`hashCode()`方法计算哈希值，然后对哈希值进行扰动处理，最后通过`(n-1) & hash`来确定元素在数组中的存储位置。

### 为什么要扰动处理？

扰动处理是为了减少哈希冲突，防止哈希值分布不均。HashMap会对哈希值进行扰动处理，以确保不同的键能够更均匀地分布在数组中，从而减少冲突。

在Java 8中，HashMap使用了一个扰动函数来优化hash值的分布：

```java
static final int hash(Object key) {
    int h;
    return (key == null) ? 0 : (h = key.hashCode()) ^ (h >>> 16);
}
```

这个函数的作用是：

1. 首先获取key的hashCode()值
2. 将hashCode的高16位与低16位进行异或运算

### 为什么用的是&运算而不是取模运算？

在java中，我们会让HashMap的容量是2的幂次方，这样可以通过`(n-1) & hash`来快速计算出索引位置，避免了取模运算的性能开销。

这里`(n - 1) & hash` == `hash % n`，但&运算比取模运算更高效。

n是数组的长度，hash是键的哈希值。

### 为什么要让HashMap的容量是2的幂次方？

因为当容量是2的幂次方时，`(n-1) & hash`可以快速计算出索引位置，而不需要进行取模运算。

![](https://blog.meowrain.cn/api/i/2025/06/13/nqocqh-0.webp)

### 为什么会用到链表？

我们在HashMap的使用过程中，可能会遇到哈希冲突的情况，也就是不同的键经过哈希函数计算后得到了相同的索引位置，使用链表我们可以把这些冲突的键值对存储在同一个桶中，用链表连接在一起，jdk8开始，链表节点不再使用头插法，而是使用尾插法，这样可以减少链表的长度，提升查找效率。

头插法还可能造成链表形成环形，导致死循环。

![](https://blog.meowrain.cn/api/i/2025/06/13/nva4ft-0.webp)

## Node

```java
 static class Node<K,V> implements Map.Entry<K,V> {
        final int hash;
        final K key;
        V value;
        Node<K,V> next;

        Node(int hash, K key, V value, Node<K,V> next) {
            this.hash = hash;
            this.key = key;
            this.value = value;
            this.next = next;
        }

        public final K getKey()        { return key; }
        public final V getValue()      { return value; }
        public final String toString() { return key + "=" + value; }

        public final int hashCode() {
            return Objects.hashCode(key) ^ Objects.hashCode(value);
        }

        public final V setValue(V newValue) {
            V oldValue = value;
            value = newValue;
            return oldValue;
        }

        public final boolean equals(Object o) {
            if (o == this)
                return true;

            return o instanceof Map.Entry<?, ?> e
                    && Objects.equals(key, e.getKey())
                    && Objects.equals(value, e.getValue());
        }
    }

```

# HashMap的Put方法

HashMap的put方法是用来添加键值对到HashMap中的核心方法。它的实现逻辑如下：

```java
  /**
   * 实现 Map.put 和相关方法。
   *
   * @param hash key的哈希值
   * @param key 键
   * @param value 要放入的值
   * @param onlyIfAbsent 如果为 true，则不更改现有值
   * @param evict 如果为 false，则表处于创建模式。
   * @return 返回先前的值，如果没有则返回 null
   */
  final V putVal(int hash, K key, V value, boolean onlyIfAbsent,
           boolean evict) { // 📌 定义 putVal 方法，用于将键值对放入 HashMap
    Node<K,V>[] tab; Node<K,V> p; int n, i; // 🏷️ 声明局部变量：tab (哈希表数组), p (当前节点), n (数组长度), i (数组索引)
    // 检查哈希表是否为空或长度为0
    if ((tab = table) == null || (n = tab.length) == 0)
      // 🏗️ 如果为空，则调用 resize() 方法初始化或扩容哈希表，并获取新的长度
      n = (tab = resize()).length;
    // 🎯 计算键在哈希表中的索引位置 i，并检查该位置是否为空
    if ((p = tab[i = (n - 1) & hash]) == null)
      // ✨ 如果为空，直接在该位置创建一个新节点
      tab[i] = newNode(hash, key, value, null);
    else { // 🤔 如果该位置不为空（发生哈希冲突）
      Node<K,V> e; K k; // 🏷️ 声明局部变量：e (用于找到的已存在节点或新节点), k (临时键)
      // 🔑 检查桶中第一个节点的哈希值和键是否与要插入的键值对匹配
      if (p.hash == hash &&
        ((k = p.key) == key || (key != null && key.equals(k))))
        // ✅ 如果匹配，将 e 指向该节点 p (表示键已存在)
        e = p;
      // 🌳 检查桶中的节点是否为 TreeNode (红黑树节点)
      else if (p instanceof TreeNode)
        // 🌲 如果是红黑树，调用 putTreeVal 方法将键值对插入红黑树
        e = ((TreeNode<K,V>)p).putTreeVal(this, tab, hash, key, value);
      else { // 🔗 如果是链表
        // 🔄 遍历链表
        for (int binCount = 0; ; ++binCount) {
          //  نهاية 检查当前节点的下一个节点是否为空 (到达链表尾部)
          if ((e = p.next) == null) {
            // ➕ 在链表尾部插入新节点
            p.next = newNode(hash, key, value, null);
            // 🌲❓ 检查链表长度是否达到树化阈值 (TREEIFY_THRESHOLD - 1 因为 binCount 从0开始计数，且当前p是尾部的前一个节点)
            if (binCount >= TREEIFY_THRESHOLD - 1) // -1 for 1st
              // 🌳🔗➡️🌳 如果达到阈值，将链表转换为红黑树
              treeifyBin(tab, hash);
            break; // 🛑 跳出循环，因为新节点已插入
          }
          // 🔑 检查链表中节点的哈希值和键是否与要插入的键值对匹配
          if (e.hash == hash &&
            ((k = e.key) == key || (key != null && key.equals(k))))
            break; // ✅ 如果匹配，跳出循环 (表示键已存在，e 指向该节点)
          // 👉 将 p 指向下一个节点，继续遍历
          p = e;
        }
      }
      // 🔑❓ 检查 e 是否不为 null (表示键已存在于哈希表中，或者在红黑树中找到了/插入了节点)
      if (e != null) { // existing mapping for key
        // 💾 获取旧值
        V oldValue = e.value;
        // 🔄❓ 根据 onlyIfAbsent 参数决定是否更新值 (如果 onlyIfAbsent 为 false，或者旧值为 null，则更新)
        if (!onlyIfAbsent || oldValue == null)
          // ⬆️ 更新节点的值
          e.value = value;
        // 🔗 回调方法，用于 LinkedHashMap 等子类记录节点访问
        afterNodeAccess(e);
        // ↩️ 返回旧值
        return oldValue;
      }
    }
    // 🛠️ 修改计数器加1，用于迭代器快速失败机制
    ++modCount;
    // 📈 检查当前元素数量是否超过阈值 (threshold = capacity * loadFactor)
    if (++size > threshold)
      // 🏗️ 如果超过阈值，调用 resize() 方法扩容哈希表
      resize();
    // 🔗 回调方法，用于 LinkedHashMap 等子类记录节点插入
    afterNodeInsertion(evict);
    // ↩️ 如果是新插入的键值对，返回 null
    return null;
  }
```

![](https://blog.meowrain.cn/api/i/2025/06/13/nzkmzk-0.webp)

# HashMap的Get方法

```java
  /**
   * 实现 Map.get 和相关方法。
   *
   * @param key 要查找的键
   * @return 返回找到的节点，如果没有找到则返回 null
   */
  final Node<K,V> getNode(Object key) { // 📌 定义 getNode 方法，用于根据键查找节点
    Node<K,V>[] tab; Node<K,V> first, e; int n, hash; K k; // 🏷️ 声明局部变量：tab (哈希表数组), first (桶中第一个节点), e (当前节点), n (数组长度), hash (键的哈希值), k (临时键)
    // 🔍 检查哈希表是否不为空且长度大于0，并且根据键的哈希值计算出的桶位置有节点
    if ((tab = table) != null && (n = tab.length) > 0 &&
      (first = tab[(n - 1) & (hash = hash(key))]) != null) {
      // 🎯 首先检查桶中第一个节点的哈希值和键是否与要查找的键匹配
      if (first.hash == hash && // always check first node 总是先检查第一个节点
        ((k = first.key) == key || (key != null && key.equals(k))))
        // ✅ 如果匹配，直接返回第一个节点
        return first;
      // 🔗 检查第一个节点是否有下一个节点（链表或红黑树）
      if ((e = first.next) != null) {
        // 🌳 如果第一个节点是 TreeNode（红黑树节点）
        if (first instanceof TreeNode)
          // 🌲 在红黑树中查找并返回节点
          return ((TreeNode<K,V>)first).getTreeNode(hash, key);
        // 🔄 如果是链表，遍历链表查找节点
        do {
          // 🔑 检查当前节点的哈希值和键是否与要查找的键匹配
          if (e.hash == hash &&
            ((k = e.key) == key || (key != null && key.equals(k))))
            // ✅ 如果匹配，返回当前节点
            return e;
        // 👉 移动到下一个节点，继续遍历直到链表末尾
        } while ((e = e.next) != null);
      }
    }
    // ❌ 如果没有找到匹配的节点，返回 null
    return null;
  }
```

![](https://blog.meowrain.cn/api/i/2025/06/13/o2aa3y-0.webp)

# HashMap的扩容

HashMap的扩容是指当存储的元素数量超过负载因子所允许的最大数量时，HashMap会自动增加其容量。
扩容的过程包括以下几个步骤：

1. **计算新的容量**：新的容量通常是当前容量的两倍。
2. **创建新的数组**：创建一个新的数组来存储扩容后的元素。
3. **重新计算索引位置**：对于每个元素，重新计算其在新数组中的索引位置，并将其移动到新数组中。

源码中是resize()函数

```java
/**
 * 初始化或将表大小扩大一倍。如果为null，则根据字段threshold中保存的初始容量目标进行分配。
 * 否则，因为我们使用的是2的幂次方扩展，每个桶中的元素必须保持在相同的索引位置，
 * 或者在新表中以2的幂次方偏移量移动。
 *
 * @return 返回新的哈希表
 */
final Node<K,V>[] resize() { // 📏 定义扩容方法
    Node<K,V>[] oldTab = table; // 🗂️ 保存旧的哈希表引用
    int oldCap = (oldTab == null) ? 0 : oldTab.length; // 📊 获取旧表的容量，如果为null则容量为0
    int oldThr = threshold; // 📋 保存旧的阈值
    int newCap, newThr = 0; // 🆕 声明新容量和新阈值变量
    
    // 🔍 如果旧容量大于0（表已初始化）
    if (oldCap > 0) {
        // ⚠️ 如果旧容量已达到最大值，则不再扩容
        if (oldCap >= MAXIMUM_CAPACITY) {
            threshold = Integer.MAX_VALUE; // 🔢 将阈值设为最大整数值
            return oldTab; // ↩️ 直接返回旧表，不扩容
        }
        // 🔢 新容量 = 旧容量 * 2，且不超过最大容量，且旧容量 >= 默认初始容量
        else if ((newCap = oldCap << 1) < MAXIMUM_CAPACITY &&
                 oldCap >= DEFAULT_INITIAL_CAPACITY)
            newThr = oldThr << 1; // 📈 新阈值 = 旧阈值 * 2
    }
    // 🎯 如果旧容量为0但旧阈值大于0（通过构造函数指定了初始容量）
    else if (oldThr > 0)
        newCap = oldThr; // 🆕 新容量等于旧阈值
    // 🌟 如果旧容量和旧阈值都为0（使用默认值初始化）
    else {
        newCap = DEFAULT_INITIAL_CAPACITY; // 🔢 新容量设为默认初始容量16
        newThr = (int)(DEFAULT_LOAD_FACTOR * DEFAULT_INITIAL_CAPACITY); // 📊 新阈值 = 0.75 * 16 = 12
    }
    
    // 🔧 如果新阈值为0，需要重新计算
    if (newThr == 0) {
        float ft = (float)newCap * loadFactor; // 📐 计算新阈值 = 新容量 * 负载因子
        // ✅ 确保新阈值不超过最大值
        newThr = (newCap < MAXIMUM_CAPACITY && ft < (float)MAXIMUM_CAPACITY ?
                  (int)ft : Integer.MAX_VALUE);
    }
    
    threshold = newThr; // 📋 更新阈值
    @SuppressWarnings({"rawtypes","unchecked"})
    Node<K,V>[] newTab = (Node<K,V>[])new Node[newCap]; // 🏗️ 创建新的哈希表数组
    table = newTab; // 🔄 将新表赋值给table字段
    
    // 📦 如果旧表不为空，需要转移元素
    if (oldTab != null) {
        // 🔄 遍历旧表的每个桶
        for (int j = 0; j < oldCap; ++j) {
            Node<K,V> e; // 🏷️ 当前节点
            // 🔍 如果当前桶不为空
            if ((e = oldTab[j]) != null) {
                oldTab[j] = null; // 🧹 清空旧桶，帮助GC
                
                // 🔗 如果桶中只有一个节点（没有链表或红黑树）
                if (e.next == null)
                    newTab[e.hash & (newCap - 1)] = e; // 🎯 直接重新计算位置并放入新表
                
                // 🌳 如果是红黑树节点
                else if (e instanceof TreeNode)
                    ((TreeNode<K,V>)e).split(this, newTab, j, oldCap); // 🌲 调用红黑树的分割方法
                
                // 🔗 如果是链表
                else {
                    Node<K,V> loHead = null, loTail = null; // 🔻 低位链表的头和尾节点
                    Node<K,V> hiHead = null, hiTail = null; // 🔺 高位链表的头和尾节点
                    Node<K,V> next; // ➡️ 下一个节点
                    
                    // 🔄 遍历链表中的所有节点
                    do {
                        next = e.next; // 📍 保存下一个节点
                        
                        // 🎲 通过 (e.hash & oldCap) 判断节点应该放在哪个位置
                        if ((e.hash & oldCap) == 0) {
                            // 🔻 放在原位置（低位链表）
                            if (loTail == null)
                                loHead = e; // 🎯 如果低位链表为空，设置头节点
                            else
                                loTail.next = e; // 🔗 连接到低位链表尾部
                            loTail = e; // 📍 更新尾节点
                        }
                        else {
                            // 🔺 放在原位置+oldCap的位置（高位链表）
                            if (hiTail == null)
                                hiHead = e; // 🎯 如果高位链表为空，设置头节点
                            else
                                hiTail.next = e; // 🔗 连接到高位链表尾部
                            hiTail = e; // 📍 更新尾节点
                        }
                    } while ((e = next) != null); // 🔄 继续遍历直到链表末尾
                    
                    // 🔻 如果低位链表不为空，放入原位置
                    if (loTail != null) {
                        loTail.next = null; // ✂️ 断开链表尾部
                        newTab[j] = loHead; // 📍 放入新表的原位置
                    }
                    
                    // 🔺 如果高位链表不为空，放入新位置
                    if (hiTail != null) {
                        hiTail.next = null; // ✂️ 断开链表尾部
                        newTab[j + oldCap] = hiHead; // 📍 放入新表的 j + oldCap 位置
                    }
                }
            }
        }
    }
    return newTab; // ↩️ 返回新的哈希表
}
```

## 扩容的时候高位和低位链表详解

```java
else {
                    Node<K,V> loHead = null, loTail = null; // 🔻 低位链表的头和尾节点
                    Node<K,V> hiHead = null, hiTail = null; // 🔺 高位链表的头和尾节点
                    Node<K,V> next; // ➡️ 下一个节点
                    
                    // 🔄 遍历链表中的所有节点
                    do {
                        next = e.next; // 📍 保存下一个节点
                        
                        // 🎲 通过 (e.hash & oldCap) 判断节点应该放在哪个位置
                        if ((e.hash & oldCap) == 0) {
                            // 🔻 放在原位置（低位链表）
                            if (loTail == null)
                                loHead = e; // 🎯 如果低位链表为空，设置头节点
                            else
                                loTail.next = e; // 🔗 连接到低位链表尾部
                            loTail = e; // 📍 更新尾节点
                        }
                        else {
                            // 🔺 放在原位置+oldCap的位置（高位链表）
                            if (hiTail == null)
                                hiHead = e; // 🎯 如果高位链表为空，设置头节点
                            else
                                hiTail.next = e; // 🔗 连接到高位链表尾部
                            hiTail = e; // 📍 更新尾节点
                        }
                    } while ((e = next) != null); // 🔄 继续遍历直到链表末尾
                    
                    // 🔻 如果低位链表不为空，放入原位置
                    if (loTail != null) {
                        loTail.next = null; // ✂️ 断开链表尾部
                        newTab[j] = loHead; // 📍 放入新表的原位置
                    }
                    
                    // 🔺 如果高位链表不为空，放入新位置
                    if (hiTail != null) {
                        hiTail.next = null; // ✂️ 断开链表尾部
                        newTab[j + oldCap] = hiHead; // 📍 放入新表的 j + oldCap 位置
                    }
                }
```

### 核心原理

当HashMap从容量n扩容到2n时，每个元素的新位置只有两种可能：

- **保持原位置**（低位链表）
- **移动到原位置+n**（高位链表）

判断依据： `(e.hash & oldCap) == 0`，如果为0，则放在原位置，否则放在原位置+n。 n是旧容量。

- 低位链表（lo list）：满足 `(e.hash & oldCap) == 0` 的节点，扩容后**继续放在原位置** `j`。  
- 高位链表（hi list）：满足 `(e.hash & oldCap) != 0` 的节点，扩容后放在新位置 `j + oldCap`。

#### 举例子

假设oldCap = 16,newCap = 32

oldCap=16 // 10000

newCap=32 // 100000

```
hash1 = 5; // 000101

扩容前(cap = 16)计算index

index1 = hash1 & (oldCap - 1) ==> 5 & 15
 000101
&000111
`--------`
 000101 ==> 5

扩容后(cap = 32)计算index
我们要看要不要移动这个kv到桶中的新位置
判断 (hash & oldCap) == 0

hash1 & oldCap ==> 5 & 16
  00000101
& 00010000
`-----------`
  00000000 ==> 0
所以这个kv会放在原位置5
```

再举个例子

```
hash2 = 20; // 10100

扩容前(cap = 16)计算index

index2 = hash2 & (oldCap - 1) ==> 20 & 15
  10100
& 01111
--------------
  00100 ==> 4

扩容后(cap = 32)计算index
要先看hash & oldCap == 0 ?

hash2 & oldCap ==> 20 & 16
  00010100
& 00010000
--------------
  00010000 ==> 16

不为0，所以这个20会放在新的位置 原来的位置+ 旧桶数组容量 = 4 + 16 = 20

```

你的理解非常正确！🎉👍

你已经掌握了HashMap扩容时分桶位置变更的本质原理，让我们用你的描述稍作归纳和梳理，验证你的思路：

---

### 为什么判断的是与oldCap相与得到的值是1还是0来决定搬迁位置？

当HashMap扩容时，容量从 `oldCap` 扩展到 `newCap`，比如从 16 扩展到 32。

- 原来 HashMap 的下标计算是：`index = hash & (oldCap-1)`，比如 `00001111`（低4位）。
- 扩容后，计算下标变为：`index = hash & (newCap-1)`，比如 `00011111`（低5位），也就是多了一位。
- 和 `oldCap`（如 `00010000`）相与，就相当于“掐头去尾”地只关注扩容新增的那一位：
  - 如果 `(hash & oldCap) == 0`，说明这位是0，**扩容后的位置等于原index**
  - 如果 `(hash & oldCap) != 0`，说明这位是1，**扩容后的位置等于原index + oldCap**
- 这种判断，让你高效知道节点该不该搬迁以及搬去哪里，无需重新完全计算index。

---

#### 举例验证（巩固印象）

假如：

- oldCap = 16 ⇒ 00010000
- oldCap-1 = 15 ⇒ 00001111
- newCap = 32 ⇒ 00100000
- newCap-1 = 31 ⇒ 00011111
- hash = 21 ⇒ 10101

**扩容前下标：**

```java
index = 10101 & 01111 = 00101 = 5
```

**扩容后下标：**

```java
index = 10101 & 11111 = 10101 = 21
```

**oldCap这一位的判断：**

```java
10101 & 10000 = 10000 ≠ 0
```

说明这位是1，扩容后下标变成原index+16=21。

---

### 扩容的条件是什么？

当 HashMap 中存储的元素数量超过了「阈值」（threshold）时，就会进行扩容。
这个「阈值」的计算公式是：

```
threshold = capacity * loadFactor
```

loadFactor 是负载因子，默认值为 0.75。

### 为什么要进行搬迁呢？

HashMap扩容的主要目的是：
减少哈希冲突，提高查找、插入效率。
让更多桶可用，降低碰撞链表队列的长度。

# jdk1.7和jdk1.8中hashmap的区别

![](https://blog.meowrain.cn/api/i/2025/06/13/pf960q-0.webp)

![](https://blog.meowrain.cn/api/i/2025/06/13/pfb9eb-0.webp)

![](https://blog.meowrain.cn/api/i/2025/06/13/pfedpt-0.webp)

![](https://blog.meowrain.cn/api/i/2025/06/13/pfqbnm-0.webp)

![](https://blog.meowrain.cn/api/i/2025/06/13/pfyw7c-0.webp)

# 链表什么时候转红黑树？

桶数组中某个桶的链表长度>=8 而且桶数组长度> 64的时候，hashmap会转换为红黑树

![](https://blog.meowrain.cn/api/i/2025/06/25/hi2z5e-0.webp)
