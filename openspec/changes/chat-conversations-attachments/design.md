## Context

`/chat/` 的现状（动手前先读这几处）：

- 前端 `src/components/chat/ChatPanel.svelte` 是单一会话：localStorage 只存一个 `eo_chat_conversation_id`（第 33 行），`newChat()` 直接 `rotateConversationId()`（第 298-305 行）把旧 id 覆盖掉 —— 旧消息在服务端还在，但前端再也没有它的 id，永远取不回来。
- 后端 `agents/assistant/index.ts` 只接受 `{ role, content: string }`，第 88-90 行用 `typeof m.content === 'string' && m.content.trim()` 过滤；`agents/_agent-loop.ts` 第 150-153 行把历史拼成纯文本 message。整条链路没有任何图片通道。
- `cloud-functions/history/index.ts` 里 `action: 'clear'` 分支（第 21-42 行）已实现但前端从未调用。
- 联网工具 `web_search` 在 `agents/assistant/_tools.ts` 已注册，客户端已由 `agents/_tavily.ts` 换成 `agents/_wsa.ts`（腾讯云元宝搜索）；但 `assistant/index.ts` 读的 `WSA_SECRET_ID` / `WSA_SECRET_KEY` 线上为空，于是 `buildSystemPrompt(origin, false)` 直接告诉模型「这些工具会失败，别调」。实测线上只触发站内检索。`read_page` 已下线——元宝搜索不提供抓正文接口。
- `edgeone.json` 声明 `agents.framework: "deepagents"`，但本项目 **没有引 deepagents 运行时**，走的是手写 OpenAI tool loop（`_agent-loop.ts` 顶部注释说明了原因）。新代码沿用这套，不要引入 langchain。

平台能力（已核对 EdgeOne Makers 文档，见 `~/.agents/skills/edgeone-makers-tools/.../capabilities/store.md`）：

- `context.store`（agents）与 `context.agent.store`（cloud-functions）指向同一份数据，消息 API 一致：`appendMessage({conversationId, role, content, metadata})` / `getMessages({conversationId, limit, order})` / `clearMessages` / `deleteConversation` / `listConversations({limit, after})` / `updateConversation(id, {metadata})`。
- `getMessages` 的 `limit` 只能是 1~100；单会话上限 10,000 条；单条 content 上限 50MB。
- **`store.listConversations` 是账号级、不带 userId 过滤** —— 访客之间的会话会互相出现在列表里。这是判定「会话列表不能由服务端列」的决定性依据，见决策 1。
- Blob（`@edgeone/pages-blob`）是对象存储，不能当关系库用；本项目已在 `cloud-functions/api/stats/[[default]].js` 用它做计数与限流，可复用写法。
- SSE 事件表里没有「运行态提示」类型，需要自增（运行时只透传，不校验）。

## Goals / Non-Goals

**Goals:**

- 一个浏览器里能保留多段对话：列表、切换、重命名、删除；刷新与跨标签页后都还在
- 能给助手发图（粘贴 / 拖拽 / 选择），图片能进模型上下文，也能在历史回放里看到
- 访客能明确知道「这次有没有联网」「这次模型能不能读图」，而不是拿到一段含糊的回答
- 所有纯逻辑（索引、标题、校验、消息构造）可单测，且不依赖浏览器 API

**Non-Goals:**

- 不做跨设备同步的会话列表（需要账号体系，本项目没有用户系统）
- 不做服务端会话列表接口（`listConversations` 是账号级的，会把别人的会话列给访客）
- 不把图片存进 `context.store` 的消息体（50MB 上限虽够，但 base64 会撑爆上下文预算与读取耗时）
- 不做 PDF / Office / 音频输入
- 不改 `agents.framework`，不引入 langchain / deepagents / openai SDK

## Decisions

### 1. 会话索引存在 localStorage，消息正文仍以服务端 store 为准

新增 key `eo_chat_conversations`，值是数组（新→旧）：

```ts
type ConversationMeta = {
  id: string;        // 与 makers-conversation-id 同一个值
  title: string;     // 由首条用户消息截断而来，可手动重命名
  updatedAt: number; // epoch ms，用于排序与「3 天前」展示
};
```

