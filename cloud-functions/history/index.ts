import { createLogger } from '../_logger';

const logger = createLogger('history');

/** 只接受这几个 action；不传 action 是「读历史」的老约定，保持兼容 */
const ALLOWED_ACTIONS = new Set(['clear', 'delete']);

/**
 * POST /history —— 会话历史的读与删（单对象签名，别改成两参数写法）。
 *
 *   { conversation_id, limit? }          读该会话最近 limit 条（默认 50，最多 100）
 *   { action: 'clear' }                  清空该会话的消息
 *   { action: 'delete' }                 删除该会话（先清消息，再尝试删会话元数据）
 *
 * 会话 id 优先取 body.conversation_id，缺了回落到 makers-conversation-id 平台头。
 */
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

	// action 只认白名单，未知的照旧按「读历史」处理会让人以为删掉了
	const action = typeof body.action === 'string' ? body.action.trim() : '';
	if (action && !ALLOWED_ACTIONS.has(action)) {
		return new Response(JSON.stringify({ ok: false, error: `unknown action: ${action}` }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// POST /history { action: 'delete' } —— 真删服务端上的这个会话。
	// 前端会话列表只有本地索引（服务端 listConversations 是账号级的，见 ChatPanel 注释），
	// 所以「从列表里删掉」得同时把服务端的消息清掉，否则正文成了孤儿。
	// store.deleteConversation 不一定存在，缺了就只清消息，主目的（读不到历史）已经达成。
	if (action === 'delete') {
		if (!agent?.store?.clearMessages) {
			return new Response(JSON.stringify({ ok: false, error: 'store.clearMessages is unavailable in this runtime' }), {
				status: 501,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		logger.log('POST /history action=delete targetId=%s', targetId);

		try {
			await agent.store.clearMessages({ conversationId: targetId });
			let dropped = false;
			if (typeof agent.store.deleteConversation === 'function') {
				try {
					await agent.store.deleteConversation(targetId);
					dropped = true;
				} catch (e) {
					// 清消息已经成功了，元数据删不掉不影响「历史为空」这个结果
					logger.error('deleteConversation failed', (e as Error).message);
				}
			}
			return new Response(JSON.stringify({ ok: true, deleted: targetId, dropped }), {
				headers: { 'Content-Type': 'application/json' },
			});
		} catch (e) {
			logger.error('delete history failed', (e as Error).message);
			return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			});
		}
	}

	// POST /history { action: 'clear' } —— 清空会话：删掉该会话在服务端保存的全部消息记录，
	// 之后 /history 恢复出来就是空的（前端「清空」按钮走这条分支）。
	if (action === 'clear') {
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
