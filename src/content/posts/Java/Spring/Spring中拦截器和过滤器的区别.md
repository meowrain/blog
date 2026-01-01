---
title: Spring中拦截器和过滤器的区别
published: 2025-09-22
description: ''
image: ''
tags: [SpringMVC,拦截器,过滤器]
category: 'Java > Spring'
draft: false 
lang: ''
---
https://www.mianshiya.com/question/1907425766060380162#heading-0
![](https://blog.meowrain.cn/api/i/2025/09/22/p1p5sy-1.webp)

# 过滤器
## 实现机制
过滤器是Servlet规范的一部分，独立于Spring存在，主要用于过滤请求和响应，可以对所有类型的请求进行处理。
## 使用范围
可以过滤所有的请求，包括静态资源,jsp,html等，因为它在Servlet容器层面生效。
## 配置方法
需要实现Filter接口，通过标准的Servlet配置方式进行注册： 
https://www.cnblogs.com/xfeiyun/p/15790555.html

https://juejin.cn/post/7000950677409103880

![](https://blog.meowrain.cn/api/i/2025/09/22/nk3hly-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/22/nker0x-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/22/nkq0yb-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/22/nl2e0e-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/22/nq0cv2-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/22/nq24rg-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/22/nq3xj5-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/22/nqp845-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/22/nqzx04-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/22/nr35ne-1.webp)

## 执行顺序
先于拦截器执行，因为过滤器作用于Servlet容器层面，拦截器作用在Spring MVC 的处理器映射器找到控制器前或者后执行。

## 功能侧重
侧重于过滤请求和响应的内容，比如设置编码格式，安全控制等。

# 拦截器
## 实现机制
拦截器是Spring框架的一部分，基于Java的反射机制实现，主要针对的是Handler的调用

## 使用范围
主要用于拦截访问DispathcherServlet的请求，通常只适用于Spring MVC的应用程序中的请求处理方法。


## 配置方式
需要实现org.springframework.web.servlet.HandlerInterceptor接口，并在Spring配置文件中进行注册。
可以通过实现WebMvcConfigurer接口的addInterceptors方法来进行注册。
![](https://blog.meowrain.cn/api/i/2025/09/22/p51up4-1.webp)
```java
package com.example.interceptor;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.ModelAndView;

/**
 * @author wipe
 * @version 1.0
 */

public class MyInterceptor1 implements HandlerInterceptor {

    @Override//目标资源方法执行前执行。 返回true：放行    返回false：不放行
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {

        System.out.println("MyInterceptor1 ... preHandle");
        return true;
    }

    @Override//目标资源方法执行后执行
    public void postHandle(HttpServletRequest request, HttpServletResponse response, Object handler, ModelAndView modelAndView) throws Exception {
        System.out.println("MyInterceptor1 ... postHandle");
    }

    @Override//视图渲染完毕后执行，最后执行
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) throws Exception {
        System.out.println("MyInterceptor1 ... afterCompletion");
    }
}

```
```java
package com.example.config;

import com.example.filter.MyFilter1;
import com.example.filter.MyFilter2;
import com.example.interceptor.MyInterceptor1;
import com.example.interceptor.MyInterceptor2;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
/**
 * @author wipe
 * @version 1.0
 */
@Configuration
public class MyConfig implements WebMvcConfigurer {


    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // 添加拦截器，并指定执行顺序，也可以通过将拦截器声明成 bean 对象，然后通过 @Order 注解或者实现 Order 接口指定执行顺序
        registry.addInterceptor(new MyInterceptor1()).order(1);
        registry.addInterceptor(new MyInterceptor2()).order(2);
    }


    @Bean// 这样配置可以指定过滤器的执行顺序
    public FilterRegistrationBean<MyFilter1> myFilter1() {
        FilterRegistrationBean<MyFilter1> filter = new FilterRegistrationBean<>();
        filter.setFilter(new MyFilter1());
        filter.addUrlPatterns("/*");
        filter.setOrder(1);
        return filter;
    }

    @Bean
    public FilterRegistrationBean<MyFilter2> myFilter2() {
        FilterRegistrationBean<MyFilter2> filter = new FilterRegistrationBean<>();
        filter.setFilter(new MyFilter2());
        filter.addUrlPatterns("/*");
        filter.setOrder(2);
        return filter;
    }
}

```
也可以直接用@Component注册Interceptor
## 执行顺序
可以指定多个拦截器之间的执行顺序，通过实现Ordered接口或者使用@Order注解来控制。

## 功能侧重
侧重于业务逻辑的前置检查，权限验证，日志记录等。
