---
title: MySQL联合索引失效情况
published: 2025-09-15
description: ''
image: ''
tags: ['MySQL','联合索引']
category: '中间件 > MySQL'
draft: false 
lang: ''
---

# MySQL联合索引失效情况


## 1. 不满足最左匹配原则

## 2. 在索引上使用函数或者运算

## 3. 索引列参与隐式类型转换

## 4. 使用NOT IN,!=,<>等否定操作符

## 5. 模糊匹配 like %xxx%

## 6.OR操作符
如果在Where子句中使用了OR操作符，并且OR前的条件列是索引列，OR后的不是索引列，那么索引可能会失效。

## 7. 使用 not exists关键字，索引也会失效（本质上是Where查询范围太大）

## 8. 使用Order By 注意最左匹配，要加limit或者Where关键字，否则索引会失效