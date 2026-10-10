// 本文件只做 env → 网关参数映射，刻意不引任何第三方包：
// 线上的 agent 运行时对外部依赖做过裁剪（构建日志里 "Dependency sync ... missing=15"），
// 一旦这里有 import 解析不到，整个 agent bundle 会在加载期崩掉、所有 agents/ 路由一起 500。
const DEFAULT_MODEL_NAME = '@makers/deepseek-v4-flash';

export interface AgentEnv {
	AI_GATEWAY_API_KEY: string;
	AI_GATEWAY_BASE_URL: string;
	AI_GATEWAY_MODEL?: string;
}

export function getAgentEnv(contextEnv: Record<string, string | undefined> | undefined): AgentEnv {
	const source = contextEnv ?? {};
	const required = ['AI_GATEWAY_API_KEY', 'AI_GATEWAY_BASE_URL'] as const;
	const missing = required.filter((k) => !source[k]?.trim());
	if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
	const model = source.AI_GATEWAY_MODEL?.trim();
	return {
		AI_GATEWAY_API_KEY: source.AI_GATEWAY_API_KEY!,
		AI_GATEWAY_BASE_URL: source.AI_GATEWAY_BASE_URL!,
		...(model ? { AI_GATEWAY_MODEL: model } : {}),
	};
}

export function modelName(env: AgentEnv): string {
	return env.AI_GATEWAY_MODEL?.trim() || DEFAULT_MODEL_NAME;
}

// baseURL 通常已经带 /v1，但两种写法都容错
export function chatCompletionsUrl(env: AgentEnv): string {
	return `${env.AI_GATEWAY_BASE_URL.replace(/\/+$/, '')}/chat/completions`;
}
