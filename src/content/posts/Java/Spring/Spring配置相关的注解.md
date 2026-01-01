---
title: Spring配置相关的注解
published: 2025-08-08
description: ''
image: ''
tags: ["Spring","Java"]
category: 'Java > Spring'
draft: false 
lang: ''
---


当然！这是一个非常重要且实用的主题。在 Spring 和 Spring Boot 中，与属性（Property）相关的注解是实现“配置与代码分离”这一核心原则的关键。

我将为你全面、系统地讲解这些注解，从最基础到最常用，再到高级用法，并配上清晰的示例。

我们将主要围绕以下几个核心注解展开：

1.  **`@Value`**: 最基础的，用于注入单个属性值。
2.  **`@PropertySource`**: 用于加载指定的属性文件。
3.  **`@ConfigurationProperties`**: 最强大、最推荐的，用于类型安全地将一组属性绑定到Java对象上。
4.  **`@EnableConfigurationProperties`**: 与 `@ConfigurationProperties` 配合使用，用于激活属性绑定。
5.  **`@TestPropertySource`**: 在测试环境中加载或覆盖属性。

---

### 注解族谱概览

为了方便理解，我们可以把它们分为三类：

*   **值注入 (Value Injection)**: `@Value`
*   **配置源 (Configuration Source)**: `@PropertySource`, `@TestPropertySource`
*   **批量绑定 (Bulk Binding)**: `@ConfigurationProperties`, `@EnableConfigurationProperties`

---

### 1. `@Value`：简单直接的“单兵作战”

这是注入属性最基本的方式。

*   **作用**: 将 Spring 环境（Environment）中的单个属性值注入到类的字段或方法参数中。
*   **语法**: 使用 SpEL (Spring Expression Language) 表达式 `"${property.key}"`。
*   **优点**: 简单、直接，适合注入少量、分散的配置。
*   **缺点**:
    *   当属性很多时，代码会显得分散和混乱。
    *   类型安全性较弱（都是字符串，需要Spring转换）。
    *   重构时（如修改前缀）非常痛苦。

**示例:**

**`src/main/resources/application.properties`**
```properties
app.name=My Awesome App
app.version=2.1.5
app.author.name=Alex
# 如果某个属性可能不存在，可以提供默认值
# mail.default.sender=default@example.com
```

**Java 类**
```java
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class AppInfoService {

    // 注入 app.name 属性
    @Value("${app.name}")
    private String appName;

    // 注入 app.version 属性
    @Value("${app.version}")
    private String appVersion;
  
    // 注入一个不存在的属性，但提供了默认值 "unknown"
    @Value("${app.description:unknown description}")
    private String appDescription;

    // 也可以注入其他 Bean 的属性（使用 SpEL）
    @Value("#{someOtherBean.someProperty}")
    private String otherProperty;

    public void printAppInfo() {
        System.out.println("App Name: " + appName);
        System.out.println("App Version: " + appVersion);
        System.out.println("App Description: " + appDescription);
    }
}
```

---

### 2. `@PropertySource`：指定“情报来源”

默认情况下，Spring Boot 会自动加载 `application.properties` 或 `application.yml`。如果你想加载其他配置文件，就需要用到 `@PropertySource`。

*   **作用**: 将指定的属性文件加载到 Spring 的 `Environment` 中。
*   **使用场景**:
    *   模块化配置，将不同功能的配置放在不同文件里（如 `mail.properties`, `db.properties`）。
    *   加载 classpath 之外的文件系统中的配置。
*   **注意**: 它只负责**加载**，不负责注入。加载后，你可以用 `@Value` 或 `@ConfigurationProperties` 来使用这些属性。

**示例:**

**`src/main/resources/mail.properties`**
```properties
mail.host=smtp.gmail.com
mail.port=587
```

**Java 配置类**
```java
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.PropertySource;
import org.springframework.beans.factory.annotation.Value;

@Configuration
// 加载 classpath 下的 mail.properties 文件
@PropertySource("classpath:mail.properties")
public class MailConfig {

    @Value("${mail.host}")
    private String host;

    @Value("${mail.port}")
    private int port;
  
    // ...
}
```

---

### 3. `@ConfigurationProperties`

这是 Spring Boot **最推荐**的属性管理方式。它将一组相关的属性映射到一个类型安全的 Java 对象（POJO）上。

*   **作用**: 将具有相同前缀的属性批量绑定到一个 POJO 的字段上。
*   **优点**:
    *   **类型安全**: 直接映射到 `int`, `List`, `Duration` 等各种类型。
    *   **结构清晰**: 将相关配置聚合在一个类中，非常易于管理和维护。
    *   **强大的绑定**: 支持复杂的对象图，比如嵌套对象、列表、Map等。
    *   **IDE 友好**: 主流 IDE（如 IntelliJ IDEA）支持对 `application.properties` 中这类属性的自动补全和导航（需要添加 `spring-boot-configuration-processor` 依赖）。

**示例:**

