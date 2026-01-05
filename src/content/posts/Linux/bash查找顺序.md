---
title: Bash查找命令顺序
published: 2026-01-05T22:06:25
description: ''
image: ''
category: 'Linux'
draft: false 
lang: ''
---

# Bash命令查找顺序

# 1. 绝对路径或者相对路径

优先级最高，如果输入的命令用 '/'或者'./'开头，bash会直接访问指定路径下的文件去执行
比如： 输入 '/bin/ls'或者'./script.sh' bash会直接执行这个路径下面的文件，跳过后续所有的查找步骤

# 2. 别名
比如: `alias ll = 'ls -l'` 输入ll会被替换为'ls -l '

> ps: 买了不少vps,发现有的vps 的ls命令，可执行文件和目录的颜色和普通文件的文件名颜色不一样，之前一直不知道为什么。后来看了下才知道是用到了别名优先级比较高的特性

![](https://blog.meowrain.cn/api/i/2026/01/05/10muvzx-1.webp)


能看到上面有配置`alias ls = 'ls --color=auto'`


# Shell内置命令
如果别名没有匹配,bash会去检查是不是内置命令（比如cd,echo这种）


# 哈希表

![](https://blog.meowrain.cn/api/i/2026/01/05/10pax8l-1.webp)

![](https://blog.meowrain.cn/api/i/2026/01/05/10q01ct-1.webp)


![](https://blog.meowrain.cn/api/i/2026/01/05/10pyvd2-1.webp)



# 环境变量 path中的目录
最后一步，Bash按照PATH定义的目录顺序从左到右搜索可执行文件

![](https://blog.meowrain.cn/api/i/2026/01/05/10qkdcl-1.webp)