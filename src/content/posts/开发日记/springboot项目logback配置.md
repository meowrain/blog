---
title: 开发日记/springboot项目logback配置
published: 2026-01-18T19:24:15
description: ''
image: 'https://blog.meowrain.cn/api/i/2026/01/18/vuaftq-1.webp'

draft: false 
lang: ''
category: '开发日记'
tags:
  - 'springboot'
  - 'logback'
---

# 文件内容 可通用
可以直接复制到项目的 `src/main/resources/logback-spring.xml` 文件中。

![](https://blog.meowrain.cn/api/i/2026/01/18/vuaftq-1.webp)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!--debug="false" 表示关闭 Logback 框架自身的内部状态信息打印。-->
<configuration scan="true" scanPeriod="10 seconds" debug="false">
    <!--    引入 spring boot 默认日志颜色和基础配置-->
    <include resource="org/springframework/boot/logging/logback/defaults.xml"/>
    <!--    定义变量 APP_NAME，从 Spring 环境变量中获取 spring.application.name 的值-->
    <springProperty scope="context" name="APP_NAME" source="spring.application.name"/>

<!--    定义时间格式，yyyy-MM 表示年-月，yyyy-MM-dd 表示年-月-日-->
    <timestamp key="time-month" datePattern="yyyy-MM"/>
    <timestamp key="time-month-day" datePattern="yyyy-MM-dd"/>
    <!--    定义变量 LOG_FILE_PATH，默认值为 ./logs/${APP_NAME}，可以通过环境变量 LOG_PATH 覆盖 日志存储路径-->
    <property name="LOG_FILE_PATH" value="${LOG_PATH:-./logs/${APP_NAME}}"/>
    <!--    定义日志格式
    格式说明：
    %d{yyyy-MM-dd HH:mm:ss.SSS}：日志记录时间，格式为年-月-日 时:分:秒.毫秒
    [%thread]：日志记录线程名称
    %-5level：日志级别，左对齐，占用 5 个字符宽度
    %logger{50}：日志记录器名称，最多显示 50 个字符
    -[%X{traceId:-}]：从 MDC 中获取 traceId 变量值，如果不存在则显示为空
    %msg%n：日志消息内容，换行符
    -->
    <property name="FILE_LOG_PATTERN"
              value="%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] %-5level %logger{50} -[%X{traceId:-}] %msg%n"/>

    <!--    appender 控制台输出-->
    <!--
    <appender>: 这是 Logback 配置的根标签之一，用于定义一个日志输出目的地。
    name="CONSOLE": 为这个 Appender 赋予一个唯一的名称，方便在 <root> 或 <logger> 标签中引用它。
    class="ch.qos.logback.core.ConsoleAppender": 指定使用的实现类。
    ConsoleAppender 是 Logback 库中专门用于将日志事件写入 System.out (标准输出) 或 System.err (标准错误) 的类。
    这是我们在本地开发和测试时最常用的 Appender。
    CONSOLE_LOG_PATTERN 是上面include的默认日志格式，这里直接引用即可
    -->
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>${CONSOLE_LOG_PATTERN}</pattern>
            <charset>UTF-8</charset>
        </encoder>
    </appender>

    <!--    全量info日志-->
    <appender name="INFO_FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
        <file>${LOG_FILE_PATH}/${time-month}/${time-month-day}/info.log</file>
        <rollingPolicy class="ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy">
            <fileNamePattern>${LOG_FILE_PATH}/${time-month}/${time-month-day}/info.%d{yyyy-MM-dd}.%i.log.gz</fileNamePattern>
            <maxFileSize>100MB</maxFileSize>
            <maxHistory>31</maxHistory>
            <totalSizeCap>100GB</totalSizeCap>
        </rollingPolicy>
        <encoder>
            <pattern>${FILE_LOG_PATTERN}</pattern>
            <charset>UTF-8</charset>
        </encoder>
        <filter class="ch.qos.logback.classic.filter.ThresholdFilter">
            <!-- 只记录 INFO 级别以及以上的日志的日志 -->
            <level>INFO</level>
        </filter>
    </appender>
    <appender name="ERROR_FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
        <file>${LOG_FILE_PATH}/${time-month}/${time-month-day}/error.log</file>
        <rollingPolicy class="ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy">
            <fileNamePattern>${LOG_FILE_PATH}/${time-month}/${time-month-day}/error.%d{yyyy-MM-dd}.%i.log.gz</fileNamePattern>
            <maxFileSize>100MB</maxFileSize>
            <maxHistory>31</maxHistory>
            <totalSizeCap>100GB</totalSizeCap>
        </rollingPolicy>
        <encoder>
            <pattern>${FILE_LOG_PATTERN}</pattern>
            <charset>UTF-8</charset>
        </encoder>
        <filter class="ch.qos.logback.classic.filter.LevelFilter">
            <!-- 只记录 ERROR 级别以及以上的日志的日志 -->
            <level>ERROR</level>
            <onMatch>ACCEPT</onMatch>
            <onMismatch>DENY</onMismatch>
        </filter>
    </appender>

    <!--    异步写入日志-->
    <appender name="ASYNC_INFO"
              class="ch.qos.logback.classic.AsyncAppender">
        <discardingThreshold>0</discardingThreshold>
        <queueSize>512</queueSize>
        <appender-ref ref="INFO_FILE"/>
    </appender>
    <appender name="ASYNC_ERROR" class="ch.qos.logback.classic.AsyncAppender">
        <discardingThreshold>0</discardingThreshold>
        <queueSize>512</queueSize>
        <appender-ref ref="ERROR_FILE"/>
    </appender>


    <!--    =========== 环境配置 打印到控制台 ===========-->
    <springProfile name="dev">
        <root level="INFO">
            <appender-ref ref="CONSOLE"/>
            <appender-ref ref="ASYNC_ERROR"/>
            <appender-ref ref="ASYNC_INFO"/>
        </root>
    </springProfile>

    <springProfile name="prod">
        <root level="INFO">
            <appender-ref ref="CONSOLE"/>
            <appender-ref ref="ASYNC_ERROR"/>
            <appender-ref ref="ASYNC_INFO"/>
        </root>
    </springProfile>
</configuration>
```

## 配置详解

### 1. 根节点配置 (`<configuration>`)

```xml
<configuration scan="true" scanPeriod="10 seconds" debug="false">
```

*   **scan="true"**: 配置文件如果发生改变，将会被重新加载。
*   **scanPeriod="10 seconds"**: 监测配置文件是否有修改的时间间隔，默认单位是毫秒。
*   **debug="false"**: 关闭 Logback 框架自身的内部状态信息打印，设置为 `true` 时可以在控制台看到 Logback 的加载过程，有助于排查 Logback 配置错误。

### 2. 基础引用与变量定义

#### 引入 Spring Boot 默认配置
```xml
<include resource="org/springframework/boot/logging/logback/defaults.xml"/>
```
这行代码引入了 Spring Boot 预定义的日志配置，包含了控制台输出的彩色日志格式 `CONSOLE_LOG_PATTERN` 等常用变量。

#### 获取 Spring 配置属性
```xml
<springProperty scope="context" name="APP_NAME" source="spring.application.name"/>
```
*   `<springProperty>`: 允许从 Spring 的 `Environment` 中读取属性并暴露给 Logback。
*   这里读取了 `spring.application.name`（应用名称）赋值给变量 `APP_NAME`，用于后续生成日志文件路径。

#### 定义时间戳变量
```xml
<timestamp key="time-month" datePattern="yyyy-MM"/>
<timestamp key="time-month-day" datePattern="yyyy-MM-dd"/>
```
定义了两个时间戳变量，用于构建按月或按天归档的目录结构。

#### 定义日志路径
```xml
<property name="LOG_FILE_PATH" value="${LOG_PATH:-./logs/${APP_NAME}}"/>
```
*   `${LOG_PATH:-./logs/${APP_NAME}}`: 这是一个默认值语法。如果环境变量 `LOG_PATH` 存在，则使用它；否则使用 `./logs/${APP_NAME}`。

### 3. 日志格式 (`FILE_LOG_PATTERN`)

```xml
<property name="FILE_LOG_PATTERN"
          value="%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] %-5level %logger{50} -[%X{traceId:-}] %msg%n"/>
```
*   `%d`: 日期时间。
*   `[%thread]`: 线程名。
*   `%-5level`: 日志级别（左对齐，5字符宽）。
*   `%logger{50}`: 类名（最大长度50，超长会智能缩写）。
*   `[%X{traceId:-}]`: 这是一个 MDC (Mapped Diagnostic Context) 变量。用于分布式链路追踪，如果 MDC 中有 `traceId` 则显示，否则显示 `-`。
*   `%msg`: 日志具体内容。
*   `%n`: 换行。

### 4. 输出源 (Appenders)

#### 控制台输出 (`CONSOLE`)
使用 `ConsoleAppender` 将日志输出到标准输出，并直接复用了 Spring Boot 默认的 `CONSOLE_LOG_PATTERN`。

#### 滚动文件输出 (`INFO_FILE` / `ERROR_FILE`)
使用 `RollingFileAppender` 实现日志文件的滚动策略。

*   **滚动策略 (`SizeAndTimeBasedRollingPolicy`)**:
    *   **按时间滚动**: 每天生成一个新的日志文件 (`%d{yyyy-MM-dd}`).
    *   **按大小滚动**: 如果单天日志超过 `100MB` (`%i`)，会切分出新文件。
    *   **历史保留**: `<maxHistory>31</maxHistory>` 保留最近 31 天的日志。
    *   **总大小限制**: `<totalSizeCap>100GB</totalSizeCap>` 限制所有日志文件总大小不超过 100GB。

*   **过滤器 (Filter)**:
    *   `INFO_FILE` 使用 `ThresholdFilter`: 记录 `INFO` 及以上级别（INFO, WARN, ERROR）。
    *   `ERROR_FILE` 使用 `LevelFilter`: **只**记录 `ERROR` 级别。
        *   `onMatch=ACCEPT`: 匹配 ERROR 则记录。
        *   `onMismatch=DENY`: 不匹配则丢弃。

### 5. 异步处理 (`AsyncAppender`)

```xml
<appender name="ASYNC_INFO" class="ch.qos.logback.classic.AsyncAppender">
    <discardingThreshold>0</discardingThreshold>
    <queueSize>512</queueSize>
    <appender-ref ref="INFO_FILE"/>
</appender>
```
*   **作用**: 将日志写入操作放入独立线程执行，避免高并发下 IO 操作阻塞业务线程，提高应用性能。
*   **queueSize**: 异步队列深度，默认为 256，这里调整为 512。
*   **discardingThreshold**: 默认为队列剩余 20% 容量时丢弃 TRACE/DEBUG/INFO 日志。设置为 `0` 表示**不丢弃任何日志**，即使队列满了也阻塞等待，保证日志不丢失。

### 6. 环境隔离 (`<springProfile>`)

```xml
<springProfile name="dev"> ... </springProfile>
<springProfile name="prod"> ... </springProfile>
```
Logback 支持 Spring 的 Profile 功能。
*   当 `spring.profiles.active=dev` 时，激活 dev 块内的配置。
*   当 `spring.profiles.active=prod` 时，激活 prod 块内的配置。

当前配置中，`dev` 和 `prod` 都输出了 `CONSOLE`、`ASYNC_ERROR` 和 `ASYNC_INFO`，在实际生产环境中，通常会移除 `CONSOLE` Appender 以减少不必要的控制台输出性能损耗。
