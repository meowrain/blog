---
title: redis配置json序列化
published: 2025-08-08
description: ''
image: 'https://blog.meowrain.cn/api/i/2025/07/19/p9zr81-1.webp'
tags: [Redis, 中间件, Redis数据类型]
category: '中间件 > Redis'
draft: false 
lang: ''
---

# Redis配置序列化
序列化的最终目的是为了对象可以跨平台存储，进行网络传输。
Redis默认用的是JdkSerializationRedisSerializer，它使用JDK提供的序列化功能，优点是反序列化的时候不需要提供类型信息，但缺点是序列化后的数据体积较大，性能较低。
因此，通常会使用更高效的序列化方式，如JSON、Protobuf等

Jackson2JsonRedisSerializer： 使用Jackson库将对象序列化为JSON字符串。
优点是速度快，序列化后的字符串短小精悍，不需要实现Serializable接口。

但缺点也非常致命，那就是此类的构造函数中有一个类型参数，必须提供要序列化对象的类型信息(.class对象)。 通过查看源代码，发现其只在反序列化过程中用到了类型信息。

现在的问题是： 如果使用默认的JDK序列化方式，在Redis可视化工具中查看kv值的时候会出现乱码，而使用Jackson2JsonRedisSerializer序列化后，kv值在Redis可视化工具中查看时是正常的。


StringRedisTemplate → Key 和 Value 都是 String 序列化，简单粗暴，适合存验证码、token、计数器、纯 JSON 文本之类的轻量数据。

自定义 RedisTemplate<String, Object> → 用了 JSON 序列化器，直接存 Java 对象，取出来就能反序列化成原类型，适合缓存业务对象、集合、复杂结构等。


# 配置
```java

package org.example.config;


import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.PropertyAccessor;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.StringRedisSerializer;

@Configuration
public class MyRedisConfig {

    /**
     * RedisTemplate 配置类
     * - 使用自定义的 ObjectMapper + GenericJackson2JsonRedisSerializer
     * - 实现 key 用字符串序列化，value 用 JSON 序列化
     */
    @Bean
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory factory) {
        // 创建 RedisTemplate，指定 key 类型为 String，value 类型为 Object
        RedisTemplate<String, Object> template = new RedisTemplate<>();

        // 设置 Redis 连接工厂（由 Spring Boot 配置的连接信息决定）
        template.setConnectionFactory(factory);

        // 创建并配置 Jackson 的 ObjectMapper（用于 JSON 序列化/反序列化）
        ObjectMapper mapper = new ObjectMapper();

        // 设置可见性：让所有字段（包括 private）都参与序列化和反序列化
        mapper.setVisibility(PropertyAccessor.ALL, JsonAutoDetect.Visibility.ANY);

        // 启用默认类型信息（多态类型序列化）
        // NON_FINAL 表示对所有非 final 类（如普通类、接口实现类）写入类型信息
        // 好处：反序列化时可以还原原始对象类型（避免反成 LinkedHashMap）
        mapper.activateDefaultTyping(
                mapper.getPolymorphicTypeValidator(), // 类型验证器，防止反序列化攻击
                ObjectMapper.DefaultTyping.NON_FINAL  // 应用于所有非 final 的类
        );

        // 创建 JSON 序列化器，并注入自定义的 ObjectMapper
        GenericJackson2JsonRedisSerializer serializer =
                new GenericJackson2JsonRedisSerializer(mapper);

        // key 采用字符串序列化器，保证可读性（在 Redis CLI 中能直接看到）
        template.setKeySerializer(new StringRedisSerializer());
        // value 采用 JSON 序列化器，支持存储任意对象
        template.setValueSerializer(serializer);

        // hash 结构的 key 也用字符串序列化
        template.setHashKeySerializer(new StringRedisSerializer());
        // hash 结构的 value 也用 JSON 序列化
        template.setHashValueSerializer(serializer);

        // 初始化 RedisTemplate 的配置
        template.afterPropertiesSet();

        return template;
    }

}
```

> 什么是反序列化攻击？
反序列化攻击是指攻击者通过构造恶意的序列化数据，利用应用程序在反序列化过程中执行不安全的代码或操作，从而导致安全漏洞。攻击者可以通过发送特制的序列化数据包，触发应用程序执行未授权的操作、获取敏感信息或执行任意代码。
 

 # 使用
```java
package org.example;

import org.example.entity.Human;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ApplicationContext;
import org.springframework.data.redis.core.RedisTemplate;

@SpringBootApplication
public class Main {
    public static void main(String[] args) {
        ApplicationContext ctx = new SpringApplicationBuilder(Main.class)
                .web(WebApplicationType.NONE) // 不启动 Tomcat
                .run(args);

        // 按名字拿，避免和 stringRedisTemplate 冲突
        RedisTemplate<String, Object> redisTemplate =
                (RedisTemplate<String, Object>) ctx.getBean("redisTemplate");

        // 打印一下序列化器，确认确实是你配置的
        System.out.println("KeySerializer   = " + redisTemplate.getKeySerializer().getClass().getName());
        System.out.println("ValueSerializer = " + redisTemplate.getValueSerializer().getClass().getName());

        String key = "test:human:" + System.currentTimeMillis();
        Human h = new Human("jackv", "dfasdfssfsdf");

        redisTemplate.opsForValue().set(key, h);
        Object v = redisTemplate.opsForValue().get(key);

        System.out.println("Fetched value class = " + (v == null ? "null" : v.getClass().getName()));
        System.out.println("Fetched value       = " + v);

        // 简单校验：能拿回对象、类型是你期望的
        if (!(v instanceof Human)) {
            throw new IllegalStateException("不是 Human，而是：" + (v == null ? "null" : v.getClass()));
        }
        // 可选：清理
        redisTemplate.delete(key);

        System.out.println("OK, JSON 序列化/反序列化正常。");
    }
}

```

在其他类的时候直接@Autowired注入RedisTemplate即可使用。

```java
@Autowired
@Qualifier("redisTemplate")
private RedisTemplate<String, Object> redisTemplate;
```