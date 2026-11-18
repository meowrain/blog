#!/usr/bin/env node
/**
 * 手动探测：当前 gateway 模型到底支不支持读图？
 *
 * 不进 CI —— 要真实打一次上游、要花钱，而且结论取决于你配的那个模型。
 * 用法（在仓库根目录）：
 *
 *   AI_GATEWAY_API_KEY=... AI_GATEWAY_BASE_URL=... node scripts/probe-vision.mjs
 *   # 也可以先 export，或者把这三个写进 .env 再用 dotenv 之外的任意方式注入
 *
 * 可选：
 *   AI_GATEWAY_MODEL=xxx          测哪个模型，默认 @makers/deepseek-v4-flash
 *   AI_GATEWAY_VISION_MODEL=xxx   额外顺带测一遍视觉专用模型
 *
 * 退出码：0 = 至少一个模型能读图；1 = 都不行（那就配 AI_GATEWAY_VISION_MODEL 或
 * AI_GATEWAY_VISION=0，代码会按纯文本 + 链接降级，不会白屏）。
 */

const TIMEOUT_MS = 30_000;

// 16×16 的纯红 PNG，够模型「看见」东西，又不浪费 token
const PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJUlEQVR42mP8z8BQz0AEYBxVSF+FjP9BxH8G4gDjqEL6KwQAgKUJAcRkBzsAAAAASUVORK5CYII=';

function chatUrl(baseUrl) {
	return `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
}

async function probe(model, env) {
	const body = {
		model,
		temperature: 0,
		max_tokens: 32,
		messages: [
			{
				role: 'user',
				content: [
					{ type: 'text', text: '这张图是什么颜色？只回答颜色。' },
					{ type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_BASE64}` } },
				],
			},
		],
	};

	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
	try {
		const resp = await fetch(chatUrl(env.baseUrl), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.apiKey}` },
			body: JSON.stringify(body),
			signal: ctl.signal,
		});
		const text = await resp.text();
		if (!resp.ok) {
			return { model, ok: false, detail: `HTTP ${resp.status}: ${text.slice(0, 240)}` };
		}
		let answer = '';
		try {
			const json = JSON.parse(text);
			answer = String(json?.choices?.[0]?.message?.content ?? '').trim();
		} catch {
			answer = text.slice(0, 200);
		}
		return { model, ok: true, detail: answer || '(空回答)' };
	} catch (e) {
		return { model, ok: false, detail: (e && e.message) || String(e) };
	} finally {
		clearTimeout(timer);
	}
}

async function main() {
	const apiKey = process.env.AI_GATEWAY_API_KEY?.trim();
	const baseUrl = process.env.AI_GATEWAY_BASE_URL?.trim();
	if (!apiKey || !baseUrl) {
		console.error('缺少 AI_GATEWAY_API_KEY / AI_GATEWAY_BASE_URL。');
		process.exit(1);
	}

	const models = [
		process.env.AI_GATEWAY_MODEL?.trim() || '@makers/deepseek-v4-flash',
		process.env.AI_GATEWAY_VISION_MODEL?.trim(),
	].filter(Boolean);

	let anyOk = false;
	for (const model of models) {
		process.stdout.write(`→ ${model} … `);
		const result = await probe(model, { apiKey, baseUrl });
		console.log(result.ok ? '✅ 能读图' : '❌ 不支持');
		console.log(`  ${result.detail}`);
		if (result.ok) anyOk = true;
	}

	if (!anyOk) {
		console.log(
			'\n结论：这些模型都没法直接读图。代码仍然可用（纯文本 + 图片链接 + notice 提示），' +
				'想要真读图就配 AI_GATEWAY_VISION_MODEL，或者确认不需要后配 AI_GATEWAY_VISION=0 省掉一次试探。',
		);
	}
	process.exit(anyOk ? 0 : 1);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
