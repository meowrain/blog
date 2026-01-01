---
title: nacos安装
published: 2025-07-19
description: ''
image: ''
tags: [nacos, 中间件, 安装]
category: '中间件 > Nacos'
draft: false 
lang: ''
---
# nacos安装

```
docker run --name nacos-standalone-derby \
    -e MODE=standalone \
    -e NACOS_AUTH_TOKEN=bWVvd3JhaW55eWRzNjY2Nm1lb3dyYWlueXlkczY2NjY= \
    -e NACOS_AUTH_IDENTITY_KEY=meowrain \
    -e NACOS_AUTH_IDENTITY_VALUE=meowrain \
    -p 8085:8080 \
    -p 8848:8848 \
    -p 9848:9848 \
    -d nacos/nacos-server:latest
```
