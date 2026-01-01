---
title: 常见HTTP状态码
published: 2025-09-21
description: ''
image: ''
tags: [HTTP,状态码,计算机网络]
category: '计算机网络'
draft: false 
lang: ''
---

# 1xx信息响应
- 100 Continue: 服务器已接收请求的初步部分，客户端应该继续请求
- 101 Switching Protocols: 服务器同意切换协议，比如从HTTP切换到Webscoket

# 2xx信息响应
- 200 OK: 请求成功，服务器返回请求的资源或者数据
- 201 Created： 请求成功并创建了新资源，常用于POST请求
- 204 No Content: 请求成功但服务器不返回任何信息，常用于删除操作

# 3xx 重定向
- 301 Moved Permanently: 资源已永久移动到新的URL，客户端应该用新URL访问。
- 302 Found: 资源临时移动到新的URL，客户端应该继续使用原来的URL

## 常见重定向机制
![](https://blog.meowrain.cn/api/i/2025/09/21/ukxf35-1.webp)


