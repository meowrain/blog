# 管理后台 UI / UX 优化清单

范围：`backend/src/admin/public/`（index.html / app.js / styles.css）。
与 `OPTIMIZATION.md`（后端正确性/性能）互补，本文只关注界面、交互与使用逻辑。
每条标注：位置 → 现状 → 问题 → 建议。标 ✚ 的表示后端 API 已支持、纯前端工作。

---

## P0 — 数据安全与核心流程（优先做）

### 1. 编辑器没有「未保存更改」保护
- 位置：`app.js:524-534`（closeEditor）、`index.html:90`（close-btn）
- 现状：点 × 或「取消」直接关弹窗，不检查内容是否改过；没有 Ctrl+S，没有 Esc 关闭。
- 问题：写了几千字的正文，误点一个按钮全部丢失，这是后台最疼的事故。
- 建议：
  - 打开编辑器时记录原始值，任何字段变更置 dirty 标记；
  - dirty 状态下关闭弹窗 / 切换视图 / 刷新页面（beforeunload）都要 confirm；
  - 支持 `Ctrl+S` 保存、保存后清 dirty。

### 2. 批量「转草稿/发布」语义错误：是切换不是设置
- 位置：`app.js:220-233`
- 现状：对勾选的文章循环调 `toggle-draft`，每篇翻转到相反状态。
- 问题：混选「已发布 + 草稿」两类文章时结果完全不可预期（各自翻转）；且发起 N 个请求而非走 `/articles/bulk`，慢且中途失败产生半完成状态。
- 建议：拆成「设为发布」「设为草稿」两个按钮。短期可前端按当前状态分组分别调用；长期在 bulk operation 里加 `set_draft` 操作（后端一个 case 的事）。

### 3. 删除无撤销，且备份能力完全没暴露 ✚
- 位置：`app.js:551-564`（deleteArticle）；后端 `app.controller.ts:42-61`
- 现状：原生 `confirm()` 确认后直接删；UI 上没有备份管理入口。
- 问题：误删只能去服务器磁盘手工翻 backup；而后端其实已有 `GET /api/backups`、`POST /api/backups/restore`、`POST /api/backups/prune`，纯前端即可接入。
- 建议：
  - 短期：自定义确认弹窗（显示文章标题而非路径）、删除后 toast 加「撤销」按钮（前端缓存内容，撤销=重新创建）；
  - 中期：侧边栏加「备份」视图：备份列表 + 恢复 + 清理过期，把已有的安全网变成看得见的功能。

### 4. 保存按钮无防重、无加载态
- 位置：`app.js:475-521`（form submit）
- 现状：提交期间按钮可继续点，也无任何进度提示。
- 问题：慢网络下双击 = 创建两篇同名文章（后端 create 有静默覆盖风险，见 `OPTIMIZATION.md` #7，两问题叠加更危险）。
- 建议：submit 时禁用按钮 + 文案改「保存中…」，请求结束恢复；创建成功提示里带出文件路径。

### 5. CDN 不可用时整个后台白屏
- 位置：`index.html:8-10, 175-186`
- 现状：CodeMirror / marked / highlight.js 全部来自 cdnjs 公网。
- 问题：断网、CDN 被墙时 `CodeMirror is not defined` → DOMContentLoaded 回调直接抛错 → `loadArticles()` 永远不执行 → 整个后台死掉，连文章列表都出不来。
- 建议：把这几个库 vendor 到 `admin/public/vendor/` 随后端一起 serve（一劳永逸）；至少给 CodeMirror 加存在性检查，失败时降级为原生 textarea，保证列表功能可用。

---

## P1 — 使用逻辑与效率

### 6. 标签页只读，后端能力闲置 ✚
- 位置：`app.js:662-674`（renderTags）
- 现状：tag 卡片只展示名字和数量。
- 后端已有：`PATCH /api/tags/:name`（重命名）、`DELETE /api/tags/:name`、`POST /api/tags/bulk/add|remove`。
- 建议：卡片加重命名 / 删除按钮；重命名弹窗里显示受影响文章数（`GET /api/tags/:name` 已返回）。

