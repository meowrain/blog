import { createLogger } from '../_logger';

const logger = createLogger('history');

export async function onRequest(context: any) {
	// cloud-function 侧的 store 是 context.agent.store（不含 langgraph 适配器）
	const { request, agent } = context;

	const body = (request?.body ?? {}) as { conversation_id?: string; limit?: number; action?: string };
	const targetId = (body.conversation_id?.trim() || agent?.conversation_id || '').trim();

	if (!targetId) {
		return new Response(JSON.stringify({ error: "'conversation_id' is required" }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// POST /history { action: 'clear' } —— 清空会话：删掉该会话在服务端保存的全部消息记录，
	// 之后 /history 恢复出来就是空的（前端「清空」按钮走这条分支）。
	if (body.action === 'clear') {
		if (!agent?.store?.clearMessages) {
			return new Response(JSON.stringify({ ok: false, error: 'store.clearMessages is unavailable in this runtime' }), {
				status: 501,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		logger.log('POST /history action=clear targetId=%s', targetId);

		try {
			await agent.store.clearMessages({ conversationId: targetId });
			return new Response(JSON.stringify({ ok: true, cleared: targetId }), {
				headers: { 'Content-Type': 'application/json' },
			});
		} catch (e) {
			logger.error('clearMessages failed', (e as Error).message);
			return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
				headers: { 'Content-Type': 'application/json' },
			});
		}
	}

	const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100);

	if (!agent?.store?.getMessages) {
		return new Response(JSON.stringify({ ok: false, error: 'store unavailable', messages: [] }), {
			status: 501,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	logger.log('POST /history targetId=%s limit=%d', targetId, limit);

	try {
		const msgs = await agent.store.getMessages({
			conversationId: targetId,
			limit,
			order: 'asc',
		});
		return new Response(JSON.stringify({ ok: true, messages: msgs ?? [] }), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (e) {
		logger.error('getMessages failed', (e as Error).message);
		return new Response(JSON.stringify({ ok: false, error: (e as Error).message, messages: [] }), {
			headers: { 'Content-Type': 'application/json' },
		});
	}
}
