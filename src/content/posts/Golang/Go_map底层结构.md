---
title: Go_map底层结构
published: 2025-07-19
description: ''
image: 'https://blog.meowrain.cn/api/i/2025/07/19/uje4vo-1.webp'
tags: [切片, Golang, Go]
category: 'Go'
draft: false 
lang: ''
---
# Golang map底层数据结构

<https://golang.design/go-questions/map/principal/>

[Golang map 实现原理](https://mp.weixin.qq.com/s?__biz=MzkxMjQzMjA0OQ==&mid=2247483868&idx=1&sn=6e954af8e5e98ec0a9d9fc5c8ceb9072&chksm=c10c4f02f67bc614ff40a152a848508aa1631008eb5a600006c7552915d187179c08d4adf8d7&scene=0&xtrack=1&subscene=90#rd)

## 概述

map是一种常用的数据结构，核心特征包括下面三点：

- 存储基于key-value对映射的模式
- 基于key维度实现存储数据的去重
- 读，写，删操作控制，时间复杂度O(1)

![image-20250402212335440](https://blog.meowrain.cn/api/i/2025/04/02/n5y1Lh1743600215837401704.avif)

### 初始化方法

```go
map1 := make(map[string]int)

map2 := map[string]int{
    "m1": 1,
    "m2":2,
}

```

### key 类型要求

map中,key的数据类型必须是可以比较的类型,slice,chan,func,map不可比较，所以不能作为map的key

![image-20250402210528197](https://blog.meowrain.cn/api/i/2025/04/02/fFJnr51743599129052146367.avif)

![image-20250402210536019](https://blog.meowrain.cn/api/i/2025/04/02/3eTMZz1743599137424628575.avif)

![image-20250402210601926](https://blog.meowrain.cn/api/i/2025/04/02/yP4UYM1743599162191602503.avif)

![image-20250402210607311](https://blog.meowrain.cn/api/i/2025/04/02/KZhyJp1743599167648587617.avif)

![image-20250402210620988](https://blog.meowrain.cn/api/i/2025/04/02/QFpAk21743599181398433044.avif)

# 核心原理

map又称为hash map，算法上基于hash实现key的映射和寻址，在数据结构上基于桶数组实现key-value对的存储

以一组key-value对写入map的流程进行简述：

1. 通过哈希方法去的key的hash值‘
2. hash值对同数组长度取模，确定它所属的桶
3. 在桶中插入key value对

![图片](https://blog.meowrain.cn/api/i/2025/04/02/MmAiV11743599321939050023.avif)

## hash

hash 译作散列，是一种将任意长度的输入压缩到某一固定长度的输出摘要的过程，由于这种转换属于压缩映射，输入空间远大于输出空间，因此不同输入可能会映射成相同的输出结果. 此外，hash在压缩过程中会存在部分信息的遗失，因此这种映射关系具有不可逆的特质.

1. hash的可重入性： 相同的key，必然产生相同的hash值
2. hash的离散性： 只要两个key不相同，不论他们相似度的高低，产生的hash值会在整个输出域内均匀地离散化
3. hash的单向性： 企图通过hash值反向映射会key是无迹可寻的。
4. hash冲突： 由于输入域无穷大，输出域有限，必然存在不同key映射到相同hash值的情况，这种情况叫做哈希冲突

![图片](https://blog.meowrain.cn/api/i/2025/04/02/RV0Syj1743599459574600284.avif)

## 桶数组

map中，会通过长度为2的整数次幂的桶数组进行key-value对的存储

1. 每个桶固定可以存放8个key-value对
2. 倘若超过8个key-value对打到桶数组的同一个索引当中，此时会通过创建桶链表的方式来化解这个问题。

![图片](https://blog.meowrain.cn/api/i/2025/04/02/X7NMOa1743599952016346994.avif)

## 拉链法解决hash冲突

首先，由于hash冲突的存在，不同的key可能存在相同的hash值

再者，hash值会对桶数组长度取模，因此不同的hash值可能被打到同一个桶中

综上，不同的key-value可能被映射到map的同一个桶当中。

拉链法中，将命中同一个桶的元素通过链表的形式进行连接，因此便于动态扩展

> 只有当一个桶已经满了（8 个 kv 对），并且又有新的 key 哈希到这个桶时，才会创建溢出桶，并将新的 key-value 对存储到溢出桶中，然后将该溢出桶链接到原桶的尾部。  后续再有冲突的 kv 对，也会被添加到溢出桶或者新的溢出桶中，形成一个链表。

![img](https://blog.meowrain.cn/api/i/2025/04/02/lgobAo1743600543664079674.avif)

## 开放寻址法解决hash冲突

> 开放寻址法是一种解决哈希冲突的方法，它在哈希表中寻找另一个空闲位置存储冲突的元素，也就是说，所有元素都直接存储在哈希表的桶中
>
> 开放寻址法是一种在哈希表中解决冲突的方法。当两个不同的键映射到同一个索引位置时，就会发生冲突。开放寻址法不是使用链表等额外的数据结构来存储冲突的键值对，而是尝试在哈希表本身中寻找一个空闲的位置来存储新的键值对。

![图片](https://blog.meowrain.cn/api/i/2025/04/02/GNSRsu1743600902616857141.avif)

常见开放寻址技术：

- 线性寻址： 如果在索引`i`发生冲突，线性探测会依次检查`i+1`,`i+2`,`i+3`等位置，直到找到一个空闲的槽位
- 二次探测检查 `i + 1^2`、`i + 2^2`、`i + 3^2` 等位置。与线性探测相比，这有助于减少聚集现象。
- 双重哈希： 双重哈希使用第二个哈希函数来确定探测的步长。如果第一个哈希函数在索引`i`导致哈希冲突，第二个哈希函数hash2(key)用于确定探测的间隔（例如，`i + hash2(key)`、`i + 2*hash2(key)`、`i + 3*hash2(key)` 等）。

![image-20250402213515236](https://blog.meowrain.cn/api/i/2025/04/02/lsNJNR1743600915626536212.avif)

我们的golang map解决哈希冲突的方式结合了拉链法和开放寻址法。

- 桶： map的底层数据结构是一个桶数组，每个桶严格意义上是一个单向桶链表
- 桶的大小： 每个桶可以固定存放8个key value对
- 当key命中一个桶的时候，首先根据开放寻址法，在桶的8个位置中寻找空位进行插入
- 倘若8个位置都已经被占满，就基于桶的溢出桶指针，找到下一个桶（重复第三步）
- 倘若遍历到链表尾部，还没找到空位，就用拉链法，在桶链表尾部接入新桶，并且插入key-value对

![image-20250402215431186](https://blog.meowrain.cn/api/i/2025/04/02/PB9PuR1743602071901331051.avif)

![图片](https://blog.meowrain.cn/api/i/2025/04/02/Xlpg4R1743602154258822359.avif)

## 扩容性能优化

倘若map的桶数组长度固定不变，那么随着key-value对数量的增长，当一个桶下挂载的key-value达到一定的量级，此时操作的时间复杂度会趋于线性，无法满足诉求。

**桶数组长度固定不变 + key-value 对数量持续增加 => 哈希冲突加剧 => Bucket 链表变长 => 查找/插入/删除 需要遍历长链表 => 操作时间复杂度接近 O(n) （线性）**

因此在设计上，map桶的数组长度会随着key-value对的数量变化而实时调整。保证每个桶内的key-value对数量始终控制在常量级别。

扩容类型分为：

- 增量扩容
- 等量扩容

### 增量扩容

触发条件： `key-value总数 / 桶数组长度 > 6.5`的时候，发生增量扩容

扩容方式： 桶数组长度增长为原来的`两倍`

目的： 减少负载因子，降低平均查找时间

负载因子： `key-value总数 / 桶的数量`

![image-20250402225053461](https://blog.meowrain.cn/api/i/2025/04/02/exh1He1743605454120683710.avif)

### 等量扩容

触发条件： 当桶内溢出桶数量大于等于2^B时（B 为桶数组长度的指数，B 最大取 15)，发生等量扩容。）

扩容方式： 桶的长度保持为原来的值

**目的：** 解决哈希冲突严重的问题，可能由于哈希函数选择不佳导致大量 key 映射到相同的桶，即使负载因子不高，也会出现大量溢出桶。 等量扩容旨在重新组织数据，减少溢出桶的数量。

![image-20250402231943679](https://blog.meowrain.cn/api/i/2025/04/02/m4tdlZ1743607184556640257.avif)

![image-20250402231929805](https://blog.meowrain.cn/api/i/2025/04/02/7Rrm4l1743607170611676452.avif)

### 渐进式扩容

![image-20250402233251365](https://blog.meowrain.cn/api/i/2025/04/02/8hpZdr1743607972891808021.avif)

![图片](https://blog.meowrain.cn/api/i/2025/04/02/2Cb2MO1743608023551743628.avif)

# 数据结构

## hmap

```go
type hmap struct {
    count int // map中键值对的数量
    flags uint8 // map的状态标志位，用来指示map的当前状态（正在写入，正在扩容等）
    B uint8 // buckets 数组的对数大小，2^B 是buckets数组的长度，比如B是5，那么桶数组的长度就是2^5 = 32
    noverflow uint16 //溢出桶数量的近似值 用来判断是否需要扩容
    hash0 uint32 // 哈希种子
    buckets unsafe.Pointer //指向bucket数组的指针，数组大小为2 ^ B，如果count == 0,那么buckets可能为nil
    oldbuckets unsafe.Pointer // 如果发生扩容，指向旧的buckets数组
    nevacuate uintptr // 扩容的时候，表示旧buckcet数组已经迁移到新bucket数组的数量计数器
    extra *mapextra // 可选字段，用来保存overflow buckets的信息
}
```

flags: map状态标识，其包含的主要状态为（这里面牵扯到很多概念还没有涉及，可以先大致的了解一下各自的含义）

- iterator(`0b0001`): 当前map可能正在被遍历
- oldIterator(`0b0010`): 当前map的旧桶可能正在被遍历
- hashWrting(`0b0100`): 一个goroutine正在向map中写入数据
- sameSizeGrow(`0b1000`): 等量扩容标志字段

## bmap

![](https://blog.meowrain.cn/api/i/2025/04/04/Nb8mWR1743757559555396698.avif)

![](https://blog.meowrain.cn/api/i/2025/04/04/R3jihc1743757664615047610.avif)

> bmap就是map中的桶，可以存储8组key-value对数据，以及一个只想下一个溢出桶的指针

![](https://blog.meowrain.cn/api/i/2025/04/04/cH27qX1743757980953367677.avif)

每一组key-value对数据包含key高8位hash值tophash，key,value三部分

我们来看看bmap（桶）的内存模型

![](https://blog.meowrain.cn/api/i/2025/04/04/4iwDeb1743757807687319535.avif)

如果按照 `key/value/key/value/...` 这样的模式存储，那在每一个 key/value 对之后都要额外 padding 7 个字节；而将所有的 key，value 分别绑定到一起，这种形式 `key/key/.../value/value/...`，则只需要在最后添加 padding。

每个 bucket 设计成最多只能放 8 个 key-value 对，如果有第 9 个 key-value 落入当前的 bucket，那就需要再构建一个 bucket ，通过 `overflow` 指针连接起来。

### tophash的作用？

是key 哈希值的高8位

tophash的核心作用是**判断一个键是否可能存在于当前桶中，从而优化查询效率。**

## 溢出桶数据结构 mapextra

在map初始化的时候会根据初始数据量不同，自动创建不同数量的溢出桶。在物理结构上初始的正常同和溢出桶是连续存放的，正常桶和溢出桶之间的关系是靠链表来维护的。

> `mapextra` 就是在扩容时提供了一批预备的 `bmap`，然后利用 `bmap.overflow` 把它们链接起来。

```go
type mapextra struct {
    overflow *[]*bmap // overflow buckets 的指针数组
    oldoverflow *[]*bmap // 旧的 overflow buckets 的指针数组

    nextOverflow *bmap // 指向空闲的 overflow bucket
}

```

在map初始化的时候，倘若容量过大，会提前申请好一批溢出桶，供后续使用，这部分溢出桶存放在hmap.mapextra当中：

mapextra.overflow 是一个指向溢出桶切片的指针，这个切片里面的溢出桶是当前使用的，用于存储hmap.buckets中的桶的溢出数据。

mapextra.oldoverflow 也是一个指向溢出桶切片的指针，但是它指向的是旧的桶数组的溢出桶。

nextOverflow指向下一个可用的溢出桶

![](https://blog.meowrain.cn/api/i/2025/04/04/eZLvxe1743757352736850834.avif)

---

# 什么是哈希种子？

哈希种子(hash seed)是一个随机生成的数值，被用作哈希函数的一部分，来增加哈希值的随机性和不可预测性，可以把它理解为哈希函数的“盐”

# go map 如何根据key的哈希值确定键值存储到哪个桶中？

## 哈希值的作用

- 首先，当你在 Go map 中插入一个键值对时，Go runtime 会对键进行哈希运算，生成一个哈希值（一个整数）。 优秀的哈希函数应该能够将不同的键尽可能均匀地映射到不同的哈希值，以减少哈希碰撞的概率。
- 这个哈希值是确定键值对存储位置的关键。

## go map 数据结构中hmap 中B的作用

我们通过哈希值的低B位作为bucket数组的索引， 来选择键值该存储到哪个bucket中。

公式 `bucketIndex = hash & ((1 << B)  - 1)`

上面的公式 用来**保留 `hash` 的低 `B` 位，并将其他位设置为 0**。

![image-20250402234237409](https://blog.meowrain.cn/api/i/2025/04/02/Vtatge1743608558267235069.avif)

# key定位过程

key经过哈希计算后得到哈希值，共64个bit位，计算它到底要落在哪个桶的时候，只会用到最后B个bit位（log2BucketCount）

例如，现在有一个key经过哈希函数计算后，得到的哈希结果是：

```
 10010111 | 000011110110110010001111001010100010010110010101010 │ 01010
```

而我们的B是5，也就是有2^5 = 32个桶

取最后五位，也就是 **01010** 转换为10进制也就是10，也就是 **10号桶**,这个操作其实是 **取余操作**，但是取余数开销太大，就用上面的位运算代替了。

接下来我们再用 **hash值的高8位**找到key在 **10号桶**中的位置 **1001011转换为10进制也就是 75**.最开始桶内还没有 key，新加入的 key 会找到第一个空位，放入。

![](https://blog.meowrain.cn/api/i/2025/04/04/JcLsW91743759107613607466.avif)

![](https://blog.meowrain.cn/api/i/2025/04/04/dCIofJ1743759450720106234.avif)

# 流程

![](https://blog.meowrain.cn/api/i/2025/04/05/VUcqQy1743839544909227250.avif)

# 写入流程

写入流程：

- 进行hmap是否为nil的检查，如果为空，就触发panic
- 进行并发读写的检查，倘若已经设置了并发读写标记，就抛出"concurrent map writes"异常。
- 处理桶迁移。如果正在扩容，把key所在的旧桶数据迁移到新桶，同时迁移index位h.nevacuate的桶，迁移完成后h.nevacuate自增。更新迁移进度。如果所有桶迁移完毕，清除正在扩容的标记。
- 查找 key 所在的位置，并记录桶链表的第一个空闲位置（若此 key 之前不存在，则将该位置作为插入位置）。
- 若此 key 在桶链表中不存在，判断是否需要扩容，若溢出桶过多，则进行相同容量的扩容，否则进行双倍容量的扩容。
- 若桶链表没有空闲位置，则申请溢出桶来存放 key - value 对。
- 设置 key 和 tophash[i] 的值。
- 返回 value 的地址。

# 删除流程

删除流程：

- 进行并发读写检查。
- 处理桶迁移，如果map处于正在扩容的状态，就迁移两个桶
- 定位key所在的位置
- 删除kv对的占用，这里是伪删除，只有在下次扩容的时候，被删除的key所占用的同空间才会得到释放。
- map首先会将对应位置的tophash[i]设置为emptyOne，表示该位置被删除
- 如果tophash[i]后面还有有效的节点，就仅设置为emptyOne标志，意味着这个节点后面仍然存在有效的key-value对 ，后续在查找某个key的时候，这个节点只后仍然需要继续查找
- 要是tophash[i]是桶链表的最后一个有效节点，那么从这个节点往前遍历，将链表最后面所有标志位emptyOne的位置，都设置为emptyRest。这样在查找某个key的时候，emptyRest之后的节点不需要继续查找。

> - **`emptyOne`：** 表示当前 cell 是空的，但**不能保证**后面的 cell 也是空的。
> - **`emptyRest`：** 表示当前 cell 是空的，并且**保证**后面的所有 cell 也是空的，直到遇到一个非空 cell 或者到达桶的末尾。

# 迭代流程

在每次对 map 进行循环时，会调用 mapiterinit 函数，以确定迭代从哪个桶以及桶内的哪个位置起始。由于 mapiterinit 内部是通过随机数来决定起始位置的，所以 map 循环是无序的，每次循环所返回的 key - value 对的顺序都各不相同。

![](https://blog.meowrain.cn/api/i/2025/04/05/TABXTR1743840105513843585.avif)
