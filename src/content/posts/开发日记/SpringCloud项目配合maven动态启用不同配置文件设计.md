---
title: 开发日记/SpringCloud项目配合maven动态启用不同配置文件设计
published: 2026-01-11T12:53:19
description: ''
image: ''

draft: false 
lang: ''
category: '开发日记'
---

## 背景

在多模块（父工程 + 多个子模块）的 SpringCloud / SpringBoot 项目里，我们通常会有多套环境配置（dev/test/prod），比如：

- 数据库、Redis、MQ 地址不同
- Nacos / Config Server 的命名空间、group 不同
- 日志级别、监控开关不同

问题在于：**子模块是可独立启动的**，但它们的配置又希望能跟随父模块选择的 Maven Profile 自动切换，而不是每次都手动改 `application.yml` 或 IDE 的 VM Options。

## 目标

- 用 Maven Profile 统一管理环境（dev/test/prod），**一处配置，多模块复用**
- 打包时根据 `-Pdev/-Pprod` 自动写入激活的 Spring Profile
- 子模块的 `application.yml` 不硬编码环境，而是“动态注入”
- 本地运行、CI 打包、Docker 部署都能保持同一套切换逻辑

## 思路总览（核心点）

1. **父模块（parent/pom.xml）用 `<profiles>` 维护环境变量**，比如 `profile.active=dev`、`config.server.url=...`
2. **子模块开启资源过滤（resource filtering）**，让 `application.yml` 支持占位符替换
3. `application.yml` 用占位符写 `spring.profiles.active`，让它随 Maven Profile 注入（例如 `@profile.active@`）
4. 运行 / 打包时只需要切换 Maven Profile：`mvn -Pdev package`、`mvn -Pprod package`

下面重点讲两件事：**父模块 profiles 怎么写**，以及 **子模块 application.yml 怎么实现动态配置**。

## 父模块：Maven Profiles 统一管理环境

在父模块 `pom.xml` 中定义环境 Profile（dev/test/prod），每个 profile 只负责两类事情：

- 提供“环境变量”（properties）
- 参与资源过滤（让子模块能读到这些变量）

示例（父模块 `pom.xml`，只保留关键段落）：

```xml
<project>
  <modelVersion>4.0.0</modelVersion>
  <packaging>pom</packaging>

  <properties>
    <maven.resources.filtered>true</maven.resources.filtered>
    <profile.active>dev</profile.active>
  </properties>

  <profiles>
    <profile>
      <id>dev</id>
      <properties>
        <profile.active>dev</profile.active>
        <config.server.url>http://127.0.0.1:8888</config.server.url>
      </properties>
    </profile>

    <profile>
      <id>test</id>
      <properties>
        <profile.active>test</profile.active>
        <config.server.url>http://test-config:8888</config.server.url>
      </properties>
    </profile>

    <profile>
      <id>prod</id>
      <properties>
        <profile.active>prod</profile.active>
        <config.server.url>http://prod-config:8888</config.server.url>
      </properties>
    </profile>
  </profiles>
</project>
```

### 为什么把 Profile 写在父模块

- 多模块下每个子模块都依赖 parent，**配置天然继承**
- 切换环境只需控制父模块 profile，CI/CD 更好统一
- 对团队协作友好：大家不需要各自维护一份“本地 dev 配置”

### 使用方式（命令）

```bash
# dev 打包
mvn -Pdev clean package

# prod 打包
mvn -Pprod clean package
```

在 IDE（例如 IntelliJ IDEA）里，也可以在 Maven 面板里勾选对应 profile，然后运行子模块的启动类即可（前提是子模块启用了资源过滤，后面会讲）。

## 子模块：application.yml 如何实现动态配置

核心就是一句话：**让 `application.yml` 里的值由 Maven 过滤替换**。

### 1）子模块开启资源过滤（resource filtering）

在子模块（或统一放在父模块的 `<build><pluginManagement>` 里让子模块继承）配置 resources 过滤。

以子模块 `pom.xml` 为例（关键段落）：

```xml
<build>
  <resources>
    <resource>
      <directory>src/main/resources</directory>
      <filtering>true</filtering>
    </resource>
  </resources>
</build>
```

这样 Maven 在 `process-resources` 阶段会对 `src/main/resources` 下的文件做占位符替换。

### 2）在 application.yml 里引用父模块 Profile 变量

在子模块 `src/main/resources/application.yml` 里写：

```yaml
spring:
  profiles:
    active: "@profile.active@"

app:
  config-server-url: "@config.server.url@"
```

这里用的是 Maven 的 `@...@` 占位符格式（它比 `${...}` 在 YAML 中更不容易和 Spring 本身的占位符混淆）。

当你执行：

```bash
mvn -Pprod clean package
```

打包后的 `target/classes/application.yml` 会变成：

```yaml
spring:
  profiles:
    active: "prod"

app:
  config-server-url: "http://prod-config:8888"
```

### 3）配合多套配置文件：application-{profile}.yml

建议把“环境差异”尽量放到 `application-dev.yml` / `application-prod.yml` 中，让 `application.yml` 只负责“选择环境”与公共配置。

结构示例：

```text
src/main/resources/
  application.yml
  application-dev.yml
  application-test.yml
  application-prod.yml
```

`application.yml`（只写公共 + 激活环境）：

```yaml
spring:
  profiles:
    active: "@profile.active@"

server:
  port: 8080
```

`application-dev.yml`（写 dev 差异）：

```yaml
spring:
  datasource:
    url: jdbc:mysql://127.0.0.1:3306/app_dev
```

`application-prod.yml`（写 prod 差异）：

```yaml
spring:
  datasource:
    url: jdbc:mysql://prod-db:3306/app_prod
```

这样一来：**父模块 Maven Profile 决定 `spring.profiles.active`**，SpringBoot 再根据 active profile 自动加载对应的 `application-{profile}.yml`。

## 常见坑与建议

### 1）本地直接运行为什么不生效

`@profile.active@` 只会在 **Maven 资源处理** 时被替换。

如果你直接用 IDE “运行启动类”，但没有触发 Maven 的 `process-resources`，就会出现占位符未替换的情况。

推荐做法：

- 在 IDE 使用 Maven Profile，并确保运行前执行了 `process-resources`（常见方式是先 `mvn -Pdev -DskipTests package` 一次）
- 或者在 Run Configuration 里临时加 `-Dspring.profiles.active=dev`（但这会绕过“父模块统一管理”，不建议作为团队默认方案）

### 2）过滤导致 application.yml 被破坏

如果你在 `application.yml` 里本身也使用 `${...}`（比如 Spring 的占位符），Maven 过滤可能会误处理。

建议：

- 用 `@...@` 作为 Maven 注入占位符
- Spring 自己的占位符继续用 `${...}`，避免混用

### 3）CI/CD 建议

CI 里只需要：

```bash
mvn -Pprod clean package -DskipTests
```

产物里 profile 已经写死为 prod，运行时不需要额外设置。

如果你希望“同一包多环境运行”，那就不要在构建期写死 `spring.profiles.active`，改为运行期用环境变量/启动参数控制（这是另一条路线，和本文目标不同）。

## 小结

- 父模块 `<profiles>` 用来统一维护环境变量（重点：`profile.active`）
- 子模块开启资源过滤，让 `application.yml` 能读取父模块的变量
- `application.yml` 用 `spring.profiles.active: "@profile.active@"` 达到“动态切换配置”的效果
