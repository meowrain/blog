/**
 * 会话历史里的「片段」收集器 —— 纯逻辑，零 import。
 *
 * 为什么要单独拆一个文件：`agents/` 下的模块互相用的是无扩展名 import
 * （`./_shared`），Node 的 ESM 解析器不认，于是整个 agents 目录在
 * `node --test` 里根本加载不了。这段逻辑要能被单测覆盖，就不能留在
 * `_agent-loop.ts` 里。本文件刻意不引任何东西，测试可以直接 import。
 *
 * 记的是什么：一轮回答里文字与工具结果的出现顺序。工具结果原本只发给浏览器
 * （SSE），从不入库，导致刷新页面后播放卡 / 文章卡全消失，只剩正文那句
 * 「卡已经出好了」。把顺序记下来随消息落库，恢复时才能还原原排版。
 */

export interface CollectedTool {
	id: string;
	name: string;
	/** 原始参数 JSON，界面上的工具片段会显示它 */
	args: string;
	summary: string;
	content: string;
	ok: boolean;
}

export type CollectedPart =
	| { kind: 'text'; content: string }
	| ({ kind: 'tool' } & CollectedTool);

export interface Collector {
	/** 本轮所有外发文字拼起来（多次工具调用之间的过渡语也在里面） */
	text: string;
	/**
	 * 按发生顺序记下的片段。
	 * 可选：/find 那类不需要重建卡片的调用方只传 `{ text }`，此时不记录片段。
	 */
	parts?: CollectedPart[];
}

export function createCollector(): Collector {
	return { text: '', parts: [] };
}

/**
 * 追加一段流式文字。
 *
 * 逐 token 来的，不能一个 token 一个片段：接在最后一个 text 片段后面，
 * 只有遇到工具结果之后才另起一段。
 */
export function pushText(collector: Collector | undefined, piece: string): void {
	// parts 可选：老调用方（如 /find）只传了 { text }，不要替它们凭空建数组
	if (!collector?.parts || !piece) return;
	const last = collector.parts[collector.parts.length - 1];
	if (last?.kind === 'text') last.content += piece;
	else collector.parts.push({ kind: 'text', content: piece });
}

export function pushTool(collector: Collector | undefined, tool: CollectedTool): void {
	if (!collector?.parts) return;
	collector.parts.push({ kind: 'tool', ...tool });
}
