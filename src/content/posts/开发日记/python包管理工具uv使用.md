---
title: 开发日记/python包管理工具uv使用
published: 2026-01-18T19:23:07
description: "uv 是一个极速的 Python 包管理和项目管理工具，由 Rust 编写。本文介绍了 uv 的安装、基础用法以及如何使用它来替代 pip、poetry 和 pyenv。"
image: ""

draft: false
lang: ""
category: "开发日记"
tags:
  - "python"
  - "包管理"
  - "uv"
  - "rust"
---

# uv 使用指南

在 Python 的开发生态中，包管理和环境管理一直是一个让人头疼的话题。从 `pip` 到 `pipenv`，再到 `poetry` 和 `pdm`，工具层出不穷。而最近，由 Astral（Ruff 的开发者）推出的 **uv** 横空出世，凭借其**极快的速度**和**全能的特性**，迅速成为了 Python 开发者的新宠。

本文将带你快速上手 uv，体验这个"终结者"级别的工具。

## 什么是 uv？

`uv` 是一个用 Rust 编写的 Python 包安装器和解析器。它的设计初衷是替代 `pip`、`pip-tools` 和 `virtualenv`，但随着版本的迭代，它现在已经具备了替代 `poetry`（项目管理）、`pyenv`（Python 版本管理）和 `pipx`（工具管理）的能力。

**核心特点：**

- **极速**：比 pip 快 10-100 倍。
- **全能**：一个工具搞定 Python 安装、虚拟环境、依赖管理、工具运行。
- **兼容**：兼容 `pyproject.toml` 标准。

## 1. 安装 uv

uv 提供了多种安装方式，推荐使用官方的独立安装脚本，这样升级和管理更方便。

### macOS / Linux

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Windows (PowerShell)

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

### 使用 pip 安装

如果你只是想尝鲜，也可以通过 pip 安装：

```bash
pip install uv
```

安装完成后，可以通过以下命令验证：

```bash
uv --version
```

## 2. 项目管理 (Modern Workflow)

这是 uv 目前最推荐的使用方式，类似于 `poetry` 或 `npm` 的体验。

### 初始化项目

```bash
# 创建一个新项目
uv init my-project
cd my-project
```

