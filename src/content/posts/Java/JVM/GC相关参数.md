---
title: JVM GC相关参数
published: 2025-07-18
description: ''
image: ''
tags: [GC,JAVA,JVM]
category: 'Java > JVM'
draft: false 
lang: ''
---
# GC相关参数

![image.png](https://blog.meowrain.cn/api/i/2025/07/18/10kn2xz-1.webp)

---

### 1. 堆初始大小 (`Xms`)

- **参数:** `Xms<size>`
- **含义:** 设置 JVM 启动时**初始分配的堆内存大小**。
- **作用:**
  - 决定了 Java 程序一启动时，JVM 向操作系统申请的内存大小。
  - 如果设置得太小，JVM 可能会在程序运行初期频繁地进行堆内存扩展，这会带来一定的性能开销。
- **示例:** `Xms512m` 表示设置初始堆大小为 512MB。
- **最佳实践:** 在生产环境中，通常建议将 `Xms` 和 `Xmx` 设置为相同的值，以避免堆的动态扩展和收缩带来的性能抖动。

---

### 2. 堆最大大小 (`Xmx` 或 `XX:MaxHeapSize`)

- **参数:** `Xmx<size>` 或 `XX:MaxHeapSize=<size>`
- **含义:** 设置 JVM **允许分配的最大堆内存大小**。
- **作用:**
  - 这是堆内存的硬性上限。如果应用程序需要的内存超过了这个值，就会抛出 `java.lang.OutOfMemoryError`。
  - 合理设置此值可以防止应用程序因内存泄漏等问题耗尽所有服务器内存，从而影响其他进程。
- **示例:** `Xmx2g` 表示设置最大堆大小为 2GB。

---

### 3. 新生代大小 (`Xmn` 或 `XX:NewSize` + `XX:MaxNewSize`)

- **参数:** `Xmn<size>`
- **含义:** 设置**新生代（Young Generation）的大小**。这是一个快捷参数。
- **作用:**
  - 新生代是绝大多数新对象产生的地方，也是 Minor GC 发生的主要区域。
  - 设置一个合理的新生代大小非常重要。
    - **过小:** 会导致 Minor GC 过于频繁。
    - **过大:** 会挤占老年代的空间，可能导致更频繁的 Full GC。同时，单次 Minor GC 的时间可能会变长。
- **补充:** `Xmn` 实际上是同时设置了 `XX:NewSize`（新生代初始大小）和 `XX:MaxNewSize`（新生代最大大小）。如果希望新生代大小动态变化，可以分别设置这两个参数。

---

### 4. 幸存区比例 (`XX:SurvivorRatio`)

- **参数:** `XX:SurvivorRatio=<ratio>`
- **含义:** 设置新生代中 **Eden 区与一个 Survivor 区的大小比例**。
- **计算公式:** `ratio = Eden区大小 / Survivor区大小`。
- **作用:**
  - 这个比例决定了新生代中用于创建新对象（Eden）和存放幸存对象（Survivor）的空间分配。
  - 例如，`XX:SurvivorRatio=8` 表示 Eden:S0:S1 的比例是 8:1:1。这意味着 Eden 区将占用新生代 8/10 的空间，而每个 Survivor 区占用 1/10。
- **注意:** 这个参数在启用了自适应大小策略（`XX:+UseAdaptiveSizePolicy`，在某些 GC 算法中默认开启）时，其设置的固定比例可能会被 JVM 动态调整。

---

### 5. 幸存区比例 (动态) (`XX:InitialSurvivorRatio` 和 `XX:+UseAdaptiveSizePolicy`)

- **参数:** `XX:+UseAdaptiveSizePolicy`
- **含义:** **启用 GC 自适应大小策略**。这个策略允许 JVM 根据应用程序的运行情况（如吞吐量、停顿时间目标）动态调整堆中各区域的大小，包括 Eden/Survivor 的比例。
- **作用:**
  - 开启后，JVM 会自动优化内存分配，省去了手动精细调优的麻烦。这是 Parallel GC 等收集器默认开启的。
  - `XX:InitialSurvivorRatio` 用于设定自适应策略下的**初始** SurvivorRatio 值，后续 JVM 可能会根据需要进行调整。
- **结论:** 如果你看到这个参数，意味着 JVM 正在自动管理新生代的比例，`XX:SurvivorRatio` 的静态设置可能不会生效。

---

### 6. 晋升阈值 (`XX:MaxTenuringThreshold`)

- **参数:** `XX:MaxTenuringThreshold=<threshold>`
- **含义:** 设置对象从新生代晋升到老年代的**年龄阈值**。
- **作用:**
  - 一个对象在 Survivor 区每熬过一次 Minor GC，其年龄就加 1。当年龄达到这个阈值时，就会被移动到老年代。
  - 默认值通常是 15（或 6，取决于 GC）。
  - 如果设置得太高，对象可能长时间停留在 Survivor 区，增加了复制成本；如果设置得太低，可能导致一些生命周期不长的对象过早进入老年代，增加了 Full GC 的压力。

---

### 7. 晋升详情 (`XX:+PrintTenuringDistribution`)

- **参数:** `XX:+PrintTenuringDistribution`
- **含义:** 一个诊断参数，用于在每次 Minor GC 后**打印出 Survivor 区中对象的年龄分布情况**。
- **作用:**
  - 这是调优 `XX:MaxTenuringThreshold` 的重要工具。
  - 通过观察日志，你可以看到每个年龄段有多少对象，以及 JVM 计算出的动态晋升阈值，从而判断当前设置是否合理。

---

### 8. GC 详情 (`XX:+PrintGCDetails` 和 `verbose:gc`)

- **参数:** `XX:+PrintGCDetails` 或 `verbose:gc`
- **含义:** 打印详细的 GC 日志信息。
- **作用:**
  - 这是进行 GC 性能分析和故障排查的**必备参数**。
  - `verbose:gc` 是一个标准参数，输出基本的 GC 信息。
  - `XX:+PrintGCDetails` 会提供更详尽的信息，包括每次 GC 前后堆各区域的大小、GC 耗时等。
- **推荐:** 通常与 `XX:+PrintGCTimeStamps` 或 `XX:+PrintGCDateStamps` 一起使用，为日志增加时间戳。

---

### 9. FullGC 前 MinorGC (`XX:+ScavengeBeforeFullGC`)

- **参数:** `XX:+ScavengeBeforeFullGC`
- **含义:** 指示 JVM 在执行 Full GC 之前，先强制进行一次 Minor GC。
- **作用:**
  - 理论上，这可以清理掉新生代中大部分可以被回收的对象，从而减轻 Full GC 的负担，因为 Full GC 需要处理整个堆（包括新生代）。
- **注意:**
  - 此参数在现代的 GC（如 G1）中已不推荐使用或被废弃，因为它们有更智能的回收策略。
  - 在某些情况下，它可能会引入一次额外的、不必要的停顿（Minor GC 的停顿）。因此，除非有明确的测试数据支持，否则一般不建议开启。
