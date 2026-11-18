---
title: scoop配置国内源
published: 2026-01-19T20:49:49
description: 'scoop配置国内源'
image: ''
category: 开发日记
draft: false 
lang: ''
---

# 更换scoop主仓库
```
# 南京大学
scoop config SCOOP_REPO "https://mirrors.nju.edu.cn/git/scoop-installer/Scoop.git"



# 添加南京大学extras仓库
scoop bucket add extras https://mirrors.nju.edu.cn/git/scoop-extras.git

```



## 相关链接

Scoop 官方文档（下面这个链接独占一段，会被自动渲染成站点卡片）：

https://scoop.sh

带文字的独占段落链接同样生效：

[Astro 官方文档](https://docs.astro.build)

下面这些不会被处理：段内还有文字 [混在句子里的链接](https://example.com) 保持原样、站内链接 [双链说明](/posts/) 不受影响。

- 列表里的链接不做卡片：https://example.com

想单条关闭卡片，写成这样：[Astro 官方文档](https://docs.astro.build){linkcard=false}

```
# 代码块里的链接也不会被处理
https://example.com
```