![](https://blog.meowrain.cn/api/i/2026/01/18/vvzidl-1.webp)

![](https://blog.meowrain.cn/api/i/2026/01/18/vwl6mu-1.webp)

这将创建一个 `pyproject.toml` 文件和一个 `.python-version` 文件。

### 添加依赖

不再需要手动激活虚拟环境，`uv add` 会自动处理虚拟环境的创建和依赖的安装。

```bash
# 添加依赖
uv add requests

# 添加开发依赖 (例如 pytest)
uv add --dev pytest
```

![](https://blog.meowrain.cn/api/i/2026/01/18/vwrk27-1.webp)

![](https://blog.meowrain.cn/api/i/2026/01/18/vx4n39-1.webp)

![](https://blog.meowrain.cn/api/i/2026/01/18/vxz3kj-1.webp)

### 配置国内镜像源

#### 配置项目镜像

可以参考这个 `https://uv.oaix.tech/blog/2025/06/17/quickly-set-uv-package-index-is-china-mirror/` 来配置国内镜像源。

![](https://blog.meowrain.cn/api/i/2026/01/18/vygekp-1.webp)

![](https://blog.meowrain.cn/api/i/2026/01/18/vyls9m-1.webp)

在 ` pyproject.toml` 里面添加下面的内容

```toml
[[tool.uv.index]]
name = "tencent"
url = "https://mirrors.cloud.tencent.com/pypi/simple/" # 腾讯云镜像源
```

![](https://blog.meowrain.cn/api/i/2026/01/18/vz77xi-1.webp)

![](https://blog.meowrain.cn/api/i/2026/01/18/w7ixxh-1.webp)

![](https://blog.meowrain.cn/api/i/2026/01/18/w7uppx-1.webp)

可以看到里面已经用上镜像了

#### 配置全局镜像源

参考这个 `https://www.cnblogs.com/ljbguanli/p/19357762`

全局配置后，所有项目默认使用指定镜像，无需重复设置。

步骤 1：找到配置文件路径

- Linux/macOS：~/.config/uv/config.toml
- Windows：%USERPROFILE%\.config\uv\config.toml（如 C:\Users\你的用户名\.config\uv\config.toml）

步骤 2：创建/编辑配置文件

```
# Linux/macOS：用 vim 打开（若文件不存在会自动创建）
vim ~/.config/uv/config.toml
# Windows：用记事本打开
Write-Host $env:USERPROFILE


notepad %USERPROFILE%\.config\uv\config.toml
```

```toml
# 阿里云镜像（推荐，稳定性好）
[registries.pypi]
index = "https://mirrors.aliyun.com/pypi/simple/"
```

![](https://blog.meowrain.cn/api/i/2026/01/18/w2n47v-1.webp)

![](https://blog.meowrain.cn/api/i/2026/01/18/w3acq4-1.webp)

![](https://blog.meowrain.cn/api/i/2026/01/18/w3ngws-1.webp)

![](https://blog.meowrain.cn/api/i/2026/01/18/w3qyvu-1.webp)

![](https://blog.meowrain.cn/api/i/2026/01/18/w47xz8-1.webp)

> 不过网上推荐的都是直接设置环境变量 `UV_DEFAULT_INDEX`

For Linux Users:

```bash
# 推荐使用清华源
echo 'export UV_DEFAULT_INDEX="https://pypi.tuna.tsinghua.edu.cn/simple"'>> ~/.bashrc

# 或者用阿里源
# echo 'export UV_DEFAULT_INDEX="https://mirrors.aliyun.com/pypi/simple/"' >> ~/.bashrc

# 让配置立即生效
source ~/.bashrc
```

For Windows Users: 

 这个只在当前会话生效，关闭会话后就会失效。
```powershell
$env:UV_DEFAULT_INDEX = "https://pypi.tuna.tsinghua.edu.cn/simple"
```

想永久生效就
![](https://blog.meowrain.cn/api/i/2026/01/18/w63ik2-1.webp)

环境变量不知道去哪儿找可以直接 windows 搜索 `环境变量` 就可以找到。

![](https://blog.meowrain.cn/api/i/2026/01/18/w6bb65-1.webp)

![](https://blog.meowrain.cn/api/i/2026/01/18/w91iwr-1.webp)



### 如果是已经有的项目，如何用 uv 同步包呢？

如果是已经有的项目，你可以使用 `uv sync` 命令来同步项目的依赖。

```bash
uv sync
```

这将根据 `pyproject.toml` 中的配置，安装所有必要的依赖。

![](https://blog.meowrain.cn/api/i/2026/01/18/w06627-1.webp)

![](https://blog.meowrain.cn/api/i/2026/01/18/w0aosh-1.webp)

### 运行代码

使用 `uv run` 可以在项目的虚拟环境中执行命令，无需显式激活环境。

```bash
# 运行脚本
uv run main.py

# 运行工具
uv run pytest
```

![](https://blog.meowrain.cn/api/i/2026/01/18/wbir6y-1.webp)

![](https://blog.meowrain.cn/api/i/2026/01/18/wbml7j-1.webp)

### 同步环境

如果你拉取了别人的代码，或者手动修改了 `pyproject.toml`，可以使用 `sync` 命令同步环境：

```bash
uv sync
```

## 3. Python 版本管理

uv 内置了 Python 版本管理功能，这意味着你不再需要安装 `pyenv` 或 `conda` 来管理不同的 Python 版本。

```bash
# 列出可用的 Python 版本
uv python list

# 安装特定版本的 Python
uv python install 3.12

# 为当前项目指定 Python 版本
uv python pin 3.11
```

当你运行 `uv run` 或 `uv sync` 时，uv 会自动下载并使用项目指定的 Python 版本。

这个也可以用镜像，不然走github国内很慢
很简单

![](https://blog.meowrain.cn/api/i/2026/01/18/x4rjp3-1.webp)

```
UV_PYTHON_INSTALL_MIRROR

https://mirror.nju.edu.cn/github-release/astral-sh/python-build-standalone/
```

linux的话 
```bash
export UV_PYTHON_INSTALL_MIRROR="https://mirror.nju.edu.cn/github-release/astral-sh/python-build-standalone/"
```

![](https://blog.meowrain.cn/api/i/2026/01/18/x627ey-1.webp)

## 4. 脚本支持 (Script Support)

uv 对单文件脚本的支持非常出色。你可以在脚本顶部声明依赖，uv 会自动下载并运行，且不会污染全局环境。

创建一个 `example.py`：

```python
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "requests<3",
#     "rich",
# ]
# ///

import requests
from rich.pretty import pprint

resp = requests.get("https://peps.python.org/api/peps.json")
data = resp.json()
pprint([(k, v["title"]) for k, v in data.items()][:10])
```

直接运行：

```bash
uv run example.py
```

uv 会自动解析头部元数据，创建一个临时环境并安装依赖，然后执行脚本。

## 5. 工具管理 (Tool Management)

类似于 `pipx`，uv 可以安装和运行全局的 Python 命令行工具。

```bash
# 临时运行一个工具 (例如 ruff)
uvx ruff check .
# 或者
uv tool run ruff check .

# 安装一个工具到全局
uv tool install black
```

## 6. 兼容 pip 的接口 (Legacy Interface)

如果你不想改变现有的工作流，只想利用 uv 的速度，可以使用它的 pip 兼容接口。

```bash
# 创建虚拟环境
uv venv

# 创建指定版本的虚拟环境
uv venv --python 3.12

# 激活环境 (Windows)
.venv\Scripts\activate
# 激活环境 (macOS/Linux)
source .venv/bin/activate

# 安装依赖 (替代 pip install)
uv pip install requests

# 从 requirements.txt 安装
uv pip install -r requirements.txt

# 生成锁定文件 (替代 pip-compile)
uv pip compile pyproject.toml -o requirements.txt
```

## 总结

uv 正在以惊人的速度重塑 Python 的开发体验。它不仅解决了"慢"的问题，更重要的是它试图统一碎片化的 Python 工具链。

**迁移建议：**

- **新项目**：直接使用 `uv init` 和 `uv add` 的工作流。
- **老项目**：可以先用 `uv pip` 替代 `pip` 加速安装，时机成熟后迁移到 `pyproject.toml` 管理。
- **脚本**：强烈推荐使用 `uv run` 运行带依赖声明的单文件脚本。