### 7. 分类页同样只读 ✚
- 位置：`app.js:605-621`（renderCategories）
- 后端已有：`PATCH /api/categories/rename`、`DELETE /api/categories/:name`（支持 moveArticlesTo / deleteArticles）。
- 建议：卡片加「重命名」「删除」；删除时弹窗选择「文章移动到哪个分类 / 一并删除」，避免静默 no-op（见 `OPTIMIZATION.md` #8）。

### 8. 列表缺标签筛选，标签卡片不可点
- 位置：`index.html:47-57`（filters）、`app.js:668`（tag 卡片无 onclick）
- 现状：API 支持 `tag=` 查询参数（`articles.controller.ts:24`），UI 只有分类 + 状态筛选；分类卡片可点跳转，标签卡片点了没反应，行为不一致。
- 建议：filters 加标签下拉；`tag-card` 与 `category-card` 行为对齐（点击 → 文章页带 tag 过滤）。

### 9. 批量模式缺「全选本页 / 清空」，顶栏按钮拥挤
- 位置：`index.html:38-45`、`app.js:282-290`
- 现状：进入批量模式后 header 一排 7 个按钮；只能一篇篇勾，选错了没有一键清空（只有退出批量才清）。
- 建议：批量工具条独立成一行：`已选 N 篇 | 全选本页 | 清空 | 删除 | 设为发布/草稿 | 加标签 | 改分类`，操作按钮收进「更多」下拉。

### 10. 批量操作用原生 prompt 输入标签/分类
- 位置：`app.js:237, 244`
- 现状：`window.prompt('输入要追加的标签')`。
- 问题：无补全、无校验、样式突兀；分类格式 `Java > JUC` 只有此处有提示，编辑器里反而没有。
- 建议：换成小 modal + 已有的 datalist（`tag-list-datalist` / `category-list-datalist`），分类输入框下给格式示例。

### 11. 编辑器不显示正在编辑的文件路径
- 位置：`index.html:89`、`app.js:428-450`
- 现状：`editingArticlePath` 有值但 UI 不展示，标题只写「编辑文章」。
- 问题：同名文章、多语言版本（lang 字段）时容易搞混自己在改哪篇。
- 建议：弹窗标题下加一行等宽字体的路径面包屑，如 `Java/Spring/Article.md`。

### 12. 链接/图片插入要手工改占位符；封面图无预览
- 位置：`app.js:157-161`（link/image 插入 `https://example.com`）、`index.html:112`
- 建议：
  - 工具栏点 Link/Image 弹小输入框要 URL（带默认记忆上次值）；
  - 封面 URL 字段下加实时缩略图预览（加载失败显示占位）；
  - 正文粘贴/拖拽图片上传需后端加 upload 端点，可列入后续规划。

### 13. 筛选/分页/视图状态不同步到 URL
- 位置：`app.js:63-74`（switchView）、`currentFilters` / `currentPage`
- 现状：全部存内存，刷新即回到文章页第 1 页。
- 建议：用 `location.hash`（如 `#/articles?page=2&search=xx&category=Java&draft=true`）或 pushState 记录状态，刷新/分享链接均可恢复。

### 14. 分页信息量不足 + 一行无效代码
- 位置：`app.js:367-391`
- 现状：只有页码按钮，不显示总数；`app.js:369` `totalPages = totalPages;` 是自我赋值（参数遮蔽了全局变量），上页/下页按钮用隐藏而非禁用。
- 建议：显示「共 N 篇 · 第 x / y 页」；上下页按钮置 disabled 保留位置感；总数还能顺带当搜索结果反馈（改搜索词立刻看到命中数）。

### 15. 列表没有排序入口
- 位置：后端固定 published 倒序（`articles.service.ts:109`），UI 无任何排序控件。
- 建议：加排序下拉（发布时间 / 标题），需要后端 `findAll` 加 `sortBy` 参数——和 P1 一起排期。

