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
	run: (args: Record<string, unknown>, ctx: unknown) => Promise<ToolResult> | ToolResult;
}

export interface HistoryMessage {
	role: 'user' | 'assistant';
	content: string;
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
/** 单条工具结果回灌进模型上下文时的字符上限 */
const MAX_TOOL_RESULT_CHARS = 4_000;
/** 整个请求里工具结果累计进上下文的字符上限，超了丢最早的 */
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
	/** 逐字追加所有外发文字，路由用它写会话历史（同 learn 的 collector） */
	collector?: { text: string };
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

/** 工具结果进上下文前的预算裁剪：单条截断 + 累计超限时丢最早的 */
function applyToolBudget(messages: unknown[], toolMessageIndexes: number[]): void {
	const toolMessages = toolMessageIndexes.map((i) => messages[i] as { role: string; content: string });
	let total = toolMessages.reduce((n, m) => n + m.content.length, 0);
	for (const m of toolMessages) {
		if (total <= MAX_TOOL_CONTEXT_CHARS) break;
		if (m.content === OMITTED_NOTE) continue;
		total -= m.content.length - OMITTED_NOTE.length;
		m.content = OMITTED_NOTE;
	}
}

export async function* runToolLoop(opts: ToolLoopOptions): AsyncGenerator<string> {
	const { env, system, history, tools, ctx, signal } = opts;
	const maxIterations = Math.max(2, opts.maxIterations ?? 4);
	const logger = opts.logger ?? { log() {}, error() {} };
	const collector = opts.collector;
	const toolsByName = new Map(tools.map((t) => [t.name, t]));
	const messages: Record<string, unknown>[] = [
		{ role: 'system', content: system },
		...history.map((m) => ({ role: m.role, content: m.content })),
	];
	const toolMessageIndexes: number[] = [];
	const usage = { input: 0, output: 0 };
	let rounds = 0;
	let toolCalls = 0;

	for (let round = 0; round < maxIterations; round++) {
		// 最后一轮不给工具，保证用户一定拿到一句最终回答
		const allowTools = round < maxIterations - 1;
		rounds = round + 1;

		let text = '';
		const calls: ToolCallAcc[] = [];
		const dsml = createDsmlFilter();

		try {
			const body: Record<string, unknown> = {
				model: modelName(env),
				messages,
				temperature: 0,
				stream: true,
				stream_options: { include_usage: true },
			};
			if (allowTools) {
				body.tools = tools.map(toGatewayTool);
				body.tool_choice = 'auto';
			}

			const resp = await fetch(chatCompletionsUrl(env), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${env.AI_GATEWAY_API_KEY}`,
				},
				body: JSON.stringify(body),
				signal,
			});
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
			messages.push({ role: 'tool', tool_call_id: call.id, content: content.slice(0, MAX_TOOL_RESULT_CHARS) });
			toolMessageIndexes.push(messages.length - 1);
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
			toolMessageIndexes.push(messages.length - 1);
		}

		applyToolBudget(messages, toolMessageIndexes);
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
