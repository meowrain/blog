---
title: SpringBean生命周期
published: 2025-07-28
description: ''
image: ''
tags: ["Spring","Java"]
category: 'Java > Spring'
draft: false 
lang: ''
---

# Bean 的生命周期

![image](https://blog.meowrain.cn/api/i/2025/07/28/skj7xz.webp)

Bean生命周期可以粗略的划分为五大步：

第一步：实例化Bean
第二步：Bean属性赋值
第三步：初始化Bean
第四步：使用Bean
第五步：销毁Bean
![image](https://blog.meowrain.cn/api/i/2025/07/28/si308s.webp)

```java
package com.powercode.spring6.beans;

public class User {
    private String name;
    public User() {
        System.out.println("1.实例化Bean");
    }

    public void setName(String name) {
        this.name = name;
        System.out.println("2.Bean属性赋值");
    }

    public void initBean(){
        System.out.println("3.初始化Bean");
    }

    public void destroyBean(){
        System.out.println("5.销毁Bean");
    }

}

```

```
2024-01-11 12:21:23 618 [main] DEBUG org.springframework.context.support.ClassPathXmlApplicationContext - Refreshing org.springframework.context.support.ClassPathXmlApplicationContext@183e8023
2024-01-11 12:21:23 715 [main] DEBUG org.springframework.beans.factory.xml.XmlBeanDefinitionReader - Loaded 1 bean definitions from class path resource [spring12.xml]
2024-01-11 12:21:23 732 [main] DEBUG org.springframework.beans.factory.support.DefaultListableBeanFactory - Creating shared instance of singleton bean 'userBean'
1.实例化Bean
2.Bean属性赋值
3.初始化Bean
4.使用Bean
2024-01-11 12:21:23 774 [main] DEBUG org.springframework.context.support.ClassPathXmlApplicationContext - Closing org.springframework.context.support.ClassPathXmlApplicationContext@183e8023, started on Thu Jan 11 12:21:23 CST 2024
5.销毁Bean
2024-01-11 12:21:23 774 [main] DEBUG org.springframework.beans.factory.support.DisposableBeanAdapter - Custom destroy method 'destroyBean' on bean with name 'userBean' completed

进程已结束，退出代码为 0

```

![image](https://blog.meowrain.cn/api/i/2025/07/28/sd8zrp.webp)

## Bean后处理器
加上后处理器就变成七步了：
![image](https://blog.meowrain.cn/api/i/2025/07/28/sj8wqs.webp)


### BeanPostProcessor 的核心作用
BeanPostProcessor 本身并不属于某个特定 Bean 的生命周期，而是作用于容器中所有 Bean 的 “全局处理器”。它的核心功能是：在 Bean 完成实例化和属性赋值后、初始化方法（如 afterPropertiesSet() 或 init-method）执行前后，对 Bean 进行加工或增强。

上图中检查Bean是否实现了Aware的相关接口是什么意思？


## Aware相关接口
Aware相关的接口包括：BeanNameAware、BeanClassLoaderAware、BeanFactoryAware

当Bean实现了BeanNameAware，Spring会将Bean的名字传递给Bean。
当Bean实现了BeanClassLoaderAware，Spring会将加载该Bean的类加载器传递给Bean。
当Bean实现了BeanFactoryAware，Spring会将Bean工厂对象传递给Bean。
测试以上10步，可以让User类实现5个接口，并实现所有方法：
- BeanNameAware
- BeanClassLoaderAware
- BeanFactoryAware
- InitializingBean
- DisposableBean

## InitializingBean 的核心作用
当一个 Bean 实现了 InitializingBean 接口后，Spring 容器会在该 Bean 的所有属性都被成功设置（即完成属性注入）之后，自动调用其 afterPropertiesSet() 方法。这一特性使得开发者可以在 Bean 正式投入使用前，进行一些必要的初始化操作，例如数据校验、资源加载、状态初始化等。

## DisposableBean核心作用
DisposableBean 是 Spring 提供的销毁回调接口，其核心作用是在 Bean 即将被容器销毁前，触发自定义的清理操作。
![image](https://blog.meowrain.cn/api/i/2025/07/28/sfkvri.webp)

```java
package com.powercode.spring6.beans;

import org.springframework.beans.BeansException;
import org.springframework.beans.factory.*;

/**
 * @author 动力节点
 * @version 1.0
 * @className User
 * @since 1.0
 **/
public class User implements BeanNameAware, BeanClassLoaderAware, BeanFactoryAware, InitializingBean, DisposableBean {
    private String name;

    public User() {
        System.out.println("1.实例化Bean");
    }

    public void setName(String name) {
        this.name = name;
        System.out.println("2.Bean属性赋值");
    }

    public void initBean(){
        System.out.println("6.初始化Bean");
    }

    public void destroyBean(){
        System.out.println("10.销毁Bean");
    }

    @Override
    public void setBeanClassLoader(ClassLoader classLoader) {
        System.out.println("3.类加载器：" + classLoader);
    }

    @Override
    public void setBeanFactory(BeanFactory beanFactory) throws BeansException {
        System.out.println("3.Bean工厂：" + beanFactory);
    }

    @Override
    public void setBeanName(String name) {
        System.out.println("3.bean名字：" + name);
    }

    @Override
    public void destroy() throws Exception {
        System.out.println("9.DisposableBean destroy");
    }

    @Override
    public void afterPropertiesSet() throws Exception {
        System.out.println("5.afterPropertiesSet执行");
    }
}
```