### 16. 草稿文章日期可能显示 Invalid Date
- 位置：`app.js:346`
- 现状：`new Date(article.published).toLocaleDateString('zh-CN')`；外部创建或 frontmatter 缺 `published` 时为 undefined → 显示 "Invalid Date"。
- 建议：无值显示「—」；卡片同时展示更新时间（若 frontmatter 有 updated）。

---

## P2 — 视觉与细节打磨

### 17. 加载态、空状态、错误态都太素
- 位置：`app.js:325, 331`
- 建议：列表加载时显示骨架屏或 spinner（切视图时体验明显）；「暂无文章」加 CTA 按钮「新建第一篇文章」；加载失败展示错误 + 「重试」按钮，而不是只留一行错误文本。

### 18. 草稿/发布状态视觉太弱
- 位置：`styles.css:239-245`、`app.js:347`
- 现状：仅左侧 3px 边框颜色 + emoji 文字（📝 草稿 / ✅ 已发布）。
- 建议：标题旁放真正的 badge（圆角底色块：草稿=灰、发布=绿），emoji 从 meta 行移除；卡片标题 hover 变主色可点进编辑。

### 19. Markdown 工具栏无 tooltip、无快捷键
- 位置：`index.html:133-145`
- 建议：按钮加 `title`（含快捷键提示），实现 `Ctrl+B/I/K`；补 H1、删除线、表格、水平线按钮；按住 Shift 点 H2/H3 可降级标题（进阶）。

### 20. Modal 无 Esc、无焦点管理
- 位置：`app.js:524-534`
- 现状：编辑器弹窗不支持 Esc（预览弹窗支持点遮罩但也不支持 Esc）；打开后焦点不移入表单，Tab 可跑到底层页面。
- 建议：Esc 关闭（编辑器需先过 dirty 检查，见 #1）；打开时 focus 标题输入框；关闭后焦点还给触发按钮。

### 21. Markdown 预览未做 sanitize
- 位置：`app.js:180, 457-459`
- 现状：`marked.parse()` 结果直接 `innerHTML`。
- 问题：内容虽是自己写的，但粘贴外部 Markdown（带 `<script>` / `<img onerror>`）会在预览里执行。
- 建议：接 DOMPurify，或 marked 配置里禁用 raw HTML。

### 22. 语言字段是自由文本
- 位置：`index.html:115-118`
- 建议：改 select 或 datalist（`zh_CN` / `en` …），避免手滑打出 `zh-cn` / `ZH_CN` 造成多语言版本割裂。

### 23. Toast 类型单一、可重复堆积
- 位置：`app.js:191-202`
- 建议：加 info 类型；同一消息 200ms 内去重；批量失败明细（`result.failures` 目前只 console.error，`app.js:275`）可点开 toast 查看前几条原因。

### 24. 静态资源版本号手工维护
- 位置：`index.html:7, 188`（`?v=20260218-3`）
- 建议：改为 serve-static 的 ETag 协商缓存，或构建脚本自动注入版本，避免忘改导致线上还是旧 JS。

### 25. inline onclick + escapeJs 拼接 HTML
- 位置：`app.js:336-364`
- 现状：卡片 HTML 字符串里 `onclick="editArticle('...')"`，靠 `escapeJs` 转义。
- 问题：路径含双引号/特殊字符时脆弱；也导致将来无法上 CSP。
- 建议：改事件委托（容器监听 + `data-path` 属性），顺带删掉 `renderCategories` 里那句多余的 `updateBatchButtons()`（`app.js:620`）。

### 26. 暗色主题细节
- 位置：`styles.css` 全局
- 现状/建议：
  - input focus 无自定义样式，默认 outline 在暗色下突兀 → 定义 `:focus-visible` 边框色 = 主色；
  - 日期建议相对时间（「3 天前」），hover 出完整时间；
  - 移动端侧边栏可改为横向滚动的一行导航（现在是竖排占半屏）；
  - 主色 hover 只覆盖 btn-primary，nav-item / tag 高亮等处可复用同一 token。

