---
title: Cookie和Session的区别
published: 2025-09-21
description: ''
image: ''
tags: [Cookie,Session]
category: '工作'
draft: false 
lang: ''
---

# Cookie
Cookie是存储在用户浏览器端的一个小型数据文件，用于跟踪和保护用户的状态信息。
主要用于保持用户的登录状态，跟踪用户行为，存储用户偏好等。

**是存储在浏览器的**

## 为什么需要Cookie
HTTP协议是无状态的，意味着每次请求都是独立的，服务器不会记住用户之前的行为。

用户登录后，服务器无法知道后续请求是否来自同一个用户。

就像你登录了一个电商网站（如淘宝），假如 HTTP是无状态的，那么你每次刷新页面或跳转到其他页面时，系统都会提示“请重新登录”，这是因为服务器无法记住你之前的登录状态。
而通过Cookie，服务器在用户登录成功后设置一个标识。浏览器会将这个标识保存下来，并在后续请求中自动附加到请求头中，服务器通过解析这个标识就能知道用户已登录。



浏览器在每次HTTP请求中，自动携带Cookie信息，服务器通过解析这些信息识别用户身份。虽然HTTP协议本身无状态，但通过Cookie的“附加行为”，实现了有状态的交互。
## 如何设置Cookie
### SpringBoot 
#### 在 Controller 中设置 Cookie
```java
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class CookieController {

    @GetMapping("/set-cookie")
    public String setCookie(HttpServletResponse response) {
        Cookie cookie = new Cookie("token", "abc123");
        cookie.setPath("/");          // 设置路径（整个项目可用）
        cookie.setMaxAge(60 * 60);    // 有效期 1 小时
        cookie.setHttpOnly(true);     // 防止 JS 读取，提升安全性
        cookie.setSecure(false);      // true 代表仅 https 传输
        response.addCookie(cookie);   // 写入响应头

        return "Cookie 已设置！";
    }
}

```
#### 在 Response Header 中手动写入 Cookie
有时需要更细控制，可以直接操作 Set-Cookie 响应头：
```java
@GetMapping("/set-cookie-header")
public String setCookieHeader(HttpServletResponse response) {
    response.addHeader("Set-Cookie", "sessionId=xyz789; Path=/; HttpOnly; Max-Age=3600");
    return "Header Cookie 已设置！";
}

```
#### 读取 Cookie
使用 @CookieValue：
```java
@GetMapping("/get-cookie")
public String getCookie(@CookieValue(value = "token", defaultValue = "null") String token) {
    return "当前 token = " + token;
}
```

```java
@GetMapping("/get-cookie2")
public String getCookie2(HttpServletRequest request) {
    Cookie[] cookies = request.getCookies();
    if (cookies != null) {
        for (Cookie c : cookies) {
            if ("token".equals(c.getName())) {
                return "找到 token: " + c.getValue();
            }
        }
    }
    return "未找到 token";
}

```
### Cookie组成
用户可通过 f12打开控制台，然后应用->Cookie->找到当前地址，就能看到当前的Cookie 信息。

![](https://blog.meowrain.cn/api/i/2025/09/21/xev89u-1.webp)

- `key=value`: 核心数据
- `Set-Cookie`字段： 服务器通过这个字段定义Cookie的内容
- `Path=/`： 指定Cookie的而作用路径（/表示所有路径均可访问）
- `HttpOnly`: 防止JavaScript 访问Cookie（提高安全性）
- `Secure`: 要求Cookie仅能通过HTTPS传输
- `Max-Age`: 设置Cookie在多久后过期
-  `Expires`： 设置Cookie在指定时间过期
- `Domain`： 作用域，指定Cookie所属的域名，允许跨子域名共享

**Max-Age** 和**Expires**是设置Cookie过期时间的两种方式。
![](https://blog.meowrain.cn/api/i/2025/09/21/x7ivoo-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/21/x7kr9o-1.webp)

---

![](https://blog.meowrain.cn/api/i/2025/09/21/xfy5w7-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/21/xfwwfm-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/21/xfutn8-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/21/xg132o-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/21/xg1u42-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/21/xg3flm-1.webp)

## Cookie按照生命周期分为两种
会话期cookie是最简单的cookie：浏览器关闭后会被自动删除。会话期cookie不需要指定过期时间（Expires）或者有效期（Max-Age)。需要注意的是，有些浏览器提供了会话恢复功能，这种情况即使关闭了浏览器，会话期cookie也会被保留下来，这会导致cookie的生命周期无限期延长
持久性cookie的生命周期取决于过期时间（Expires）或者有效期（Max-Age）指定的一段时间。
当Cookie的过期时间被设定时，设定的日期和时间只与客户端相关，而不是服务端。

![](https://blog.meowrain.cn/api/i/2025/09/21/x6dk9p-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/21/x6ftip-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/21/x6htww-1.webp)

## Cookie过期时间配置
**Max-Age** 和**Expires**是设置Cookie过期时间的两种方式。
![](https://blog.meowrain.cn/api/i/2025/09/21/x7ivoo-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/21/x7kr9o-1.webp)

> 两者都用于设置“持久级 Cookie”（会话级 Cookie 不设置它们） 
> 同时存在时，Max-Age 优先

## Cookie大小限制
- 单个Cookie最大约为4KB
## Cookie数量限制
浏览器对同一域名的Cookie数量有限制（如Chrome为200个）
## 安全建议：
永远不要在Cookie中存储敏感信息（如密码），改用Token或Session ID。
始终启用HttpOnly和Secure，防止XSS和中间人攻击。
## Cookie优缺点和注意事项
![](https://blog.meowrain.cn/api/i/2025/09/21/xhd3rc-1.webp)
# Session
session是另一种记录客户状态的机制，不同的是Cookie保存在客户端浏览器中，而session保存在服务器上,客户端浏览器访问服务器的时候，服务器把客户端信息以某种形式记录在服务器上，这就是session。客户端浏览器再次访问时只需要从该Session中查找该客户的状态就可以了;
## 安全性
![](https://blog.meowrain.cn/api/i/2025/09/22/ia3jrw-1.webp)


## Session 的工作流程
![](https://blog.meowrain.cn/api/i/2025/09/22/i8sx9o-1.webp)

## 大小
Session是无大小限制的


## 缺陷
![](https://blog.meowrain.cn/api/i/2025/09/22/ib38t6-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/22/ib9eq3-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/22/ib4quq-1.webp)

## Cookie和Session的区别
![](https://blog.meowrain.cn/api/i/2025/09/22/ibdvwc-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/22/ibpwz6-1.webp)