import { createDsmlFilter, sseEvent } from './_shared';
import { chatCompletionsUrl, modelName, type AgentEnv } from './_model';

/**
 * 手写的 OpenAI 风格 tool loop —— 刻意不引任何三方包（deepagents / langchain 那套在这台
 * 运行时上会在加载期崩，见 _model.ts 的注释），直接 fetch 打 AI Gateway。
 *
 * 事件按平台 SSE 协议发，但把标准字段不够用的地方补全了：协议里 tool_call 只有 name，
 * 前端却要显示「调用的是什么、参数是什么、回来了什么」，所以额外带上 id / arguments /
 * summary / content。运行时只做透传，不校验字段。
 */

export interface ToolResult {
	/** 一句话结果摘要，给界面上的工具片段当标题用（如「命中 3 篇」） */
	summary: string;
	/** 工具返回的完整结果（JSON 字符串），既发给前端展示，也回灌给模型（回灌时会按预算截断） */
	content: string;
}

export interface ToolDef {
	name: string;
	description: string;
	/** JSON Schema */
	parameters: Record<string, unknown>;
	/**
	 * 这条工具的结果回灌进模型上下文时的字符上限。默认走 MAX_TOOL_RESULT_CHARS；
	 * read_article 这类「结果本身就是一整篇正文」的工具会调大 —— 界面上拿到的仍是完整结果。
	 */
	maxResultChars?: number;
	run: (args: Record<string, unknown>, ctx: unknown) => Promise<ToolResult> | ToolResult;
}

/**
 * 回灌给模型的一条历史。
 *
 * content 默认还是字符串 —— 纯文本对话的行为字节级不变。只有「本轮带图且模型能读图」时，
 * 才会是一条 content array（见 _multimodal.ts 的 buildUserContent），这里刻意不 import
 * 那个模块的类型：本文件顶层不新增任何 import，否则整包可能加载期就崩。
 */
export interface HistoryMessage {
	role: 'user' | 'assistant';
	content: string | Record<string, unknown>[];
}

/** 运行时提示：发在正文之前，前端渲染成消息区顶部的一条细提示 */
export interface LoopNotice {
	level: 'info' | 'warn';
	code: 'web_disabled' | 'vision_disabled' | 'image_failed';
	message: string;
}

interface ToolCallAcc {
	id: string;
	name: string;
	args: string;
}

interface GatewayChunk {
	choices?: {
		delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] };
		finish_reason?: string | null;
	}[];
	usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
}

/** 单轮最多执行几个并行工具调用（模型可能一次发一堆） */
const MAX_TOOL_CALLS_PER_TURN = 4;
/** 单条工具结果回灌进模型上下文时的字符上限（ToolDef.maxResultChars 可单条覆盖） */
const MAX_TOOL_RESULT_CHARS = 4_000;
/** 整个请求里工具结果累计进上下文的字符上限，超了丢最早的（maxToolContextChars 可覆盖） */
const MAX_TOOL_CONTEXT_CHARS = 20_000;
const OMITTED_NOTE = '[更早的检索结果已省略]';

export interface ToolLoopOptions {
	env: AgentEnv;
	system: string;
	history: HistoryMessage[];
	tools: ToolDef[];
	/** 每个请求一份的可变状态，原样传给工具的 run() */
	ctx?: unknown;
	signal?: AbortSignal;
	/** 含最后一次「不给工具」的收尾轮 */
	maxIterations?: number;
	/** 整轮工具结果累计进上下文的字符上限，默认 MAX_TOOL_CONTEXT_CHARS */
	maxToolContextChars?: number;
	/** 逐字追加所有外发文字，路由用它写会话历史（见 find/index.ts 的 collector） */
	collector?: { text: string };
	/** 本轮覆盖模型名（比如图片轮换到视觉模型）；不传就走 env 里的默认模型 */
	model?: string;
	/** 首轮模型调用前发给前端的运行态提示 */
	notices?: LoopNotice[];
	/** 视觉能力被上游否掉时回调一次（路由用它把 visionOk=false 记进进程内） */
	onVisionUnsupported?: () => void;
	logger?: { log(...args: unknown[]): void; error(...args: unknown[]): void };
}

