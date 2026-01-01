---
title: Java类加载器与双亲委派机制
published: 2025-07-18
description: ''
image: ''
tags: [Java,类加载器,ClassLoader,双亲委派机制]
category: 'Java > JVM'
draft: false 
lang: ''
---
# Java类加载器和双亲委派机制

[Java 虚拟机之类加载](https://dunwu.github.io/waterdrop/pages/3e37ea6e/#%E7%B1%BB%E5%8A%A0%E8%BD%BD%E6%9C%BA%E5%88%B6)

## Java类加载器层级

Java类加载器从高到低分为以下层级（以JDK 8为例）：

1. **启动类加载器（Bootstrap ClassLoader）** ：加载JRE的`lib`目录下的核心类库（如`rt.jar`）。
2. **扩展类加载器（Extension ClassLoader）** ：加载`lib/ext`目录下的扩展类。
3. **应用程序类加载器（Application ClassLoader）** ：加载用户类路径（ClassPath）下的类。
4. **自定义类加载器**：用户可自定义类加载器（需继承`ClassLoader`）。

## 什么是双亲委派机制

**双亲委派机制** 是Java类加载器的核心工作机制。它的核心思想是：当一个类加载器需要加载某个类时，不会直接尝试自己加载，而是将这个请求**逐级向上委托给父类加载器**处理。只有当所有父类加载器都无法完成加载时，子类加载器才会尝试自己加载。

## ## 示意图

![image.png](https://blog.meowrain.cn/api/i/2025/07/18/12c4ooa-1.webp)

![image.png](https://blog.meowrain.cn/api/i/2025/07/18/12c4ix7-1.webp)

[深入理解Java双亲委派机制：原理、意义与实战示例 - 云熙橙 - 博客园](https://www.cnblogs.com/xchangting/articles/18744083)

## 双亲委派机制的好处

1. **保障核心类库的安全**防止用户自定义的类（如`java.lang.Object`）覆盖JVM核心类。例如，如果用户编写了一个恶意`String`类，双亲委派机制会优先加载核心库中的`String`，从而避免安全隐患。
2. **避免重复加载**同一个类只会被一个类加载器加载一次，防止内存中出现多个相同类的副本，确保类的唯一性。
3. **实现代码隔离**不同类加载器加载的类属于不同的命名空间，天然支持模块化（如Tomcat为每个Web应用分配独立的类加载器）。
