---
title: Redisson延时队列架构
published: 2025-07-27
description: ''
image: ''
tags: ['Redis','Redisson','延时队列']
category: '中间件 > Redis'
draft: false 
lang: ''
---

延时队列是一种特殊的消息队列，消息在发送后不会立即被消费，而是等待指定的时间后才被消费者处理。就像设置了一个"闹钟"，到时间才响。

# 阻塞队列 RBlockingDeque - 阻塞双端队列
特点： 
- 双端： 可以从两端插入和取出元素
- 阻塞： 当队列为空的时候，取元素会阻塞等待
- 线程安全： 多个线程可以安全操作


```java
// 特点：
// - 双端：可以从两端插入和取出元素
// - 阻塞：当队列为空时，取元素会阻塞等待
// - 线程安全：多个线程可以安全操作

RBlockingDeque<String> deque = redissonClient.getBlockingDeque("myDeque");
deque.offerFirst("头部元素");
deque.offerLast("尾部元素");
String element = deque.takeFirst(); // 阻塞获取

```

# RDelayedQueue - 延时队列

特点：
- 自动延时：消息在指定时间后自动变为可消费状态
- 精确控制：可以精确控制每个消息的延时时间
- Redis实现：基于Redis的有序集合(ZSet)实现

```java

RDelayedQueue<String> delayedQueue = redissonClient.getDelayedQueue(deque);
delayedQueue.offer("消息内容", 30, TimeUnit.SECONDS); // 30秒后可消费
```

## 完整实现示例 

### 生产者端（消息发送）
```java
@Service
public class DelayQueueProducer {
  
    @Autowired
    private RedissonClient redissonClient;
  
    public void sendDelayedMessage(String message, long delaySeconds) {
        try {
            // 创建队列
            RBlockingDeque<String> blockingDeque = redissonClient
                .getBlockingDeque("DELAY_QUEUE_EXAMPLE");
            RDelayedQueue<String> delayedQueue = redissonClient
                .getDelayedQueue(blockingDeque);
          
            // 发送延时消息
            delayedQueue.offer(message, delaySeconds, TimeUnit.SECONDS);
          
            System.out.println("发送延时消息: " + message + 
                             ", 延时: " + delaySeconds + "秒");
        } catch (Exception e) {
            log.error("发送延时消息失败", e);
        }
    }
}
```

### 消费者端（消息处理）
```java
@Component
public class DelayQueueConsumer {
  
    @Autowired
    private RedissonClient redissonClient;
  
    @PostConstruct
    public void startConsumer() {
        // 启动独立线程消费延时消息
        new Thread(this::consumeMessages, "DelayQueueConsumer").start();
    }
  
    private void consumeMessages() {
        try {
            RBlockingDeque<String> blockingDeque = redissonClient
                .getBlockingDeque("DELAY_QUEUE_EXAMPLE");
          
            while (!Thread.currentThread().isInterrupted()) {
                // 阻塞获取消息（自动等待延时到期）
                String message = blockingDeque.take();
                System.out.println("消费延时消息: " + message);
              
                // 处理业务逻辑
                processMessage(message);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.info("消费者线程被中断");
        } catch (Exception e) {
            log.error("消费消息异常", e);
        }
    }
  
    private void processMessage(String message) {
        // 实际的业务处理逻辑
        System.out.println("处理业务消息: " + message);
    }
}
```


## 底层实现原理

### Redis数据结构使用
```bash
# Redisson使用以下数据结构：
# 1. 有序集合(ZSet) - 存储延时消息和到期时间
ZADD delay_queue 1640995200 "message1"  # 到期时间戳作为score

# 2. 列表(List) - 存储已到期可消费的消息
LPUSH ready_queue "message1"

# 3. 定时任务 - 定期检查到期消息
# Redisson内部使用定时任务扫描ZSet，将到期消息移动到List
```

### 延时检查机制
```java
// Redisson内部逻辑（简化版）
public class DelayedQueueChecker {
    public void checkExpiredMessages() {
        long now = System.currentTimeMillis();
      
        // 从有序集合中获取已到期的消息
        Set<String> expiredMessages = redisTemplate
            .opsForZSet()
            .rangeByScore("delay_queue", 0, now);
      
        for (String message : expiredMessages) {
            // 移动到可消费队列
            redisTemplate.opsForList().leftPush("ready_queue", message);
            redisTemplate.opsForZSet().remove("delay_queue", message);
        }
    }
}
```
## 使用场景

```java
// 1. 订单超时处理
public void handleOrderTimeout(String orderId) {
    delayedQueue.offer(orderId, 30, TimeUnit.MINUTES);
}

// 2. 优惠券到期提醒
public void couponExpireReminder(String couponId) {
    delayedQueue.offer(couponId, 24, TimeUnit.HOURS);
}

// 3. 消息重试机制
public void messageRetry(String messageId) {
    delayedQueue.offer(messageId, 5, TimeUnit.SECONDS); // 5秒后重试
}
```

