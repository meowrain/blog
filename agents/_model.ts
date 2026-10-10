import { ChatOpenAI } from '@langchain/openai';

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
		// 平台约定：AI_GATEWAY_MODEL 可选，不填就用默认网关模型
		...(model ? { AI_GATEWAY_MODEL: model } : {}),
	};
}

export function modelName(env: AgentEnv): string {
	return env.AI_GATEWAY_MODEL?.trim() || DEFAULT_MODEL_NAME;
}

// Cache the model instance per baseURL
const modelCache = new Map<string, ChatOpenAI>();

export function createModel(env: AgentEnv, options?: { timeout?: number }): ChatOpenAI {
	const cacheKey = `${modelName(env)}:${env.AI_GATEWAY_BASE_URL}`;
	if (modelCache.has(cacheKey)) return modelCache.get(cacheKey)!;

	const model = new ChatOpenAI({
		model: modelName(env),
		apiKey: env.AI_GATEWAY_API_KEY,
		configuration: { baseURL: env.AI_GATEWAY_BASE_URL },
		temperature: 0,
		timeout: options?.timeout ?? 300_000,
	});
	modelCache.set(cacheKey, model);
	return model;
}