// 逐块解析上游 SSE：每个事件形如 "data: {...}\n\n"，以 "data: [DONE]" 结束
async function* readGatewayStream(resp: Response, signal?: AbortSignal) {
	const reader = resp.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	while (true) {
		if (signal?.aborted) break;
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let idx: number;
		while ((idx = buffer.indexOf('\n')) !== -1) {
			const line = buffer.slice(0, idx).trim();
			buffer = buffer.slice(idx + 1);
			if (!line.startsWith('data:')) continue;
			const payload = line.slice(5).trim();
			if (!payload || payload === '[DONE]') continue;
			try {
				yield JSON.parse(payload) as GatewayChunk;
			} catch {
				// 上游偶发的心跳/注释行
			}
		}
	}
}

function toGatewayTool(tool: ToolDef) {
	return {
		type: 'function',
		function: { name: tool.name, description: tool.description, parameters: tool.parameters },
	};
}

function pushToolCalls(calls: ToolCallAcc[], deltas: NonNullable<GatewayChunk['choices']>[number]['delta']): void {
	for (const tc of deltas?.tool_calls ?? []) {
		const idx = typeof tc.index === 'number' ? tc.index : calls.length;
		if (!calls[idx]) calls[idx] = { id: '', name: '', args: '' };
		const slot = calls[idx];
		if (tc.id) slot.id = tc.id;
		if (tc.function?.name) slot.name = tc.function.name;
		if (tc.function?.arguments) slot.args += tc.function.arguments;
	}
}

/**
 * 工具结果进上下文前的预算裁剪：单条按该工具的上限截断 + 累计超限时丢最早的。
 * 只动「喂给模型」的那条 message —— tool_result 事件里给界面的始终是完整结果。
 */
function applyToolBudget(
	messages: unknown[],
	toolMessages: { index: number; cap: number }[],
	totalCap: number,
): void {
	const entries = toolMessages.map(({ index, cap }) => {
		const m = messages[index] as { role: string; content: string };
		if (m.content.length > cap) m.content = `${m.content.slice(0, cap)}\n…（结果过长已截断）`;
		return m;
	});
	let total = entries.reduce((n, m) => n + m.content.length, 0);
	for (const m of entries) {
		if (total <= totalCap) break;
		if (m.content === OMITTED_NOTE) continue;
		total -= m.content.length - OMITTED_NOTE.length;
		m.content = OMITTED_NOTE;
	}
}

/**
 * 上游 400 是不是「带了图我不认识」。跟 _multimodal.ts 的 isVisionRejection 同一套判定，
 * 但这里不能再 import（顶层 import 限制），所以内联一份最小实现。
 */
function looksLikeVisionRejection(status: number, detail: string): boolean {
	if (status !== 400 && status !== 422) return false;
	const text = detail.toLowerCase();
	if (!text) return false;
	if (/image_url|multimodal|multi-modal|vision|image input/.test(text)) return true;
	return /content/.test(text) && /(image|array|string|invalid|unsupported)/.test(text);
}

/** 把一条 content array 压回纯文本（降级重试用）：图片换成链接，其余文字照留 */
function degradeMessages(messages: Record<string, unknown>[]): void {
	for (const m of messages) {
		if (typeof m.content === 'string') continue;
		const parts = Array.isArray(m.content) ? m.content : [];
		const texts: string[] = [];
		const links: string[] = [];
		for (const part of parts) {
			const p = part as { type?: string; text?: string; image_url?: { url?: string } };
			if (p?.type === 'text' && typeof p.text === 'string') texts.push(p.text);
			else if (p?.type === 'image_url' && typeof p.image_url?.url === 'string') links.push(p.image_url.url);
		}
		if (links.length) {
			texts.push('（当前模型不能读图，以下图片没能一起发出去）', ...links.map((u) => `- ${u}`));
		}
		m.content = texts.join('\n\n').trim();
	}
}

