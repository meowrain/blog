---
title: Nginx编译安装
published: 2025-07-18
description: ''
image: ''
tags: [Nginx编译安装]
category: '中间件 > Nginx'
draft: false 
lang: 'zh-cn'
---


# nginx编译安装

```
wget https://nginx.org/download/nginx-1.28.0.tar.gz
tar -zxvf ninx-1.28.0.tar.gz
sudo apt install -y build-essential libtool zlib1g-dev openssl libpcre3 libpcre3-dev libssl-dev libgeoip-dev
sudo apt install libpcre2-dev

# 常用模块配置
./configure \
--prefix=/usr/local/nginx \
--pid-path=/var/run/nginx/nginx.pid \
--lock-path=/var/lock/nginx.lock \
--error-log-path=/var/log/nginx/error.log \
--http-log-path=/var/log/nginx/access.log \
--with-http_gzip_static_module \
--http-client-body-temp-path=/var/temp/nginx/client \
--http-proxy-temp-path=/var/temp/nginx/proxy \
--http-fastcgi-temp-path=/var/temp/nginx/fastcgi \
--http-uwsgi-temp-path=/var/temp/nginx/uwsgi \
--http-scgi-temp-path=/var/temp/nginx/scgi \
--with-stream \
--with-http_ssl_module \
--with-stream_ssl_preread_module  # 新增：支持 ssl_preread 指令

make
make install

```
