// 文章正文的抽取、预算与裁剪。刻意不引任何三方包（见 learn/index.ts 顶部说明：
// agent 运行时会裁剪外部依赖，任何三方 import 都可能让整包在加载期崩掉）。

export interface ChatTurn {
	role: 'user' | 'assistant';
	content: string;
}

/**
 * 中文按 1 token/字、英文按 4 字符/token 粗估。
 * 只用于"正文能不能塞进 prompt"的预算判断，不追求精确。
 */
export function estimateTokens(text: string): number {
	const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/g) ?? []).length;
	return Math.ceil(cjk + (text.length - cjk) / 4);
}

/**
 * 按预算裁剪正文：超了按比例砍。用 Math.ceil 保证"该留一点"的时候不会掉成 0。
 */
export function clampArticleBody(body: string, maxTokens: number): string {
	const text = body.trim();
	if (!text) return '';
	if (estimateTokens(text) <= maxTokens) return text;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (estimateTokens(text.slice(0, mid)) <= maxTokens) lo = mid;
		else hi = mid - 1;
	}
	return text.slice(0, lo);
}

/** 给注入的正文加边界，避免模型把正文和指令混着读。 */
export function wrapArticleBody(body: string, title: string): string {
	if (!body.trim()) return '';
	return [`以下是《${title || '这篇文章'}》的正文（Markdown 原文，可能被截断）：`, '<<<ARTICLE', body, 'ARTICLE'].join('\n');
}
