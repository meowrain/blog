## Why

站内 AI 助手（`/chat/`）已经能聊天、翻站内文章，但三件事卡着它从「能聊」变成「能用」：

1. **只能有一个会话**。前端只在 localStorage 里存一个 `eo_chat_conversation_id`，点「新对话」等于把旧 id 丢掉 —— 旧消息留在服务端成为永久孤儿，再也取不回来，用户也没法回头找上周问过的内容。
2. **不能发图**。报错截图、设计稿、数学题截图都只能打字描述，而聊天助手最常见的场景之一就是「这图里哪错了」。
3. **联网搜不了**。`web_search` 工具代码完整，但线上没配搜索 API KEY，system prompt 会直接告诉模型「别调」，实测只会触发站内检索。（注：已经由 Tavily 换成腾讯云元宝搜索，变量名为 `WSA_SECRET_ID` / `WSA_SECRET_KEY`；`read_page` 因元宝不提供抓正文接口已下线。）

三者里第 3 条是纯配置问题（改代码没用），前两条需要前端、agent、云函数三层配合。

## What Changes

- 新增**会话列表**：localStorage 存轻量索引（id / 标题 / 时间），消息正文仍以服务端 store 为准；支持切换、重命名、删除；「新对话」不再丢旧会话
- 补上 `/history` 的 `action: 'clear'` 前端调用（服务端已实现、前端从未用过）
- 新增**图片输入**：粘贴 / 拖拽 / 选择文件，最多 3 张；经服务端代理上传到现有图床（token 不下发浏览器）；消息模型升级为 `images?: string[]`
- agent 侧支持 OpenAI 风格的多模态 content array，并在模型不支持 vision 时**降级为文本链接 + 明确告知**，不静默失败
- 新增统一 `notice` SSE 事件，承载「本次没有联网能力」「当前模型不能读图」这类可展示的运行态提示
- 新增 `src/utils/chat-core.ts`（纯函数：索引增删改、标题截断、图片校验）与对应单测
- 联网能力：**不改代码**，只在 EdgeOne 项目环境变量里补 `WSA_SECRET_ID` / `WSA_SECRET_KEY`（人工执行），再用 `notice` 让用户知道当前是否联网

## Capabilities

### New Capabilities

- `chat-conversation-list`: 会话索引的本地持久化、切换、重命名、删除、上限裁剪与旧 id 迁移
- `chat-image-input`: 图片选择/粘贴/拖拽、校验、服务端代理上传、消息携带与历史回放
- `chat-runtime-notice`: 运行态能力提示（联网 / 读图）通过 SSE 透传给前端

### Modified Capabilities

- `chat-assistant`: `/assistant` 接受带图片的消息，按模型能力构造 content array；`/history` 的 clear 分支被真正调用

## Impact

- 修改：`src/components/chat/ChatPanel.svelte`、`agents/assistant/index.ts`、`agents/_agent-loop.ts`、`cloud-functions/history/index.ts`
- 新增：`src/components/chat/ChatHistory.svelte`、`src/utils/chat-core.ts`、`tests/chat-core.test.ts`、`cloud-functions/api/chat-image/[[default]].js`、`scripts/probe-vision.mjs`
- 配置：EdgeOne 环境变量 `WSA_SECRET_ID`、`WSA_SECRET_KEY`、`IMAGE_BED_ENDPOINT`、`IMAGE_BED_TOKEN`；`.env.example` 同步
- 不引入新依赖（上传用内置 `FormData` / `Blob`，不引 `openai` SDK）
