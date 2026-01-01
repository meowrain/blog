---
title: MySQL-relaylog（中继日志）
published: 2025-09-16
description: ''
image: ''
tags: [MYSQL,relaylog,MySQL]
category: '中间件 > MySQL'
draft: false 
lang: ''
---
# Relay Log（中继日志）

中继日志（relay log）只在主从服务器架构的从服务器上存在。从服务器（slave）为了与主服务器(Master)保持一致，要从主服务器读取二进制日志的内容，并且把读取到的信息写入本地的日志文件中，这个从服务器本地的日志文件就叫中继日志。然后，从服务器读取中继日志，并根据中继日志的内容对从服务器的数据进行更新，完成主从服务器的数据同步。

搭建好主从服务器之后，中继日志默认会保存在从服务器的数据目录下。

文件名的格式是：从服务器名 - relay-bin.序号。中继日志还有一个索引文件：从服务器名 - relay-bin.index，用来定位当前正在使用的中继日志。

![](https://blog.meowrain.cn/api/i/2025/09/16/11ci8hc-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/16/11d3ogv-1.webp)