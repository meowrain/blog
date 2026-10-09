import { createLogger } from '../agents/_shared';

const logger = createLogger('history');

export async function onRequest(context: any) {
	const { request, env, conversation_id: conversationId } = context;

	const body = (request?.body ?? {}) as { conversation_id?: string; limit?: number };
	const targetId = (body.conversation_id?.trim() || conversationId || '').trim();
	const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100);

	if (!targetId) {
		return new Response(JSON.stringify({ error: "'conversation_id' is required" }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	logger.log('POST /history targetId=%s limit=%d', targetId, limit);

	try {
		const msgs = await context.agent.store.getMessages({
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
