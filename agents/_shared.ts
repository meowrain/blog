export function createLogger(name: string) {
	return {
		log(...args: unknown[]) { console.log(`[${name}][${new Date().toISOString()}]`, ...args); },
		error(...args: unknown[]) { console.error(`[${name}][${new Date().toISOString()}]`, ...args); },
	};
}

// ── DeepSeek 工具调用标记清洗 ────────────────────────────────────────────
// gateway 默认模型是 DeepSeek 系（见 _model.ts）。它的 tool call 偶尔不以
// tool_call_chunks 出现，而是把 DSML 标记当正文吐出来（review-checklist F：
// Path A 必须对外发文本做 stripDSML）。正则参考 DeepSeek-V3.1/V3.2 的
// ChatML 扩展标记：`<｜tool▁calls▁begin｜>` 一类的全角竖线包裹 token。
const DSML_TOKEN_RE = /<｜[^<>｜]{0,64}｜>/g;

// 逐 token 流式输出时，标记会被切成两半分两次到达，所以任何像「标记开头」的
// 结尾都要先扣住，等下一个 chunk 拼上再判断，否则半个标记会漏到用户屏幕上。
const DSML_PARTIAL_TAIL_RE = /<｜[^<>]{0,64}$/;

/** 一次性清洗整段文本（写 store / 非流式返回用）。 */
export function stripDsml(text: string): string {
	return text.replace(DSML_TOKEN_RE, '');
}

/**
 * 流式清洗器：feed() 返回此刻可以安全外发的片段，flush() 收尾吐出被扣住的
 * 尾巴。有状态，一次对话一个实例。
 */
export function createDsmlFilter() {
	let pending = '';
	let stripped = 0;
	return {
		feed(chunk: string): string {
			pending += chunk;
			pending = pending.replace(DSML_TOKEN_RE, () => {
				stripped += 1;
				return '';
			});
			const m = DSML_PARTIAL_TAIL_RE.exec(pending);
			if (!m) {
				const out = pending;
				pending = '';
				return out;
			}
			const out = pending.slice(0, m.index);
			pending = pending.slice(m.index);
			return out;
		},
		flush(): string {
			const out = pending;
			pending = '';
			return out.replace(DSML_TOKEN_RE, '');
		},
		/** 命中过多少次完整标记 —— >0 说明模型确实在往正文里漏工具调用 */
		get hits() {
			return stripped;
		},
	};
}

export function sseEvent(data: Record<string, unknown>): string {
	return `data: ${JSON.stringify(data)}\n\n`;
}

export function createSSEResponse(
	generator: (signal?: AbortSignal) => AsyncGenerator<string>,
	signal?: AbortSignal,
): Response {
	const encoder = new TextEncoder();
	const readableStream = new ReadableStream({
		async start(controller) {
			const heartbeat = setInterval(() => {
				try { controller.enqueue(encoder.encode(sseEvent({ type: 'ping', ts: Date.now() }))); }
				catch { /* stream closed */ }
			}, 5_000);
			try {
				for await (const chunk of generator(signal)) {
					if (signal?.aborted) break;
					controller.enqueue(encoder.encode(chunk));
				}
			} catch (e) {
				const error = e as Error;
				if (error.message?.includes('terminated') && signal?.aborted) {
					// graceful — aborted with content already sent
				} else if (error.name !== 'AbortError' && !signal?.aborted) {
					controller.enqueue(encoder.encode(sseEvent({ type: 'error_message', content: error.message })));
				}
			} finally {
				clearInterval(heartbeat);
				controller.close();
			}
		},
		cancel() { /* client disconnected */ },
	});
	return new Response(readableStream, {
		status: 200,
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			'X-Accel-Buffering': 'no',
		},
	});
}
