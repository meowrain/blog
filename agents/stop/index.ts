import { createLogger } from '../_shared';

const logger = createLogger('stop');

export async function onRequest(context: any) {
	const { request, env, conversation_id: conversationId } = context;

	const body = (request?.body ?? {}) as { conversation_id?: string };
	const targetId = (body.conversation_id?.trim() || conversationId || '').trim();

	if (!targetId) {
		return new Response(JSON.stringify({ error: "'conversation_id' is required" }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	logger.log('POST /stop targetId=%s', targetId);

	try {
		await context.agent.abortActiveRun({ conversationId: targetId });
		return new Response(JSON.stringify({ ok: true, stopped: targetId }), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (e) {
		logger.error('abortActiveRun failed', (e as Error).message);
		return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
			headers: { 'Content-Type': 'application/json' },
		});
	}
}
