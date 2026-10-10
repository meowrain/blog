import { createLogger } from '../_logger';

const logger = createLogger('history');

export async function onRequest(context: any) {
	// cloud-function 侧的 store 是 context.agent.store（不含 langgraph 适配器）
	const { request, agent } = context;

	const body = (request?.body ?? {}) as { conversation_id?: string; limit?: number };
	const targetId = (body.conversation_id?.trim() || agent?.conversation_id || '').trim();
	const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100);

	if (!targetId) {
		return new Response(JSON.stringify({ error: "'conversation_id' is required" }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}
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
