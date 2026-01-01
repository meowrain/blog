---
title: MySQL中CHAR和VARCHAR的区别
published: 2025-09-07
description: ''
image: ''
tags: ['MySQL', 'CHAR', 'VARCHAR']
category: '中间件 > MySQL'
draft: false 
lang: ''
---

![](https://blog.meowrain.cn/api/i/2025/09/07/xy0628-1.webp)

# CHAR(n)
char(n) 是固定长度的字符串，CHAR列的长度是固定的，即使存储的字符串长度小于定义的长度，MySQL也会在字符串的末尾填充空格以达到指定的长度。

# VARCHAR(n)
可变长度的字符串，varchar列的长度是可变的，存储的字符串长度与实际数据长度相等，并且在存储数据的时候会额外增加1到2个字节（字符串长度超过255，就用两个字节） 用于存储字符串的长度信息。

理论上char比varchar会快，因为varchar长度不固定，处理需要多一次运算，但是实际上这种运算耗时微乎其微，而固定大小在很多场景下比较浪费空间，除非存储的字符确认是固定大小或者本身就很短，不然业务上推荐使用varchar. 