---

## 建议实施顺序

| 批次 | 内容 | 说明 |
|------|------|------|
| ① 安全兜底 | #5 CDN 容灾 → #4 防重 → #1 脏检查 → #2 批量语义 | 都是防「丢数据/白屏」 |
| ② 能力补全 | #3 备份视图、#6/#7 分类标签管理 | 后端已就绪，纯前端 |
| ③ 流程顺畅 | #8 标签筛选、#9 批量工具条、#10/#12 编辑体验、#13 URL 状态 | 提升日常使用效率 |
| ④ 打磨 | P2 按需 | 视觉/无障碍/细节 |

工作量粗估：批次① 约半天；批次② 一个工作日内；③④ 视取舍。

---

## 实施状态（截至 2026-08-31）

**已完成**

| 项 | 说明 |
|----|------|
| #1 | 脏检查基于 `editor.snapshot` 比对；关闭/Escape/beforeunload 三处拦截，「继续编辑」不丢内容 |
| #2 | 后端 bulk 新增 `set_draft`，前端拆成「设为发布」「设为草稿」两个按钮 |
| #3 | 备份视图上线；单篇删除改为 toast 内「撤销」→ `POST /backups/restore`，按备份字节原样恢复到原路径，`published` 与文件名不再被改写 |
| #4 | `editor.saving` 互斥 + 按钮加载态 |
| #5 | CodeMirror 缺失时降级为纯 textarea，marked/hljs 全部可选调用，CDN 挂了不再白屏 |
| #6 / #7 | 标签、分类可增删改与合并 |
| #8 | 标签可点筛选，列表支持 `tag=` |
| #9 | 批量工具条含全选本页 / 清空 / 已选计数 |
| #10 | 统一 dialog（含 datalist 联想）替代原生 prompt |
| #11 | 编辑器顶栏显示真实文件路径 |
| #13 | 视图 + 筛选 + 分页写入 `location.hash`，可刷新/分享恢复 |
| #14 | 摘要行输出「共 N 篇 · 第 X / Y 页 · 每页 N 篇」 |
| #16 | `formatDate` / `formatDateTime` 对不可解析日期返回「—」/空，列表缺 `published` 时显示「未定日期」，不再出现 Invalid Date |
| #19 | `Ctrl/Cmd+S` 保存、`B` 加粗、`I` 斜体、`K` 插入链接（对话框取 URL），有 dialog 打开时不劫持按键 |
| #21 | 预览经 `sanitizeHtml` 处理 |
| #25 | 列表改为事件委托 + `data-action`，移除 inline onclick / escapeJs 拼接 |

**部分完成**

- #12 封面图预览已可用（含加载失败提示），但「插入链接/图片」仍是先插占位符再改；图片仍只能贴 URL，**缺真实上传接口**。
- #20 Esc 与编辑器关闭已接，**modal 焦点陷阱未做**（Tab 仍可走出对话框）。
- #5 残留：CDN `<script>` 仍无 `integrity` / `crossorigin`，彻底解法是把 CodeMirror、marked、hljs 本地化。
- #16 日期兜底已完成，仅建议中的「卡片同时展示更新时间（frontmatter `updated`）」未做。

**未开始**：#15 列表排序入口、#17/#18/#23/#26 视觉细节、#22 语言下拉、#24 版本号自动注入。

**未验证的部分**：本环境没有可用的 Node 运行时，因此未执行 `build` / `tsc` / 真实起服务，后端改动只经过人工比对与前端行为侧验证；上述结论均来自浏览器内以 fetch mock 驱动的交互实测。同时浏览器无可用视口，**未做任何截图与响应式布局检查**。合并前请在本地 `pnpm build` 起服务，跑一遍真实删除 → 撤销、批量发布/转草稿、分类合并。
