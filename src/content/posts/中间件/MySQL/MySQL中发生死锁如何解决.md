---
title: MySQL中发生死锁如何解决
published: 2025-09-08
description: 'MySQL中发生死锁如何解决'
image: ''
tags: ['MySQL','死锁']
category: '中间件 > MySQL'
draft: false 
lang: ''
---

![](https://blog.meowrain.cn/api/i/2025/09/08/10jgi3w-1.webp)



# 自动检测与回滚
MySQL自带死锁检测机制（innodb_deadlock_detect），当检测到死锁的时候，数据库会自动回滚其中一个事务，以接触死锁，通常会回滚事务中持有最少资源的那个。

也有锁等待超时的参数（innodb_lock_wait_timeout），当锁等待超过这个时间后，MySQL会自动回滚。

# 手动kill发生死锁的语句
可以通过命令，手动快速找出被阻塞的事务以及线程ID，然后手动Kill掉，及时释放资源。

# 常见降低/排除死锁出现情况的方法
- 避免大事务： 大事务占据锁耗时长，可以把大事务拆分成多个小事务执行快速释放锁，可以降低死锁产生的概率和冲突
- 调整申请锁的顺序： 在写操作的时候保证能获得足够范围的锁，如修改操作的时候先获取排他锁再获取共享锁，固定顺序访问数据
- 更改数据隔离级别： 可重复读比读已提交多了间隙锁和临键锁，使用读已提交能降低死锁出现的情况。
- 合理建立索引，减少加锁范围
- 开启死锁检测，适当调整锁等待超时时间

![](https://blog.meowrain.cn/api/i/2025/09/08/11d3nuc-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/08/11d5hm7-1.webp)

# 实际测试
innodb_print_all_deadlocks：开启死锁打印
```sql
show VARIABLES like 'innodb_print_all_deadlocks';

set GLOBAL innodb_print_all_deadlocks = 1;

flush PRIVILEGES;

```

```sql

create table deadlock_test (
  id bigint not null,
  name varchar(255),
  primary key(id)
);
insert into deadlock_test values(1, 'zhangsan');

```

![](https://blog.meowrain.cn/api/i/2025/09/08/10tx11y-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/08/10u159n-1.webp)


```sql
show engine innodb status;
```


经典“交叉持锁、互等”死锁：
事务 (1) 当前语句是 select * from deadlock_test where id = 1 for update，日志显示它已持有 id=2 的记录锁，正等待获取 id=1 的锁。
事务 (2) 当前语句是 select * from deadlock_test where id = 2 for update，日志显示它已持有 id=1 的记录锁，正等待获取 id=2 的锁。
二者形成环：T1 持 id=2 等 id=1；T2 持 id=1 等 id=2。
锁类型：lock_mode X locks rec but not gap 为记录级行锁（非 GAP 锁），锁定的是主键记录本身。
仲裁结果：InnoDB 回滚了事务 (2)（“WE ROLL BACK TRANSACTION (2)”），说明它评估回滚成本更低（未必是开始时间靠后）。

```
------------------------
LATEST DETECTED DEADLOCK
------------------------
2025-09-08 14:25:29 138110019045056
*** (1) TRANSACTION:
TRANSACTION 48777, ACTIVE 96 sec starting index read
mysql tables in use 1, locked 1
LOCK WAIT 3 lock struct(s), heap size 1128, 2 row lock(s), undo log entries 1
MySQL thread id 638, OS thread handle 138111594002112, query id 479129 10.0.0.8 root statistics
select * from deadlock_test where id = 1 for update

*** (1) HOLDS THE LOCK(S):
RECORD LOCKS space id 76 page no 4 n bits 72 index PRIMARY of table `deadlock`.`deadlock_test` trx id 48777 lock_mode X locks rec but not gap
Record lock, heap no 3 PHYSICAL RECORD: n_fields 4; compact format; info bits 0
 0: len 8; hex 8000000000000002; asc         ;;
 1: len 6; hex 00000000be89; asc       ;;
 2: len 7; hex 82000001230110; asc     #  ;;
 3: len 7; hex 77616e6773616e; asc wangsan;;


*** (1) WAITING FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 76 page no 4 n bits 72 index PRIMARY of table `deadlock`.`deadlock_test` trx id 48777 lock_mode X locks rec but not gap waiting
Record lock, heap no 2 PHYSICAL RECORD: n_fields 4; compact format; info bits 0
 0: len 8; hex 8000000000000001; asc         ;;
 1: len 6; hex 00000000be80; asc       ;;
 2: len 7; hex 01000000be2b14; asc      + ;;
 3: len 4; hex 6c697369; asc lisi;;


*** (2) TRANSACTION:
TRANSACTION 48768, ACTIVE 149 sec starting index read
mysql tables in use 1, locked 1
LOCK WAIT 3 lock struct(s), heap size 1128, 2 row lock(s), undo log entries 1
MySQL thread id 636, OS thread handle 138111598196416, query id 479151 10.0.0.8 root statistics
select * from deadlock_test where id = 2 for update

*** (2) HOLDS THE LOCK(S):
RECORD LOCKS space id 76 page no 4 n bits 72 index PRIMARY of table `deadlock`.`deadlock_test` trx id 48768 lock_mode X locks rec but not gap
Record lock, heap no 2 PHYSICAL RECORD: n_fields 4; compact format; info bits 0
 0: len 8; hex 8000000000000001; asc         ;;
 1: len 6; hex 00000000be80; asc       ;;
 2: len 7; hex 01000000be2b14; asc      + ;;
 3: len 4; hex 6c697369; asc lisi;;


*** (2) WAITING FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 76 page no 4 n bits 72 index PRIMARY of table `deadlock`.`deadlock_test` trx id 48768 lock_mode X locks rec but not gap waiting
Record lock, heap no 3 PHYSICAL RECORD: n_fields 4; compact format; info bits 0
 0: len 8; hex 8000000000000002; asc         ;;
 1: len 6; hex 00000000be89; asc       ;;
 2: len 7; hex 82000001230110; asc     #  ;;
 3: len 7; hex 77616e6773616e; asc wangsan;;

*** WE ROLL BACK TRANSACTION (2)
------------
TRANSACTIONS
------------
Trx id counter 48783
Purge done for trx's n:o < 48783 undo n:o < 0 state: running but idle
History list length 1
LIST OF TRANSACTIONS FOR EACH SESSION:
---TRANSACTION 419586600079360, not started
0 lock struct(s), heap size 1128, 0 row lock(s)
---TRANSACTION 419586600080976, not started
0 lock struct(s), heap size 1128, 0 row lock(s)
---TRANSACTION 419586600080168, not started
0 lock struct(s), heap size 1128, 0 row lock(s)
---TRANSACTION 419586600078552, not started
0 lock struct(s), heap size 1128, 0 row lock(s)
---TRANSACTION 419586600077744, not started
0 lock struct(s), heap size 1128, 0 row lock(s)
---TRANSACTION 419586600076936, not started
0 lock struct(s), heap size 1128, 0 row lock(s)
---TRANSACTION 48777, ACTIVE 121 sec
5 lock struct(s), heap size 1128, 2 row lock(s), undo log entries 1
MySQL thread id 638, OS thread handle 138111594002112, query id 479167 10.0.0.8 root
```

通过MySQL系统库查询被阻塞的事务以及线程ID，手动kill释放资源

查询锁信息表：
```sql
-- 8.0 版本以前
select * from information_schema.innodb_locks;
-- 8.0版本开始
select * from performance_schema.data_locks;
```

## 关闭死锁检测
```sql
SHOW VARIABLES LIKE 'innodb_deadlock_detect';
```

![](https://blog.meowrain.cn/api/i/2025/09/08/110r5za-1.webp)


```sql

SET GLOBAL innodb_deadlock_detect = 0;
```

![](https://blog.meowrain.cn/api/i/2025/09/08/111e4i9-1.webp)


接下来我们再次开两个事务

![](https://blog.meowrain.cn/api/i/2025/09/08/112zyds-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/08/11321yv-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/08/114vhsk-1.webp)


查询锁等待信息表
```sql
-- 8.0版本之前
select * from information_schema.innodb_lock_waits;
-- 8.0版本开始
select * from performance_schema.data_lock_waits;
```
![](https://blog.meowrain.cn/api/i/2025/09/08/114xwmu-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/08/115w1hh-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/08/116hus4-1.webp)

查询innodb事务信息
```sql
SELECT * from information_schema.INNODB_TRX;

```

![](https://blog.meowrain.cn/api/i/2025/09/08/11a35ow-1.webp)


![](https://blog.meowrain.cn/api/i/2025/09/08/118hy05-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/08/118d2ss-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/08/118f5gd-1.webp)
![](https://blog.meowrain.cn/api/i/2025/09/08/118gs9v-1.webp)



```sql
-- 列出当前的阻塞者（含可直接 KILL 的进程号）
SELECT
  b.ENGINE_TRANSACTION_ID   AS blocking_trx_id,
  th.PROCESSLIST_ID         AS blocking_pid,
  trx.trx_started,
  trx.trx_state,
  trx.trx_rows_locked,
  trx.trx_query
FROM performance_schema.data_lock_waits w
JOIN performance_schema.data_locks b
  ON w.blocking_engine_lock_id = b.engine_lock_id
JOIN information_schema.INNODB_TRX trx
  ON b.engine_transaction_id = trx.trx_id
JOIN performance_schema.threads th
  ON b.thread_id = th.thread_id
GROUP BY blocking_trx_id, blocking_pid, trx.trx_started, trx.trx_state, trx.trx_rows_locked, trx.trx_query;

-- 杀掉阻塞会话
KILL CONNECTION <blocking_pid>;
```
![](https://blog.meowrain.cn/api/i/2025/09/08/119g2ic-1.webp)

