# Xiaohongshu Infographic Series Outline

---
strategy: b
name: Information-Dense
style: notion
default_layout: flow
image_count: 6
generated: 2026-05-16 18:35
---

## Image 1 of 6

**Position**: Cover
**Layout**: sparse
**Hook**: KNN到底怎么分类？3分钟看懂K近邻算法
**Slug**: knn-cover
**Filename**: 01-cover-knn-cover.png

**Text Content**:
- Title: 「KNN — K近邻算法」
- Subtitle: 近朱者赤，近墨者黑
- Tags: #机器学习入门 #分类回归

**Visual Concept**:
纯白底，黑色手绘线条。中心大字标题"KNN"，旁边画三个手绘小人/点，距离最近的用线连起来。周围散布小圈点表示不同类别的数据点。极简手绘墨线风格，留白多，干净清爽。下方两个简约tag pill。

**Swipe Hook**: 看一个具体例子你就懂了👇

---

## Image 2 of 6

**Position**: Content
**Layout**: flow
**Core Message**: KNN水果分类 — 手把手计算
**Slug**: fruit-example
**Filename**: 02-content-fruit-example.png

**Text Content**:
- Title: 「水果分类 · 距离计算」
- 数据集表格：4个水果（重量/红度/种类）
- 新点 P(158g, 红度7) → ？？
- 欧氏距离公式：d = √[(x₂-x₁)² + (y₂-y₁)²]
- 计算结果：
  - 水果1 → 8.06 (苹果)
  - 水果2 → 2.83 (苹果) ← 最近
  - 水果3 → 12.65 (橙子)
  - 水果4 → 22.20 (橙子)
- K=3 → 苹果2票 vs 橙子1票 → 🍎 苹果！

**Visual Concept**:
白底黑线手绘。左侧简单的二维坐标系，4个点散落（两种颜色区分苹果和橙子）。右侧手写公式计算。用箭头和最短路线的连接线标示最近的点。极简线条风，pastel blue/yellow点缀。

**Swipe Hook**: K值选多少才合适？👇

---

## Image 3 of 6

**Position**: Content
**Layout**: comparison
**Core Message**: K值的影响 — 过拟合 vs 欠拟合
**Slug**: k-value-impact
**Filename**: 03-content-k-value-impact.png

**Text Content**:
- Title: 「K 值选多大？」

| K 值过小（如 K=1） | K 值过大（如 K=N） |
| 只看最近1个点 | 全部投票 |
| 对噪声敏感 | 只预测为多数类 |
| ❌ 过拟合 | ❌ 欠拟合 |

- ✅ 推荐方案：
  - 交叉验证选K（1,3,5,7,9...逐个试）
  - 二分类选奇数避免平局
  - 经验：K ≈ √N

**Visual Concept**:
白底对比双栏。左边手绘：K=1时决策边界扭曲缠绕，标注"过拟合"。右边手绘：K=N时决策边界变成一条直线，标注"欠拟合"。下方小提示区域用pastel yellow底色框标出推荐方案。线条简洁，两栏中间用虚线分隔。

**Swipe Hook**: 分类和回归原来不一样👇

---

## Image 4 of 6

**Position**: Content
**Layout**: comparison
**Core Message**: 分类问题 vs 回归问题
**Slug**: classification-regression
**Filename**: 04-content-classification-regression.png

**Text Content**:
- Title: 「分类 vs 回归」

| 分类问题 | 回归问题 |
| 预测离散类别 | 预测连续数值 |
| 例子：垃圾邮件检测 | 例子：房价预测 |
| 决策：多数表决 | 决策：求平均值 |
| 邻居投票，票多者胜 | 邻居数值相加取平均 |

| 进阶：距离加权 |
| 距离越近，投票权重/数值贡献越大 |

**Visual Concept**:
白底双栏对比。左栏画邮件图标+投票箱（多数表决）。右栏画房子图标+计算器（求平均）。下方pastel blue底色框标注"距离加权"进阶知识。手绘线条极简风。

**Swipe Hook**: 看看代码怎么实现👇

---

## Image 5 of 6

**Position**: Content
**Layout**: list
**Core Message**: KNN 代码实现 + 特征预处理
**Slug**: code-implementation
**Filename**: 05-content-code-implementation.png

**Text Content**:
- Title: 「KNN 代码实现」
- 四步走：
  - ① 加载数据 + 划分训练/测试集
  - ② 标准化/归一化（KNN依赖距离！）
  - ③ 训练：KNeighborsClassifier(n_neighbors=5)
  - ④ 预测 + 评估准确率

- ⚠️ 特征预处理很重要！
  - 归一化：压缩到[0,1]
  - 标准化：均值0，标准差1

**Visual Concept**:
白底竖排四个步骤，每个步骤用pastel色小圆标数字①②③④。代码片段用简洁的线框圈出。下方pastel yellow警告框标注特征预处理。手绘线条风，干净整洁。

**Swipe Hook**: 总结一下KNN的优缺点👇

---

## Image 6 of 6

**Position**: Ending
**Layout**: sparse
**Core Message**: KNN 总结
**Slug**: summary
**Filename**: 06-ending-summary.png

**Text Content**:
- ✅ 优点：思想直观，无需训练，适合多分类
- ❌ 缺点：预测慢，维度灾难，需要预处理
- CTA: ⭐ 收藏 | 📤 转发给学ML的朋友
- 互动: 你用过KNN做什么任务？评论区聊聊👇

**Visual Concept**:
纯白底，中心手绘总结卡片。上半部分✅绿色手写优点，下半部分❌红色手写缺点。底部三个小图标：收藏⭐、转发📤、评论💬。极简风，大量留白，干净清爽。

---