**`application.properties`**
```properties
app.server.name=prod-server
app.server.ip-address=192.168.1.100
app.server.timeout=30s # Spring Boot 2.x 支持时间单位
app.server.admins[0].name=admin1
app.server.admins[0].email=admin1@corp.com
app.server.admins[1].name=admin2
app.server.admins[1].email=admin2@corp.com
```

**Java 属性类 (POJO)**

```java
import org.springframework.boot.context.properties.ConfigurationProperties;
import java.time.Duration;
import java.util.List;

// 告诉 Spring 这个类要绑定前缀为 "app.server" 的属性
@ConfigurationProperties(prefix = "app.server")
public class ServerProperties {

    private String name;
    private String ipAddress;
    private Duration timeout; // 自动将 "30s" 转换为 Duration 对象
    private List<Admin> admins;
  
    // 嵌套类
    public static class Admin {
        private String name;
        private String email;
        // Getters and Setters for Admin
    }

    // ⭐ 重要: 必须为所有字段提供 public Getters and Setters
    // Spring 通过它们来注入值
    // ... Getters and Setters for ServerProperties ...
}
```

---

### 4. `@EnableConfigurationProperties`

`@ConfigurationProperties` 只是一个声明，它本身不会让这个 POJO 成为一个 Spring Bean。你需要一种方式来“激活”它。`@EnableConfigurationProperties` 就是这个开关。

*   **作用**:
    1.  告诉 Spring 去处理被 `@ConfigurationProperties` 注解的类。
    2.  将被注解的类（如 `ServerProperties`）注册到 Spring 容器中，让它成为一个 Bean。这样你就可以在其他地方 `@Autowired` 注入它了。
*   **通常放在哪**: 主启动类或任何 `@Configuration` 类上。

**示例:**

```java
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
// 激活对 ServerProperties 类的绑定，并将其注册为 Bean
@EnableConfigurationProperties(ServerProperties.class)
public class MyApplication {

    public static void main(String[] args) {
        SpringApplication.run(MyApplication.class, args);
    }
}

// 现在可以在任何其他组件中注入它
@Service
public class MyService {
    private final ServerProperties serverProps;

    @Autowired
    public MyService(ServerProperties serverProps) {
        this.serverProps = serverProps;
        System.out.println("Server Name: " + serverProps.getName());
    }
}
```

> **快捷方式**: 如果你在 `ServerProperties` 类上同时加上 `@Component` 和 `@ConfigurationProperties`，就可以省略 `@EnableConfigurationProperties`。但显式使用 `@EnableConfigurationProperties` 通常被认为是更清晰的做法，因为它明确表达了这是一个配置类。

---

### 5. `@TestPropertySource`：为测试“定制情报”

在进行单元测试或集成测试时，我们经常需要使用一套不同于生产环境的配置（比如连接到内存数据库 H2）。

*   **作用**: 在测试上下文中加载属性，它可以覆盖`application.properties`中的属性或添加新属性。
*   **常用属性**:
    *   `locations`: 指定要加载的属性文件路径。
    *   `properties`: 以 `key=value` 形式直接定义内联属性。

**示例:**

```java
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.test.context.TestPropertySource;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
// 1. 加载 test.properties 文件
// 2. 直接定义一个内联属性，它会覆盖 test.properties 或 application.properties 中的同名属性
@TestPropertySource(
    locations = "classpath:test.properties",
    properties = "app.version=test-1.0" 
)
public class AppInfoServiceTest {

    @Autowired
    private Environment env;

    @Test
    void testPropertiesAreLoaded() {
        // 来自 test.properties
        assertThat(env.getProperty("app.name")).isEqualTo("Test App");
      
        // 被内联属性覆盖
        assertThat(env.getProperty("app.version")).isEqualTo("test-1.0");
    }
}
```

---

### 总结与最佳实践

| 注解 | 用途 | 何时使用 |
| :--- | :--- | :--- |
| **`@Value`** | 注入单个值 | 当你只需要一两个简单的配置时。 |
| **`@PropertySource`** | 加载额外的属性文件 | 当你的配置分散在多个自定义文件中时。 |
| **`@ConfigurationProperties`** | **批量**、**类型安全**地绑定属性到对象 | **首选方式**。当你有一组相关配置时（如数据库、邮件、API密钥等）。 |
| **`@EnableConfigurationProperties`** | 激活 `@ConfigurationProperties` 的类 | 总是与 `@ConfigurationProperties` 配合使用（除非用了`@Component`快捷方式）。 |
| **`@TestPropertySource`** | 在测试中覆盖或提供配置 | 编写需要特定配置的集成测试或单元测试时。 |

**最佳实践**:

*   **优先使用 `@ConfigurationProperties`**：对于任何超过两三个的相关配置，都应创建一个专用的 `Properties` 类。这会让你的代码更健壮、更易于维护。
*   **集中管理**: 将 `@EnableConfigurationProperties` 放在主配置类或一个集中的 `AppConfig` 类中，而不是到处分散。
*   **利用元数据**: 添加 `spring-boot-configuration-processor` 依赖到 `pom.xml` 或 `build.gradle`，以获得强大的 IDE 支持。