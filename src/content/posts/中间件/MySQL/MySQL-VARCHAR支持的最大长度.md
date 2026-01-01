---
title: MySQL-VARCHAR支持的最大长度
published: 2025-09-07
description: ''
image: ''
tags: ['MySQL', 'VARCHAR']
category: '中间件 > MySQL'
draft: false 
lang: ''
---

MySQL中，最大行长度限制为65535字节，如果一行中仅仅有一个varchar字段，它的最大长度是多少呢？
（InnoDB/MyISAM 中一行最大长度限制是 65535 字节（65 KB 左右）。）
长度> 255,存储varchar长度需要2字节，长度<255，存储varchar长度需要1字节。

所以
- 当长度>255且非空的时候，可以存储65535 - 2 = 65533 字节。
- 当长度>255且可以为空的时候，可以存储65535 - 2 - 1（存储NULL标志） = 65532字节。
- 当长度<255且非空的时候，可以存储65535 - 1 = 65534 字节。
- 当长度<255且可以为空的时候，可以存储65535 - 1 - 1（存储NULL标志） = 65533字节。

如果只有一个 VARCHAR 字段

假设表里只有这一列：

```sql
CREATE TABLE t (
  v VARCHAR(N)
) ENGINE=InnoDB;
```

行最大长度：65535 字节。

除了数据外，还有：

NULL 标志位（至少 1 字节，即使只有一列）。

VARCHAR 长度字节（1 或 2）。

所以最大能用来存储 v 的 = 65535 - 1 (NULL 标志) - 2 (长度字节) = 65532 字节。

因此：

✅ 单列 VARCHAR 最大可定义为 VARCHAR(65532)


> 如果是非null，就不需要占用那一字节null标志位了
```sql
CREATE TABLE t (
  v VARCHAR(N) NOT NULL 
) ENGINE=InnoDB;
```

这里N就可以是65533了


![](https://blog.meowrain.cn/api/i/2025/09/07/xz52lm-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/07/xy0628-1.webp)