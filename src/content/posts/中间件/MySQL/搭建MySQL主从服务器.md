---
title: 搭建MySQL主从服务器
published: 2025-09-09
description: ''
image: ''
tags: ['MySQL', '主从同步']
category: '中间件 > MySQL'
draft: false 
lang: ''
---

# 买服务器
![](https://blog.meowrain.cn/api/i/2025/09/09/zh72vh-1.webp)
先买两台服务器，装ubuntu系统

# 安装mysql
![](https://blog.meowrain.cn/api/i/2025/09/09/zgrhyz-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/09/zh539x-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/09/zhoxxy-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/09/zhr1zz-1.webp)
# 修改配置，让两个服务器能够互相连接
![](https://blog.meowrain.cn/api/i/2025/09/09/zhxile-1.webp)

## 开启监听
root@ecs-f95f-0002:/etc/mysql/mysql.conf.d# vim mysqld.cnf 

![](https://blog.meowrain.cn/api/i/2025/09/09/zlvtzi-1.webp)

修改从库
![](https://blog.meowrain.cn/api/i/2025/09/09/zmmg8c-1.webp)

root@ecs-f95f-0001:/etc/mysql/mysql.conf.d# sudo systemctl restart mysql
root@ecs-f95f-0002:/etc/mysql/mysql.conf.d# sudo systemctl restart mysql


重启一下主库和从库的mysql


![](https://blog.meowrain.cn/api/i/2025/09/09/zo9kra-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/09/zoe4t0-1.webp)

## 为root开启远程访问

mysql> ALTER USER 'root'@'%' IDENTIFIED WITH mysql_native_password BY 'root';
Query OK, 0 rows affected (0.00 sec)

mysql> FLUSH PRIVILEGES;
Query OK, 0 rows affected (0.00 sec)

启用密码验证


![](https://blog.meowrain.cn/api/i/2025/09/09/10irv8h-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/09/10iulwy-1.webp)

现在可以连接上了


## 修改主库配置
```
[mysqld]
server-id = 153
# 启用二进制日志功能，这是复制的基础
log-bin                 = /var/log/mysql/mysql-bin.log
# (可选) 设置二进制日志的格式，建议使用ROW格式，可以更好地保证数据一致性
binlog_format           = ROW
binlog_ignore_db        = mysql

```

## 创建远程用户
```sql
-- 创建远程用户
CREATE USER 'repl_user'@'%' IDENTIFIED WITH mysql_native_password BY 'remote';
-- 给予复制权限
 GRANT REPLICATION SLAVE ON *.* TO 'repl_user'@'%';

-- 刷新权限
FLUSH PRIVILEGES;
```

![](https://blog.meowrain.cn/api/i/2025/09/09/10notnv-1.webp)

```sql
-- 锁定所有表，防止新的数据写入，确保数据一致性
FLUSH TABLES WITH READ LOCK;

-- 查看主服务器状态
SHOW MASTER STATUS;
```

![](https://blog.meowrain.cn/api/i/2025/09/09/10o5bfr-1.webp)


## 备份主数据库，传到从服务器

```bash
 mysqldump -u root -p --all-databases --source-data > ./master_backup.sql
```

![](https://blog.meowrain.cn/api/i/2025/09/09/10pdpxq-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/09/10qxsbs-1.webp)


创建密钥
```bash
ssh-keygen -t rsa -b 4096
```

密钥创建好以后，把公钥放到从服务器
```bash
ssh-copy-id -i ~/.ssh/id_rsa.pub root@192.168.0.93
```



![](https://blog.meowrain.cn/api/i/2025/09/09/10r22n7-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/09/10rla5b-1.webp)

```
Host mysql-slave
    HostName 192.168.0.93
    User root
    Port 22
    IdentityFile ~/.ssh/id_rsa
```

![](https://blog.meowrain.cn/api/i/2025/09/09/10txbl0-1.webp)

从服务器配置： 
```bash
ssh-keygen -t rsa -b 4096
```
```bash
ssh-copy-id -i ~/.ssh/id_rsa.pub root@192.168.0.153
```

![](https://blog.meowrain.cn/api/i/2025/09/09/10s7nn8-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/09/10sa32o-1.webp)


```
Host mysql-master
    HostName 192.168.0.153
    User root
    Port 22
    IdentityFile ~/.ssh/id_rsa
```

![](https://blog.meowrain.cn/api/i/2025/09/09/10tejl0-1.webp)


从主服务器上把备份好的数据库传到从库上
```
root@ecs-f95f-0002:~# scp master_backup.sql mysql-slave:~
master_backup.sql                                             
```

从库已经可以看到了
![](https://blog.meowrain.cn/api/i/2025/09/09/10ujgs1-1.webp)

导入
![](https://blog.meowrain.cn/api/i/2025/09/09/122nj25-1.webp)


主库解锁
![](https://blog.meowrain.cn/api/i/2025/09/09/122tx0s-1.webp)


从库mysql配置文件
```
[mysqld]
server-id = 93
relay-log       = /var/log/mysql/mysql-relay-bin
read-only       = 1
# (可选但推荐) 记录从服务器的数据更改到自己的二进制日志，以便将来可以作为其他从服务器的主服务器
log-bin         = /var/log/mysql/mysql-bin.log
```

重启从库并且登录从库
![](https://blog.meowrain.cn/api/i/2025/09/09/125oncs-1.webp)

```sql
stop slave;
CHANGE MASTER TO 
    MASTER_HOST = '192.168.0.153',
    MASTER_USER = 'repl_user',
    MASTER_PASSWORD = 'remote',
    MASTER_LOG_FILE = 'mysql-bin.000005',
    MASTER_LOG_POS = 157;
START SLAVE;
```

![](https://blog.meowrain.cn/api/i/2025/09/09/129zoko-1.webp)

```

mysql> show slave status \G;
*************************** 1. row ***************************
               Slave_IO_State: Waiting for source to send event
                  Master_Host: 192.168.0.153
                  Master_User: repl_user
                  Master_Port: 3306
                Connect_Retry: 60
              Master_Log_File: mysql-bin.000005
          Read_Master_Log_Pos: 1826
               Relay_Log_File: mysql-relay-bin.000002
                Relay_Log_Pos: 326
        Relay_Master_Log_File: mysql-bin.000005
             Slave_IO_Running: Yes
            Slave_SQL_Running: Yes
              Replicate_Do_DB: 
          Replicate_Ignore_DB: 
           Replicate_Do_Table: 
       Replicate_Ignore_Table: 
      Replicate_Wild_Do_Table: 
  Replicate_Wild_Ignore_Table: 
                   Last_Errno: 0
                   Last_Error: 
                 Skip_Counter: 0
          Exec_Master_Log_Pos: 1826
              Relay_Log_Space: 536
              Until_Condition: None
               Until_Log_File: 
                Until_Log_Pos: 0
           Master_SSL_Allowed: No
           Master_SSL_CA_File: 
           Master_SSL_CA_Path: 
              Master_SSL_Cert: 
            Master_SSL_Cipher: 
               Master_SSL_Key: 
        Seconds_Behind_Master: 0
Master_SSL_Verify_Server_Cert: No
                Last_IO_Errno: 0
                Last_IO_Error: 
               Last_SQL_Errno: 0
               Last_SQL_Error: 
  Replicate_Ignore_Server_Ids: 
             Master_Server_Id: 153
                  Master_UUID: 014654cd-8d83-11f0-b940-fa163e8fe780
             Master_Info_File: mysql.slave_master_info
                    SQL_Delay: 0
          SQL_Remaining_Delay: NULL
      Slave_SQL_Running_State: Replica has read all relay log; waiting for more updates
           Master_Retry_Count: 86400
                  Master_Bind: 
      Last_IO_Error_Timestamp: 
     Last_SQL_Error_Timestamp: 
               Master_SSL_Crl: 
           Master_SSL_Crlpath: 
           Retrieved_Gtid_Set: 
            Executed_Gtid_Set: 
                Auto_Position: 0
         Replicate_Rewrite_DB: 
                 Channel_Name: 
           Master_TLS_Version: 
       Master_public_key_path: 
        Get_master_public_key: 0
            Network_Namespace: 
1 row in set, 1 warning (0.00 sec)

ERROR: 
No query specified
```


![](https://blog.meowrain.cn/api/i/2025/09/09/12i6cmk-1.webp)

在主库里面
创建库，表，插入数据
```sql
-- 创建 UTF8MB4 数据库
CREATE DATABASE testdb
CHARACTER SET utf8mb4
COLLATE utf8mb4_general_ci;

use testdb;
CREATE TABLE user_data (
    id INT AUTO_INCREMENT PRIMARY KEY,        -- 主键，自动递增
    username VARCHAR(255) NOT NULL,           -- 用户名，最大长度255
    comment TEXT CHARACTER SET utf8mb4        -- 评论，支持存储表情符号和其他Unicode字符
) ENGINE=InnoDB CHARSET=utf8mb4;

-- 插入常规数据
INSERT INTO user_data (username, comment) VALUES ('Alice', 'Hello, world!');

-- 插入带表情符号的数据
INSERT INTO user_data (username, comment) VALUES ('Bob', 'This is fun! 😊');

-- 插入中文字符
INSERT INTO user_data (username, comment) VALUES ('Charlie', '你好，世界！');

-- 插入混合内容
INSERT INTO user_data (username, comment) VALUES ('David', '中文＋Emoji 🌟😄');

```

![](https://blog.meowrain.cn/api/i/2025/09/09/12jzoy9-1.webp)

![](https://blog.meowrain.cn/api/i/2025/09/09/12k2qso-1.webp)

接下来我们看看从库状态


![](https://blog.meowrain.cn/api/i/2025/09/09/12kp3qc-1.webp)