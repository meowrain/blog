---
title: 开发日记/记一次springcloud项目启动显示端口被占用但是查不到占用进程的问题
published: 2026-01-11T12:27:39
description: ''
image: ''

draft: false 
lang: ''
---

# 开发日记/记一次springcloud项目启动显示端口被占用但是查不到占用进程的问题

换了台电脑，自己写的项目都跑不起来了。。。。网上说要拿netstat -ano | findstr 端口号 来查看占用进程，但是我查不到占用进程。。。

![](https://blog.meowrain.cn/api/i/2026/01/11/kb4rrh-1.webp)

![](https://blog.meowrain.cn/api/i/2026/01/11/kbeze4-1.webp)


# 解决办法
查了下，windows是有预留端口的

```
netsh interface ipv4 show excludedportrange protocol=tcp
```

![](https://blog.meowrain.cn/api/i/2026/01/11/kc0rzr-1.webp)

奥原来是在预留端口范围里面。。。。

![](https://blog.meowrain.cn/api/i/2026/01/11/kck57k-1.webp)