- 为什么不调 `store.listConversations`：它是**账号级**的，没有 userId 维度，返回的是这个 EdgeOne 项目下所有访客的会话。访客 A 会看到访客 B 的对话标题。这条硬伤决定了服务端列表方案直接出局。
- 索引只存元数据，正文永远从 `/history` 拉。索引丢了最多丢「列表」，不丢内容。
- 上限 30 条，超出按 `updatedAt` 淘汰最旧的 **本地索引条目**（不删服务端数据，避免误删后无法恢复）。
- 兼容旧版：启动时若 `eo_chat_conversations` 不存在但 `eo_chat_conversation_id` 存在，用后者建一条 `{ title: "之前的对话" }`；随后 `restore()` 成功后若有首条用户消息，用其内容回填标题。
- 保留 `eo_chat_conversation_id` 作为「当前会话」指针，减少迁移改动面。

### 2. 删除要真正清服务端：新增 `action: 'delete'`

`/history` 增加分支：

```ts
if (body.action === 'delete') {
  await store.clearMessages({ conversationId: targetId });
  await store.deleteConversation?.(targetId);
  return json({ ok: true, deleted: targetId });
}
```

- 先 `clearMessages` 再 `deleteConversation`：前者在两版运行时都稳定存在，后者不存在时也不影响主要目的（清空消息）。
- 前端删除流程：先调 `/history action=delete`，**成功后再**从 localStorage 移除。反过来会出现「列表没了但数据还在」。
- 服务端失败时：只从列表里隐藏（标记 `hidden: true`），不静默删除本地条目，并在 UI 上提示「服务端删除失败，本次仅从列表隐藏」。

### 3. 标题与索引的纯逻辑放进 `src/utils/chat-core.ts`

导出并单测：

```ts
deriveTitle(firstUserText: string, fallback?: string): string
upsertConversation(list: ConversationMeta[], item: ConversationMeta, max?: number): ConversationMeta[]
removeConversation(list: ConversationMeta[], id: string): ConversationMeta[]
renameConversation(list: ConversationMeta[], id: string, title: string): ConversationMeta[]
touchConversation(list: ConversationMeta[], id: string, now?: number): ConversationMeta[]
parseHistoryMessages(raw: unknown): RestoredTurn[]   // 容错 + 从 content 里回捞图片
```

- `deriveTitle`：压平换行与连续空白 → 去首尾 → 超 24 个字符按码点截断（不能用 `slice` 切 emoji）→ 空串回落到 `fallback ?? "新对话"`。
- `upsertConversation` 必须返回**新数组**（Svelte 5 的 `$state` 依赖赋值触发），并按 `updatedAt` 倒序。
- 这些函数不碰 `localStorage` / `window`，组件里只做读写与调用。

### 4. 图片：客户端先压、服务端代理上传、消息里只留 URL

分三段：

**a) 客户端预处理**（`ChatPanel.svelte`，canvas 不抽纯函数）

- 支持 `image/png` `image/jpeg` `image/webp` `image/gif`；拒绝 `svg`（可执行脚本）与 `heic`
- 单张 ≤ 5MB，单条消息 ≤ 3 张
- 用 `createImageBitmap` + `OffscreenCanvas` 缩到最长边 1024px，导出 `image/jpeg` 质量 0.85；GIF 只取首帧
- 压缩失败（浏览器不支持）退回原图，但要重新做大小校验

**b) 上传走服务端代理**：新增 `cloud-functions/api/chat-image/[[default]].js`，路由 `/api/chat-image/`

```
POST /api/chat-image/upload   multipart/form-data { file }
  → 200 { url, name }
  → 400 { error }  类型/大小不合法
  → 429 { error }  超过限流
```

- token 从 `context.env.IMAGE_BED_TOKEN` 读，**不下发浏览器**。后台 `backend/src/admin/public/app.js:13-18` 现在是硬编码 token 让浏览器直传 —— 那是管理员专用页面，聊天页是访客可达的，不能照抄。
- 转发到 `IMAGE_BED_ENDPOINT`（默认沿用现有图床 `https://img-edgeone.acetaffy.mom/api/index.php`），字段名 `image`，带 `token`
- 上游超时 15s，超时/非 200/响应体里没有 `url` 都返回明确错误
- 限流：复用 stats 的 Blob 思路，键 `chat-upload/<sha1(ip)>`，每小时 10 次；超了 429
- 校验 `Content-Type` 与文件头（PNG/JPEG/WEBP/GIF magic bytes），不只看扩展名

