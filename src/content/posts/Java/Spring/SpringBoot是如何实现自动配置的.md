---
title: SpringBoot是如何实现自动配置的
published: 2025-09-15
description: ''
image: ''
tags: ['SpringBoot','Java','自动配置']
category: 'Java > Spring'
draft: false 
lang: ''
---

# SpringBoot是如何实现自动配置的

Spring Boot的自动配置是通过 `@EnableAutoConfiguration` 注解来实现的。
这个注解包含 `@Import({AutoConfigurationImportSelector.class})`注解
导入的这两个类会扫描classpath下所有的`META-INF/spring.factories`中的文件，根据文件中指定的配置类加载相应的Bean的自动配置。

这些Bean通常会使用 `@ConditionOnClass`,`@ConditionOnMissingBean`,`@ConditionalOnProperty`等注解来控制自动配置的加载条件，例如仅在类路径中存在某个类的时候，才加载某些配置。

![](https://blog.meowrain.cn/api/i/2025/09/16/ip1efv-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/16/ipewwv-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/16/iqpz9m-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/16/iquhuf-1.webp)
