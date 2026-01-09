---
title: 开发日记/GitFlow学习
published: 2026-01-10T00:21:42
description: ''
image: ''

draft: false 
lang: ''
category: '开发日记'
---
# GitFlow 学习：一套分支协作“规矩”的来龙去脉

这两天为了把团队协作流程梳理清楚，我系统看了一遍 GitFlow。它不是某个命令，也不是 Git 的内置功能，而是一套“怎么分支、怎么合并、怎么发版、怎么修线上”的协作约定。

它的优点是清晰、可控、可复用；缺点是流程偏重、分支偏多。适不适合，取决于团队规模、发版节奏和项目类型。

## GitFlow 解决的核心问题

在多人协作里，常见的冲突不是代码冲突，而是“节奏冲突”：

- 你在开发新功能，另一个人要紧急修线上 bug
- 产品要在本周发一个稳定版本，但下周的大需求已经在开发中
- 版本需要打 Tag、回滚、追溯某次发布包含哪些改动

GitFlow 做的事情就是把这些“节奏”通过分支模型固定下来，让每个人都知道：

- 哪个分支代表线上稳定版本
- 哪个分支代表日常集成
- 新功能、发版、紧急修复分别从哪里来、往哪里去

## 分支模型：两条主干 + 三类临时分支

### 主分支

- `main`（或 `master`）：线上稳定分支。每一次正式发布通常都来自这里，并通过 Tag 标记版本。
- `develop`：日常集成分支。新功能开发完成后会合回 `develop`，用于持续集成与联调。

### 临时分支

- `feature/*`：功能分支，从 `develop` 拉出，完成后合回 `develop`。
- `release/*`：发布分支，从 `develop` 拉出，用于发版前的收尾（修 bug、改版本号、补文档等），最终合到 `main` 并回灌 `develop`。
- `hotfix/*`：紧急修复分支，从 `main` 拉出，修复线上问题，最终合到 `main` 并回灌 `develop`。

## 标准流程：从开发到发布，再到紧急修复

### 1) 开发新功能：feature 分支

目标：不污染 `develop`，开发完成后再合并。

```bash
git switch develop
git pull
git switch -c feature/user-profile
```

功能完成后发起 PR 合并到 `develop`。合并完成后可以删除 feature 分支：

```bash
git switch develop
git pull
git branch -d feature/user-profile
```

### 2) 准备发版：release 分支

目标：冻结需求，专注发版质量；同时不阻塞 `develop` 的后续开发。

```bash
git switch develop
git pull
git switch -c release/1.3.0
```

在 `release/1.3.0` 上通常会做：

- 修复发版相关 bug
- 调整版本号
- 补发版说明（changelog）

确认发布后：

1. 合并到 `main`
2. 在 `main` 上打 tag
3. 把 release 的改动回灌到 `develop`

```bash
git switch main
git pull
git merge --no-ff release/1.3.0
git tag -a v1.3.0 -m "release v1.3.0"
git push --follow-tags

git switch develop
git pull
git merge --no-ff release/1.3.0
git push
```

发布完成后删除发布分支：

```bash
git branch -d release/1.3.0
```

### 3) 线上紧急修复：hotfix 分支

目标：以最短路径修复线上，不等待 `develop` 的合并节奏。

```bash
git switch main
git pull
git switch -c hotfix/1.3.1
```

修复完成后：

1. 合并回 `main` 并打 tag
2. 回灌 `develop`（否则下次发布可能把 bug 又带回来）

```bash
git switch main
git pull
git merge --no-ff hotfix/1.3.1
git tag -a v1.3.1 -m "hotfix v1.3.1"
git push --follow-tags

git switch develop
git pull
git merge --no-ff hotfix/1.3.1
git push
```

## 团队落地建议：不然 GitFlow 会变成“形式主义”

### 分支命名约定

- `feature/<ticket>-<desc>`
- `release/<version>`
- `hotfix/<version>`

明确 ticket（Jira/禅道/飞书任务）能减少“这分支是干嘛的”的沟通成本。

### 合并策略建议

- 日常 feature 合并建议走 PR + review
- 合并时倾向使用 `--no-ff` 保留分支合并节点，方便追溯一个 feature 的整体生命周期
- 需要线性历史（rebase）也可以，但要团队一致，且注意不要 rebase 已推送且多人协作的分支

### Tag 与版本号

- 发布分支/热修分支最终都应该落到 `main`，并在 `main` 打 tag
- tag 建议使用 `vX.Y.Z`（语义化版本），长期会非常省事：定位问题、回滚、对比版本都更直观

## 这种流程适合谁？不适合谁？

### 适合

- 有明确“发版”概念的软件：需要版本号、发布窗口、变更可追溯
- 需要同时并行多个功能开发，还要保证某个版本稳定交付
- 线上问题需要快速热修，且修复必须被未来版本继承

### 不太适合

- 小团队/个人项目：分支成本大于收益
- 强 Trunk-Based（主干开发）文化的团队：更倾向短分支 + 快速合并到主干 + 高频发布
- 非常高频发版（比如一天多次发布）：GitFlow 的 release 分支会显得偏重

## 常见踩坑点

- `develop` 长期不稳定：如果大家把“坏掉也没关系”的心态带进 `develop`，那 release 就会变成灾难收尾现场
- release 分支拖太久：发版窗口越长，回灌冲突越大；release 建议短周期
- hotfix 没回灌 develop：短期看修好了，长期会在下次发布被“复活”
- 过度流程化：所有改动都走 release/hotfix，导致流程负担极高，最后大家反而绕流程

## 和 GitHub Flow / Trunk-Based 的简单对比

- GitFlow：强调“版本管理”和“并行节奏”，清晰但偏重
- GitHub Flow：通常只有 `main` + feature 分支，合并即部署，适合持续交付
- Trunk-Based：极短生命周期分支（甚至直接主干），依赖 CI/CD 与 feature toggle，效率高但要求工程化更强

## 小结

GitFlow 的本质不是“分支越多越专业”，而是把团队协作里最难的三个问题拆开解决：

- 日常集成（`develop`）
- 稳定发布（`release/*` -> `main` + tag）
- 线上热修（`hotfix/*` -> `main` + 回灌 `develop`）

如果团队发版节奏明确、需要追溯和稳定性，GitFlow 很好用；如果项目更追求快速交付与高频发布，GitHub Flow 或 Trunk-Based 可能更适合。

## 参考

- https://blog.csdn.net/sunyctf/article/details/130587970
# 
