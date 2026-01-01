---
title: MySQL中几种count的区别
published: 2025-09-07
description: "MySQL中count(*),count(1)和count(字段名)的区别"
image: ""
tags: ["count", "MySQL"]
category: "中间件 > MySQL"
draft: false
lang: ""
---

# count(\*) 和 count(1)

是用来统计行数的聚合函数，统计表中的全部行的数量，包括 null 值

# count(字段名)

也是用来统计行数的聚合函数，会统计指定字段下不为 null 的行数，这种写法会对指定的字段进行计数，只会统计字段值不为 null 的行。

![](https://blog.meowrain.cn/api/i/2025/09/07/zckucc-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/07/zebv8e-1.webp)
