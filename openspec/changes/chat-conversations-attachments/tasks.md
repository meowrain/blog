## 0. 前置（人工，NPC 无法完成）

- [ ] 0.1 在[腾讯云访问管理](https://console.cloud.tencent.com/cam/capi)确认 API 密钥对可用、账号已开通元宝搜索服务，把 **SecretId / SecretKey** 写入 EdgeOne 项目环境变量 `WSA_SECRET_ID` / `WSA_SECRET_KEY`（production）。验证：`POST /assistant` 带「今天有什么 AI 新闻」时出现 `type:"tool_call", name:"web_search"`。客户端走 TC3-HMAC-SHA256 签名（见 `agents/_wsa.ts` 的 `sign()`）
- [ ] 0.2 配置 `IMAGE_BED_TOKEN`（沿用后台现有图床 token）与可选 `IMAGE_BED_ENDPOINT`。**不要**把 token 写进任何前端文件
- [ ] 0.3 跑 `node scripts/probe-vision.mjs`，把输出贴到 Issue：确认 `@makers/deepseek-v4-flash` 是否接受 `image_url`。接受则跳过 0.4
- [ ] 0.4 若模型不支持视觉：配置 `AI_GATEWAY_VISION_MODEL` 指向视觉模型；找不到可用模型则明确回帖「本次只交付文本降级路径」

> 0.1 与 0.2 没完成也能合代码：跑 `pnpm test` / `pnpm build` 不受影响，线上表现为发图返回 503「上传未配置」、联网走 `notice` 提示。

## 1. 纯逻辑与单测

- [ ] 1.1 新增 `src/utils/chat-core.ts`，导出 `ConversationMeta` 类型与 `deriveTitle` / `upsertConversation` / `removeConversation` / `renameConversation` / `touchConversation` / `parseHistoryMessages`
- [ ] 1.2 `deriveTitle`：压缩空白、按码点截断 24 字、空串回落；补测中文、emoji（`Array.from` 切分）、超长 ASCII
- [ ] 1.3 `upsertConversation`：返回新数组、按 `updatedAt` 倒序、超过 `max`（默认 30）淘汰最旧且不抛错；补测同 id 覆盖不重复
- [ ] 1.4 `parseHistoryMessages`：容错非数组/缺字段；优先读 `metadata.images`，缺失时从 content 用 `/!\[[^\]]*\]\(([^)]+)\)/g` 回捞；补测两种路径与「都读不到」返回空数组
- [ ] 1.5 新增 `agents/_multimodal.ts`，导出 `buildUserContent` / `buildImageNote` / `pickModelForTurn`
- [ ] 1.6 `buildUserContent`：无图返回 `string`（严格等于入参文本）；有图 + `visionOk` 返回 content array 且第一个元素是 `text`；有图 + `!visionOk` 返回纯文本且含图片 URL 与「不能读图」字样
- [ ] 1.7 新增 `tests/chat-core.test.ts`，用 `node:test` + `node:assert/strict`，覆盖 1.2~1.4、1.6。跑 `pnpm test` 全绿

## 2. 会话列表

- [ ] 2.1 新增 `src/components/chat/ChatHistory.svelte`：接收 `conversations` / `currentId` / `busy`，抛出 `select` / `rename` / `remove` / `close` 事件；亮暗主题 + 移动端全屏 + Esc 关闭
- [ ] 2.2 `ChatPanel.svelte` 引入索引：`eo_chat_conversations` 读写封装在组件内，纯逻辑走 1.1；保留 `eo_chat_conversation_id` 作为当前指针
- [ ] 2.3 旧数据迁移：有 `eo_chat_conversation_id` 无索引时建一条 `{ title: "之前的对话" }`；`restore()` 成功后用首条用户消息回填标题
- [ ] 2.4 `newChat()`：先把当前会话 `touch` 进索引并写回，再 `rotateConversationId()`；**不再丢失旧会话**
- [ ] 2.5 首条用户消息发出时 `upsert` 索引（标题取 `deriveTitle(question)`），流式过程中切换失效
- [ ] 2.6 切换会话：`stop()` → 清 `mirror` 与 `msgs` → 设当前指针 → `restore()`；不允许在 `streaming` 时切换
- [ ] 2.7 重命名：内联输入框，Enter 确认 / Esc 取消；空标题回落到旧值
- [ ] 2.8 删除：二次确认 → `POST /history {action:'delete'}` → 成功后从索引移除；失败则标记 `hidden` 并 toast「服务端删除失败，已从列表隐藏」
- [ ] 2.9 监听 `window.storage` 事件，其他标签页改动索引时同步列表；不改变各自当前会话
- [ ] 2.10 头部 UI：会话列表入口 + 新对话 + 溢出菜单，`streaming` 时全部禁用

## 3. `/history` 云函数

- [ ] 3.1 `cloud-functions/history/index.ts` 增加 `action: 'delete'` 分支：先 `clearMessages`，再尝试 `deleteConversation?.()`，任一步失败都返回 `{ok:false,error}`
- [ ] 3.2 保持既有签名不变（单对象 `{conversationId}`），不接受两参数写法
- [ ] 3.3 补 `action` 白名单校验：未知 action 返回 400，不落到默认读取分支

## 4. 图片上传

- [ ] 4.1 新增 `cloud-functions/api/chat-image/[[default]].js`：`POST /api/chat-image/upload` 接收 `multipart/form-data` 的 `file`
- [ ] 4.2 校验：magic bytes（PNG/JPEG/WEBP/GIF）、单张 ≤ 5MB、`image/*` 白名单（含 `image/heic` 拒绝）
- [ ] 4.3 转发到 `IMAGE_BED_ENDPOINT`（env，缺省现有图床），字段 `image`，带 `IMAGE_BED_TOKEN`；15s 超时
- [ ] 4.4 响应归一：上游 `{url}` 非空才算成功；否则 502 并带上游 message 片段
- [ ] 4.5 限流：Blob 键 `chat-upload/<sha1(ip)>`，每小时 10 次，超限 429；`getStore({name, consistency:'strong'})`
- [ ] 4.6 环境变量缺失时返回 503 `{error:'图片上传未配置'}`，前端可读
- [ ] 4.7 `ChatPanel.svelte` 接入：粘贴（`clipboardData.files`/`items` 有图时接管）、拖拽（整个卡片 dropzone + 虚线高亮）、文件选择
- [ ] 4.8 客户端压缩：`createImageBitmap` + `OffscreenCanvas` 最长边 1024、JPEG q=0.85；不支持时退回原图并重新校验大小
- [ ] 4.9 输入框上方缩略图条：64×64、右上角移除、上传中骨架；上传完成前禁用发送
- [ ] 4.10 `Msg` 类型加 `images?: string[]`；发送条件改为「文本非空 或 有已上传图片」
- [ ] 4.11 失败轮次清理沿用 `mirror.length = 0`；已上传但未发出的图片在失败后保留在输入框，可重发

## 5. agent 多模态

- [ ] 5.1 `agents/assistant/index.ts`：请求体新增 `images?: string[]`（本轮图片），历史消息放宽为 `content: string` + 可选 `images`
- [ ] 5.2 构造 `kept` 历史时：仅最后一个 `user` 轮保留图片，其余替换为 `[历史消息中的图片已省略]`；图片 URL 不计入 `MAX_USER_TURN_CHARS`
- [ ] 5.3 新增 `fetchImageAsDataUrl(url, signal)`：15s 超时、≤8MB、失败返回 `null`；失败图在文本里注明
- [ ] 5.4 `runToolLoop` 的 `history` 类型放宽为 `{role, content: OutgoingContent}`；无图路径必须与现状字节级一致
- [ ] 5.5 `runToolLoop` 增加可选 `model` 覆盖；`pickModelForTurn` 决定本轮用默认模型还是 `AI_GATEWAY_VISION_MODEL`
- [ ] 5.6 视觉降级：上游 400 且错误体含 `image`/`content`/`multimodal` 时，重试一次纯文本 + 发 `notice{code:'vision_disabled'}`，进程内缓存 `visionOk=false`
- [ ] 5.7 持久化：`content` 末尾追加 `![图片](url)` 每张一行，`metadata:{images}`；`/history` 读取侧不变
- [ ] 5.8 `MAX_USER_TURN_CHARS` 裁剪只作用于文本；图片 URL 单独计数，最多 3 条

## 6. 运行态提示

- [ ] 6.1 `agents/_agent-loop.ts` 增加 `notice(level, code, message)` 入参，在首轮开始前 yield 一条 `{type:'notice', ...}`
- [ ] 6.2 `assistant/index.ts` 按 `tavilyKey` 发 `web_disabled`，按 `visionOk` 发 `vision_disabled`
- [ ] 6.3 修改 `buildSystemPrompt` 无联网分支文案：「本次未启用联网」而非「会直接失败」
- [ ] 6.4 `ChatPanel.svelte` 处理 `notice`：消息区顶部细条，可关闭；未知 type 仍静默忽略

## 7. 部署脚本与配置

- [ ] 7.1 新增 `scripts/probe-vision.mjs`：读 `AI_GATEWAY_*`，发 1×1 PNG base64，打印模型名 / HTTP 状态 / 是否接受；非 0 退出码表示失败（仅手动运行，不进 CI）
- [ ] 7.2 `.env.example` 补 `IMAGE_BED_ENDPOINT` / `IMAGE_BED_TOKEN` / `AI_GATEWAY_VISION_MODEL` / `AI_GATEWAY_VISION`，并注明「Tavily 未配时联网自动关闭」
- [ ] 7.3 `README.md` 的 AI 助手段补一段：会话列表存在本地、图片上限、联网所需环境变量

## 8. 验证

- [ ] 8.1 `pnpm test` 全绿；新增用例覆盖 1.2~1.4、1.6
- [ ] 8.2 `pnpm type-check` 无新增报错
- [ ] 8.3 `pnpm lint` 与 `pnpm format` 后工作区干净（Biome 无 diff）
- [ ] 8.4 `pnpm build` 成功；`dist/chat/index.html` 存在
- [ ] 8.5 本地 `edgeone makers dev` 手测：建 3 个会话 → 刷新 → 列表还在 → 切换 → 历史正确；删除后服务端 `/history` 返回空
- [ ] 8.6 手测发图：粘贴 1 张、拖拽 2 张、发 4 张被拒；超过 5MB 被拒；上传中发送被禁用
- [ ] 8.7 未配 `WSA_SECRET_ID` / `WSA_SECRET_KEY` 时：页面顶部出现「本次未启用联网」提示，且没有 `web_search` 调用
- [ ] 8.8 未配视觉模型时：发图后仍能得到回答，文本里带图片链接与「不能读图」说明，不白屏
- [ ] 8.9 移动端 375px 宽：会话抽屉全屏、缩略图不溢出、发送按钮不被遮挡
- [ ] 8.10 PR 描述贴出 8.1~8.4 的命令输出与 8.5~8.8 的手测记录；已知限制（0.3 未确认前的视觉降级）写清楚