function hasArrayContent(messages: Record<string, unknown>[]): boolean {
	return messages.some((m) => Array.isArray(m.content));
}

export async function* runToolLoop(opts: ToolLoopOptions): AsyncGenerator<string> {
	const { env, system, history, tools, ctx, signal } = opts;
	const turnModel = opts.model?.trim() || modelName(env);
	const maxIterations = Math.max(2, opts.maxIterations ?? 4);
	const logger = opts.logger ?? { log() {}, error() {} };
	const collector = opts.collector;
	const toolsByName = new Map(tools.map((t) => [t.name, t]));
	const messages: Record<string, unknown>[] = [
		{ role: 'system', content: system },
		...history.map((m) => ({ role: m.role, content: m.content })),
	];
	/** 每条工具消息在 messages 里的下标 + 它回灌模型时的字符上限 */
	const toolMessages: { index: number; cap: number }[] = [];
	const usage = { input: 0, output: 0 };
	let rounds = 0;
	let toolCalls = 0;

	for (const notice of opts.notices ?? []) {
		yield sseEvent({ type: 'notice', level: notice.level, code: notice.code, message: notice.message });
	}

	for (let round = 0; round < maxIterations; round++) {
		// 最后一轮不给工具，保证用户一定拿到一句最终回答
		const allowTools = round < maxIterations - 1;
		rounds = round + 1;

		let text = '';
		const calls: ToolCallAcc[] = [];
		const dsml = createDsmlFilter();

		try {
			const body: Record<string, unknown> = {
				model: turnModel,
				messages,
				temperature: 0,
				stream: true,
				stream_options: { include_usage: true },
			};
			if (allowTools) {
				body.tools = tools.map(toGatewayTool);
				body.tool_choice = 'auto';
			}

			let resp = await fetch(chatCompletionsUrl(env), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${env.AI_GATEWAY_API_KEY}`,
				},
				body: JSON.stringify(body),
				signal,
			});

			// 视觉降级：乐观发出去，上游说「这条消息里的图我不认识」就压回纯文本重试一次。
			// 降级后 messages 里不再有 content array，后面轮次不会再进这个分支。
			if (!resp.ok && hasArrayContent(messages)) {
				const detail = await resp.text().catch(() => '');
				if (looksLikeVisionRejection(resp.status, detail)) {
					logger.log('vision rejected (%d), retrying as plain text', resp.status);
					degradeMessages(messages);
					if (opts.onVisionUnsupported) opts.onVisionUnsupported();
					yield sseEvent({
						type: 'notice',
						level: 'warn',
						code: 'vision_disabled',
						message: '当前模型读不了图，这次先把图片链接发过去，用文字继续聊。',
					});
					resp = await fetch(chatCompletionsUrl(env), {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Bearer ${env.AI_GATEWAY_API_KEY}`,
						},
						body: JSON.stringify({ ...body, messages }),
						signal,
					});
				}
			}
			if (!resp.ok || !resp.body) {
				const detail = await resp.text().catch(() => '');
				throw new Error(`AI Gateway ${resp.status}: ${detail.slice(0, 300)}`);
			}

			for await (const chunk of readGatewayStream(resp, signal)) {
				if (signal?.aborted) break;
				const delta = chunk.choices?.[0]?.delta;
				if (delta) {
					const piece = delta.content ? dsml.feed(delta.content) : '';
					if (piece) {
						text += piece;
						if (collector) collector.text += piece;
						yield sseEvent({ type: 'ai_response', content: piece });
					}
					pushToolCalls(calls, delta);
				}
				if (chunk.usage) {
					usage.input += chunk.usage.prompt_tokens ?? 0;
					usage.output += chunk.usage.completion_tokens ?? 0;
				}
			}
			const tail = dsml.flush();
			if (tail) {
				text += tail;
				if (collector) collector.text += tail;
				yield sseEvent({ type: 'ai_response', content: tail });
			}
			if (dsml.hits) logger.log('stripped %d DSML marker(s)', dsml.hits);
		} catch (e) {
			const err = e as Error;
			if (err.name === 'AbortError' || signal?.aborted) {
				// 用户点了停止：已吐出的内容照常收尾
			} else {
				logger.error('model call failed', err.message);
				yield sseEvent({ type: 'error_message', content: err.message });
			}
			break;
		}

		const pending = calls.filter(Boolean);
		if (!allowTools || !pending.length) break; // 有最终回答，收工

		// 超过单轮上限的调用：不执行，但如实回灌一条说明，模型才知道自己被截了
		const executable = pending.slice(0, MAX_TOOL_CALLS_PER_TURN);
		const skipped = pending.slice(MAX_TOOL_CALLS_PER_TURN);

		for (const call of pending) {
			yield sseEvent({ type: 'tool_call', id: call.id, name: call.name, arguments: call.args });
		}

		messages.push({
			role: 'assistant',
			content: text,
			// 所有调用都要列在这里（包括因为超上限没执行的），
			// 否则后面的 tool 消息会指向一个 assistant 没声明过的 id，上游会报 400
			tool_calls: pending.map((c) => ({
				id: c.id,
				type: 'function',
				function: { name: c.name, arguments: c.args },
			})),
		});

		for (const call of executable) {
			toolCalls += 1;
			let summary: string;
			let content: string;
			let ok = true;
			try {
				const tool = toolsByName.get(call.name);
				if (!tool) throw new Error(`未知工具：${call.name}`);
				const args = call.args.trim() ? JSON.parse(call.args) : {};
				const result = await tool.run(args as Record<string, unknown>, ctx);
				summary = result.summary;
				content = result.content;
			} catch (e) {
				const msg = (e as Error).message || String(e);
				ok = false;
				summary = `调用失败：${msg}`;
				content = JSON.stringify({ error: msg });
				logger.error('tool %s failed: %s', call.name, msg);
			}
			// 前端看到完整结果；模型只拿到截断后的版本
			yield sseEvent({ type: 'tool_result', id: call.id, name: call.name, ok, summary, content });
			messages.push({ role: 'tool', tool_call_id: call.id, content });
			toolMessages.push({
				index: messages.length - 1,
				cap: toolsByName.get(call.name)?.maxResultChars ?? MAX_TOOL_RESULT_CHARS,
			});
		}

		for (const call of skipped) {
			yield sseEvent({
				type: 'tool_result',
				id: call.id,
				name: call.name,
				ok: false,
				summary: `本轮调用数超上限（${MAX_TOOL_CALLS_PER_TURN}），已跳过`,
				content: JSON.stringify({ error: 'too many tool calls in one turn' }),
			});
			messages.push({
				role: 'tool',
				tool_call_id: call.id,
				content: JSON.stringify({ error: `本轮最多 ${MAX_TOOL_CALLS_PER_TURN} 个调用，这条被跳过了` }),
			});
			toolMessages.push({ index: messages.length - 1, cap: MAX_TOOL_RESULT_CHARS });
		}

		applyToolBudget(messages, toolMessages, opts.maxToolContextChars ?? MAX_TOOL_CONTEXT_CHARS);
	}

	yield sseEvent({
		type: 'usage',
		input_tokens: usage.input,
		output_tokens: usage.output,
		total_tokens: usage.input + usage.output,
	});
	logger.log('loop done rounds=%d toolCalls=%d in=%d out=%d', rounds, toolCalls, usage.input, usage.output);
	yield 'data: [DONE]\n\n';
}
