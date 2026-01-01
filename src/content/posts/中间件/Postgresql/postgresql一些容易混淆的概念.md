---
title: postgresql一些容易混淆的概念
published: 2025-07-21
description: ''
image: ''
tags: [PostgreSQL, PostgreSQL容易混淆的概念]
category: '中间件 > PostgreSQL'
draft: false 
lang: ''
---


# PostgreSQL一些容易混淆的概念

https://www.cnblogs.com/noodlesmars/p/11850559.html

# Schema

在数据库创建的同时，就已经默认为数据库创建了一个模式--public，这也是该数据库的默认模式。所有为此数据库创建的对象(表、函数、试图、索引、序列等)都是创建在这个模式中的

一个数据库包含一个或多个Schema，一个Schema包含一个或多个表，一个表包含一个或多个字段，一个字段包含一个或多个值。
我拿我们熟悉的MySQL数据库举例子，MySQL数据库中，数据库就是Schema，表就是Table，字段就是Column，值就是Value。
但是在PgSQL中，数据库不是像MySQL那样的数据库了，它下面可以放很多Schema，而Schema下面才是Table，字段就是Column，值就是Value。

打个比方，mysql的database就是一个书柜，table是一个个的抽屉，column是抽屉里的书，value就是书的内容。
但是在pgsql中，database是一个书房，schema是一个个书柜，table是一个个抽屉，column是抽屉里的书，value就是书的内容。

---
PostgreSQL 的分层结构 (Database -> Schema -> Table) 的优势：

更好的逻辑隔离和组织： 在一个数据库内部，您可以使用 Schema 来对表、视图、函数等数据库对象进行逻辑分组。这对于大型项目、多租户应用或需要区分不同模块的数据非常有用。例如，在一个 my_app_db 数据库中，您可以有 public Schema (默认)、users Schema、orders Schema、analytics Schema 等。
避免命名冲突： 不同的 Schema 可以包含同名的表。例如，users.accounts 和 orders.accounts 可以是两个完全不同的表，而不会冲突。这在 MySQL 中是不可能的，因为所有表都直接位于数据库下。
权限管理： 您可以对 Schema 设置权限，控制用户对特定 Schema 内对象的访问，这提供了更细粒度的权限控制。
数据迁移和管理： 在某些情况下，可以更容易地在 Schema 级别进行数据迁移或管理。
MySQL 的扁平结构 (Database -> Table) 的特点：

简单直观： 对于小型项目或初学者来说，MySQL 的结构可能更直接和易于理解，因为没有额外的 Schema 层。
兼容性： 许多其他数据库系统（如 SQL Server）也支持 Schema，但其概念可能与 PostgreSQL 更接近，而与 MySQL 的“数据库即 Schema”有所不同。

---




# User & Role

在PostgreSQL中，存在两个容易混淆的概念：角色/用户。之所以说这两个概念容易混淆，是因为对于PostgreSQL来说，这是完全相同的两个对象。唯一的区别是在创建的时候：

1.我用下面的psql创建了角色custom:
```sql
CREATE ROLE custom PASSWORD 'custom';
```

接着我使用新创建的角色custom登录，PostgreSQL给出拒绝信息：
FATAL：role 'custom' is not permitted to log in.

说明该角色没有登录权限，系统拒绝其登录

2.我又使用下面的psql创建了用户guest:
```sql
CREATE USER guest PASSWORD 'guest';
```
接着我使用guest登录，登录成功

> 难道这两者有区别吗？查看文档，又这么一段说明：
```sql
CREATE USER is the same as CREATE ROLE except that it implies LOGIN. ----CREATE USER除了默认具有LOGIN权限之外，其他与CREATE ROLE是完全相同的。
```


# 表空间
表空间是数据库中一个逻辑上的存储单元，它将数据库的物理存储位置（磁盘上的目录或文件）抽象出来，供数据库对象（如表、索引、大对象等）使用。

简单来说，你可以把表空间想象成数据库在磁盘上的一个个“存储分区”或“数据仓库”。数据库管理员 (DBA) 可以创建这些“仓库”，并指定它们实际位于哪个硬盘、哪个目录下。

核心要点：

逻辑与物理的桥梁： 表空间是连接数据库逻辑结构（Schema、表）与物理存储（文件系统）的桥梁。
存储位置的抽象： 它不存储数据本身，而是定义了数据应该存储在哪个物理位置。
管理单元： 它是 DBA 管理和优化存储资源的基本单位。

创建表空间 (CREATE TABLESPACE)
这是定义一个新的存储位置的第一步。您需要指定表空间的名称和它在文件系统上的物理路径。

```sql
-- 示例 1: 创建一个用于快速访问数据的表空间 (假设路径在 SSD 上)
CREATE TABLESPACE fast_data_ts LOCATION '/mnt/ssd_data/pg_tablespaces/fast_data';

-- 示例 2: 创建一个用于归档或不常用数据的表空间 (假设路径在 HDD 上)
CREATE TABLESPACE archive_data_ts LOCATION '/mnt/hdd_data/pg_tablespaces/archive_data';

-- 示例 3: 创建一个用于索引的专用表空间
CREATE TABLESPACE index_ts LOCATION '/mnt/ssd_data/pg_tablespaces/indexes';

```


重要提示：

LOCATION 指定的路径必须是绝对路径。
PostgreSQL 服务器进程必须对该路径拥有读写权限。
在创建表空间之前，您需要手动在文件系统上创建这些目录（例如：mkdir -p /mnt/ssd_data/pg_tablespaces/fast_data）。