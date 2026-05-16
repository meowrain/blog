---
card: 5 of 6
type: content
style: notion
layout: list
slug: code-implementation
---

# Prompt

Notion style image, 3:4 portrait aspect ratio. Pure white background (#FFFFFF) with hand-drawn black ink line art aesthetic.

Title at top in hand-drawn black lettering: "KNN 代码实现" with underline.

Four numbered steps arranged vertically, each with a pastel-colored numbered circle:

① pastel blue (#A8D4F0) circle with "1": "加载数据 + 划分训练/测试集"
Text below: "from sklearn.model_selection import train_test_split"

② pastel yellow (#F9E79F) circle with "2": "标准化/归一化（KNN依赖距离计算！）"
Text below: "StandardScaler() 或 MinMaxScaler()"

③ pastel pink (#FADBD8) circle with "3": "训练 KNN 模型"
Text below: "KNeighborsClassifier(n_neighbors=5)"

④ pastel blue (#A8D4F0) circle with "4": "预测 + 评估准确率"
Text below: "model.score(X_test, y_test)"

Bottom warning box in pastel yellow (#F9E79F) rounded rectangle with thick black outline:
"⚠️ 特征预处理很重要！"
"归一化：压缩到[0,1]  (x-min)/(max-min)"
"标准化：均值0，标准差1  (x-μ)/σ"

A thin ink line frame around each code snippet. Wobble-effect handwriting. Clean, uncluttered. No photorealistic elements, no gradients.