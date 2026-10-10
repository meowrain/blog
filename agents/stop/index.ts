import { createLogger } from '../_shared';

const logger = createLogger('stop');

export async function onRequest(context: any) {
	const { request, conversation_id: conversationId, utils } = context;

	const body = (request?.body ?? {}) as { conversation_id?: string };
	// 前端调 /stop 时禁止带 makers-conversation-id（会把请求 sticky 到卡住的那个
	// chat 实例上，abortActiveRun 反而够不到 runner），目标 id 只从 body 走。
	const targetId = (body.conversation_id?.trim() || conversationId || '').trim();

	if (!targetId) {
		return new Response(JSON.stringify({ error: "'conversation_id' is required" }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// ⭐ abortActiveRun 挂在 context.utils 上，且只有 agent 运行时注入；
	// cloud-function 侧的 context.agent 里没有它。
	if (typeof utils?.abortActiveRun !== 'function') {
		logger.error('abortActiveRun unavailable on context.utils');
		return new Response(JSON.stringify({ ok: false, error: 'abortActiveRun is unavailable in this runtime' }), {
			status: 501,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	logger.log('POST /stop targetId=%s', targetId);

	try {
		const ret = await utils.abortActiveRun(targetId);
		return new Response(JSON.stringify({ ok: true, stopped: targetId, result: ret ?? null }), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (e) {
		logger.error('abortActiveRun failed', (e as Error).message);
		return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
			headers: { 'Content-Type': 'application/json' },
		});
	}
}
