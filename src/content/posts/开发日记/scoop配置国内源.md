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