**c) 消息只带 URL**

```ts
type Msg = { role: "user"; content: string; images?: string[] } | ...
```

- 持久化时 `content` 末尾追加 `\n\n![图片](url)`（每张一行），同时 `metadata: { images: string[] }`
- 回放优先用 `metadata.images`；运行时若 `getMessages` 不返回 metadata，就用正则从 content 回捞 `![](...)`，两条路都有兜底
- 正文预算用 `MAX_USER_TURN_CHARS` 只裁**文本**部分，图片 URL 另算（最多 3 条 × 约 100 字符）

### 5. 模型侧：只有「最新一轮」带图，且按能力降级

`agents/_multimodal.ts`（纯函数，无外部 import，可直接单测）：

```ts
export type OutgoingContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
export function buildUserContent(text: string, images: string[], visionOk: boolean): OutgoingContent
export function buildImageNote(images: string[], visionOk: boolean): string  // 无视觉能力时拼进文本的说明
```

规则：

| 场景 | 输出 |
|---|---|
| 无图 | `string`（与现状完全一致，零回归） |
| 有图 + `visionOk` | content array：1 个 `text` + N 个 `image_url`（**data URL**，base64 内联） |
| 有图 + `!visionOk` | 纯文本，末尾附「当前模型不能读图，以下是用户上传的图片链接：…」，并 emit `notice` |

- **为什么内联 base64 而不是直接传外链**：图床对第三方抓取没有保证，且 `image_url` 传远程 URL 会让模型侧再走一次外链抓取，失败原因不可观测。服务端把 URL 抓回来转 data URL，失败原因可控。
- 抓取：15s 超时、单张 ≤ 8MB（base64 后约 11MB）、失败则跳过该图并在文本里注明「该图加载失败」。
- **只有最新一轮带图**：历史轮次里的图片一律替换成 `[历史消息中的图片已省略]`。否则每一轮都要重新抓图 + 重新计费，3 张图 ≈ 3~5k tokens，多轮下来会挤爆 `MAX_HISTORY_TOKENS = 8000`。
- 服务端要区分「最新一轮」：`history` 数组里最后一个 `role === 'user'` 的下标。

### 6. 视觉能力探测：先乐观尝试，失败降级一次

顺序：

1. `AI_GATEWAY_VISION_MODEL` 已配置 → `visionOk = true`，图片轮用该模型（`runToolLoop` 增加可选 `model` 覆盖）
2. `AI_GATEWAY_VISION` 显式为 `'1'` / `'0'` → 作为强制开关
3. 都没有 → **乐观发送**；若上游返回 400 且错误体里出现 `image` / `content` / `multimodal` 等字样，则**重试一次纯文本 + `notice`**，并在本进程内记住 `visionOk = false`

- 不把探测做成启动期请求：冷启动多打一次上游、还可能因为限流误判。
- 附 `scripts/probe-vision.mjs`（手动跑，不进 CI）：发一张 1×1 PNG 的 data URL，打印模型名、HTTP 状态与是否接受图片，供人工决定要不要配 `AI_GATEWAY_VISION_MODEL`。

### 7. 新增 `notice` SSE 事件

```ts
{ type: 'notice', level: 'info' | 'warn', code: 'web_disabled' | 'vision_disabled' | 'image_failed', message: string }
```

- 在 `runToolLoop` 开头由 `/assistant` 按 `tavilyKey` / `visionOk` 决定性地发出（不是每轮都发，一次请求最多一条同类）
- 前端在消息列表顶部渲染成一条细条（`text-[0.7rem]`，复用 `--primary` 与 warning 色），可关闭
- 前端对未知 `type` 已经是静默忽略，加新类型不会让旧客户端报错

### 8. 联网能力：代码不动，只补环境变量

