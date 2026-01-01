---
title: Spring中的BeanFactory与FactoryBean
published: 2025-08-08
description: 深入理解Spring容器的核心接口BeanFactory与特殊工厂Bean——FactoryBean的区别、使用场景与最佳实践
image: ''
tags: [Java, Spring, IoC, DI, BeanFactory, FactoryBean]
category: 'Java > Spring'
draft: false 
lang: zh-CN
---

# BeanFactory
BeanFactory是一个工厂接口，是一个负责生产和管理bean的一个工厂。BeanFactory是工厂的顶层接口，是IOC容器的核心接口，BeanFactory定义了管理Bean的通用方法，如getBean和containsBean等，它的职责包括：
- Bean实例化: 根据XML注解等创建Bean对象。
- 依赖注入： 自动将Bean所需的依赖注入进去。
- 生命周期管理： 管理Bean的初始化，销毁等生命周期方法。
- 延迟加载： 默认采用懒加载策略，只有在调用getBean()时才创建Bean实例。
- Bean获取： 提供getBean()方法来获取Bean实例。

![](https://blog.meowrain.cn/api/i/2025/08/08/fkc5xn-1.webp)

BeanFactory只是一个接口，不是IOC容器的具体实现，所以Spring容器给出了很多种实现，如XmlBeanFactory、AnnotationConfigApplicationContext,ApplicationContext等。

## BeanFactory 的常见实现类

Spring 提供了多种 BeanFactory 的实现，每种实现都有其特定的使用场景：

### DefaultListableBeanFactory
最常用的完整实现，支持完整的Bean生命周期管理：

```java
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import org.springframework.beans.factory.support.RootBeanDefinition;

public class BeanFactoryExample {
    public static void main(String[] args) {
        DefaultListableBeanFactory factory = new DefaultListableBeanFactory();
        
        // 手动注册Bean定义
        RootBeanDefinition beanDefinition = new RootBeanDefinition(MyService.class);
        factory.registerBeanDefinition("myService", beanDefinition);
        
        // 获取Bean
        MyService service = factory.getBean("myService", MyService.class);
        service.doSomething();
    }
}

class MyService {
    public void doSomething() {
        System.out.println("Service is working!");
    }
}
```

### XmlBeanFactory（已废弃）
基于XML配置的BeanFactory实现，Spring 5.x后已废弃，推荐使用ApplicationContext：

```java
// 传统用法（不推荐）
// XmlBeanFactory factory = new XmlBeanFactory(new ClassPathResource("beans.xml"));

// 现代替代方案
import org.springframework.context.support.ClassPathXmlApplicationContext;

ClassPathXmlApplicationContext context = new ClassPathXmlApplicationContext("beans.xml");
MyService service = context.getBean("myService", MyService.class);
```

### StaticListableBeanFactory
静态Bean工厂，适用于Bean集合固定的场景：

```java
import org.springframework.beans.factory.support.StaticListableBeanFactory;

StaticListableBeanFactory factory = new StaticListableBeanFactory();
factory.addBean("myService", new MyService());
factory.addBean("anotherService", new AnotherService());

MyService service = factory.getBean("myService", MyService.class);
```

### ApplicationContext实现类
作为BeanFactory的高级实现，提供更多企业级特性：

```java
// 注解配置
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

AnnotationConfigApplicationContext context = 
    new AnnotationConfigApplicationContext(AppConfig.class);

// XML配置
import org.springframework.context.support.ClassPathXmlApplicationContext;

ClassPathXmlApplicationContext xmlContext = 
    new ClassPathXmlApplicationContext("applicationContext.xml");

// Web环境
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;

AnnotationConfigWebApplicationContext webContext = 
    new AnnotationConfigWebApplicationContext();
webContext.register(WebConfig.class);
```

### 实际应用示例
结合Bean定义构建器的完整示例：

```java
import org.springframework.beans.factory.support.BeanDefinitionBuilder;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;

public class CustomBeanFactoryDemo {
    public static void main(String[] args) {
        DefaultListableBeanFactory factory = new DefaultListableBeanFactory();
        
        // 使用BeanDefinitionBuilder构建复杂Bean
        BeanDefinitionBuilder builder = BeanDefinitionBuilder
            .rootBeanDefinition(DatabaseService.class)
            .addPropertyValue("url", "jdbc:mysql://localhost:3306/mydb")
            .addPropertyValue("username", "root")
            .setScope("singleton")
            .setLazyInit(true);
            
        factory.registerBeanDefinition("dbService", builder.getBeanDefinition());
        
        // 懒加载验证
        System.out.println("Bean定义已注册，但未实例化");
        
        DatabaseService dbService = factory.getBean("dbService", DatabaseService.class);
        System.out.println("现在Bean被实例化了");
    }
}

class DatabaseService {
    private String url;
    private String username;
    
    // getters and setters
    public void setUrl(String url) { this.url = url; }
    public void setUsername(String username) { this.username = username; }
    
    public void connect() {
        System.out.println("连接到: " + url + " 用户: " + username);
    }
}
```


## BeanFactory 与 ApplicationContext 的区别
- 预实例化策略
  - BeanFactory：单例默认懒加载。
  - ApplicationContext：默认预实例化单例（提高启动后首次访问的吞吐）。
- 扩展能力
  - ApplicationContext 额外提供国际化、事件发布、AOP自动代理、资源模式解析等企业特性。
- 适用场景
  - BeanFactory：资源受限、极致冷启动、强控制懒加载/条件加载。
  - ApplicationContext：大多数应用优先选择。
- 调优提示
  - 需要懒加载时，可结合ApplicationContext + @Lazy 或者使用ObjectProvider/Provider按需获取。

# FactoryBean
在Spring中，所有的Bean都是由BeanFactory管理的（IOC容器），
这个FactoryBean不是简单的Bean，而是一个能生产或者修饰对象生成的工厂Bean，它的实现与设计模式中的工厂模式和修饰器模式类似。


## FactoryBean 的作用

![](https://blog.meowrain.cn/api/i/2025/08/08/gzh7kd-1.webp)

- 将“复杂对象的创建逻辑”封装到工厂Bean中，对外暴露的是“产品对象”而不是工厂本身。
- 常用于：动态代理（AOP/远程代理）、框架桥接（如MyBatis的SqlSessionFactoryBean）、复杂构建（连接池、客户端SDK）。

## 核心接口方法
- getObject(): 返回实际产品对象（对外暴露的Bean）。
- getObjectType(): 返回产品类型，便于类型匹配与自动装配。
- isSingleton(): 决定产品是否为单例（影响缓存与生命周期）。

## 获取“产品”还是“工厂本身”
- 普通名：context.getBean("beanName") 获取的是产品对象（getObject返回值）。
- 带&前缀：context.getBean("&beanName") 获取的是FactoryBean自身。
- 命名规则：注册名为 x 的 FactoryBean，会对外暴露“产品”名为 x，“工厂自身”为 &x。

## 最小可运行示例
```java
// 一个业务产品
public class ApiClient {
  private final String endpoint;
  public ApiClient(String endpoint) { this.endpoint = endpoint; }
  public String call(String path) { return "GET " + endpoint + path; }
}

// FactoryBean 实现
import org.springframework.beans.factory.FactoryBean;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.util.Assert;

public class ApiClientFactoryBean implements FactoryBean<ApiClient>, InitializingBean {
  private String endpoint;
  public void setEndpoint(String endpoint) { this.endpoint = endpoint; }

  @Override
  public ApiClient getObject() {
    // 可在此放入复杂构建/代理/缓存等逻辑
    return new ApiClient(endpoint);
  }

  @Override
  public Class<?> getObjectType() { return ApiClient.class; }

  @Override
  public boolean isSingleton() { return true; }

  @Override
  public void afterPropertiesSet() {
    Assert.hasText(endpoint, "endpoint must not be empty");
  }
}

// Java 配置注册 FactoryBean
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AppConfig {
  @Bean(name = "apiClient")
  public ApiClientFactoryBean apiClientFactoryBean() {
    ApiClientFactoryBean fb = new ApiClientFactoryBean();
    fb.setEndpoint("https://api.example.com");
    return fb;
  }
}

// 取产品与取工厂本身
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

public class Demo {
  public static void main(String[] args) {
    ApplicationContext ctx = new AnnotationConfigApplicationContext(AppConfig.class);
    ApiClient client = ctx.getBean("apiClient", ApiClient.class);     // 产品
    ApiClientFactoryBean fb = ctx.getBean("&apiClient", ApiClientFactoryBean.class); // 工厂本身
    System.out.println(client.call("/ping"));
  }
}
```

## 常见坑与最佳实践
- getObjectType 切勿返回 null：尽量返回接口/具体类型，便于按类型注入与AOT分析。
- isSingleton 与产品生命周期：单例将被容器缓存；非单例每次getBean都会重新创建产品。
- 懒加载与预实例化：在ApplicationContext中，如希望延迟创建可使用@Lazy或将FactoryBean产品设为非单例。
- 自动装配歧义：按类型注入时，注入到的是产品类型而非FactoryBean；需要注入工厂本身时使用@Qualifier("&name")或@Resource(name="&name")。
- 原型产品与循环依赖：原型产品不参与循环依赖的三级缓存提前暴露，避免在原型链路中引入循环依赖。
- 命名规范：确保文档/注释标明“&”语义，避免团队误用。

## 什么时候用哪一个？
- 仅需容器功能：优先ApplicationContext（功能更全，默认预实例化）。
- 需要懒加载到极致：考虑BeanFactory或在ApplicationContext中对关键Bean标注@Lazy。
- 对象构建复杂/需代理/外部SDK桥接：使用FactoryBean封装构建细节，对外仅暴露产品。

## 小结
- BeanFactory 是IoC容器的最小抽象；ApplicationContext在其上增强了企业级特性。
- FactoryBean 是“创建Bean的Bean”，对外暴露产品；使用“&name”获取工厂本身。
- 合理利用FactoryBean可显著简化复杂对象创建，并保持应用装配的清晰与解耦。