- 线上缺 `WSA_SECRET_ID` / `WSA_SECRET_KEY`。补上后 `buildSystemPrompt` 的 `webEnabled` 分支自动生效，`web_search` 立刻可用 —— 已用同一份代码本地验证过工具链路（站内检索线上可调通，说明 loop 与 SSE 正常）。
- 用的是腾讯云云 API 密钥对 `WSA_SECRET_ID` / `WSA_SECRET_KEY` + **TC3-HMAC-SHA256 签名**，端点是 `wsa.tencentcloudapi.com`。
  有另一条 Bearer + 服务 API KEY 的路（`api.wsa.cloud.tencent.com`，平台内置 `context.tools.web_search` 用它），但那个 key 要单独申请；
  这里选 TC3 是为了复用账号已有的密钥对，代价是手写四步签名（`agents/_wsa.ts` 的 `sign()`，用 WebCrypto，不引包）。
- **这是人工步骤**：需要 EdgeOne 控制台（或 `edgeone makers env set WSA_SECRET_ID ... -e production` 与 `WSA_SECRET_KEY`）与腾讯云 Web 搜索 API 账号（未开通会返回 `ResourceNotFound`）。NPC 没有该 token，必须由仓库所有者执行，任务里单列。
- `read_page` 已随 Tavily 一起下线：元宝搜索只返回摘要（`passage` / `content`），不提供抓取正文的接口。system prompt 里已明确告知模型「你只有摘要」，要求它在细节不足时如实说明而不是假装读过原文。

### 9. 上传与删除的界面位置

`ChatPanel.svelte` 头部按钮从「新对话」扩展为：会话列表按钮（抽屉）→ 新对话 → 溢出菜单。抽 `src/components/chat/ChatHistory.svelte`：

- 抽屉/浮层列出 `eo_chat_conversations`，每项显示标题 + 相对时间
- 每项右侧：重命名（双击或铅笔图标）、删除（垃圾桶，二次确认）
- 流式生成中禁用全部操作；切换会话前若正在流式，先 `stop()`
- 亮/暗双主题、移动端全屏、Esc 关闭

### 10. 输入框交互细节

- 粘贴：只在 `clipboardData.files` / `items` 里有图片时接管，纯文本粘贴保持默认行为
- 拖拽：整个聊天卡片是 dropzone，dragover 时加一层虚线高亮；拖出后移除
- 预览：输入框上方一行缩略图（64×64，圆角），右上角 × 移除；上传中显示骨架与进度态
- 发送时严格按「文本非空 **或** 至少一张已上传成功的图片」判断；上传没完成时禁用发送并显示「图片上传中…」
- **失败的那一轮不要把 user 消息留在要提交的历史里**（沿用现有 `mirror.length = 0` 的清理逻辑，图片消息同样适用）

## Risks / Trade-offs

- **`getMessages` 是否返回 `metadata` 未在文档中明确**：所以正文里同时留 Markdown 图片链接做兜底。若运行时不返回 metadata，回放靠正则，成本是多一次字符串处理。
- **localStorage 索引会丢**（清缓存 / 换设备 / 无痕模式）：接受。正文仍在服务端，只是无法从列表找回 —— 与现状（只有一个 id）相比不更差。
- **最多 30 条索引**：超出只淘汰本地条目，不删服务端，避免误删。代价是服务端会累积孤儿会话；后续可加「清理 90 天未访问」的可选任务（不在本次范围）。
- **base64 图片吃 token**：1024px JPEG ≈ 1000~1500 tokens/张，3 张约 4k。只在最新一轮发送 + 单轮最多 3 张 + 1024px 上限，三重约束控制。取值偏保守，宁可清楚也不要糊。
- **模型是否支持视觉未知**：`@makers/deepseek-v4-flash` 文档未声明多模态。设计上做成「能则用、不能则明确告知」，不会因为猜错而白屏或静默失败。
- **图床 token 泄露面**：聊天页可被任意访客调用上传，代理层必须限流 + 类型校验。若图床被滥用，可随时把 `IMAGE_BED_ENDPOINT` 换掉而不动前端。
- **跨标签页同步**：`storage` 事件监听会让两个标签页的列表一致，但「当前会话」各自独立。不做更复杂的同步。
- **`/stop` 与文档冲突**：平台文档说 `/stop` 不要带 `makers-conversation-id`，而现有代码（`ChatPanel.svelte:288-295`、`FindAgent.svelte:343-351`）明确带上了，理由是「不带会在进 handler 前 400」。实测线上带 header 是可用的，本次**保持不动**，只在新代码里复用同一写法，避免引入未验证的回归。
