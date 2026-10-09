import { ChatOpenAI } from '@langchain/openai';

const MODEL_NAME = '@makers/deepseek-v4-flash';

export interface AgentEnv {
	AI_GATEWAY_API_KEY: string;
	AI_GATEWAY_BASE_URL: string;
}

export function getAgentEnv(contextEnv: Record<string, string | undefined> | undefined): AgentEnv {
	const source = contextEnv ?? {};
	const required = ['AI_GATEWAY_API_KEY', 'AI_GATEWAY_BASE_URL'] as const;
	const missing = required.filter((k) => !source[k]?.trim());
	if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
	return {
		AI_GATEWAY_API_KEY: source.AI_GATEWAY_API_KEY!,
		AI_GATEWAY_BASE_URL: source.AI_GATEWAY_BASE_URL!,
	};
}

// Cache the model instance per baseURL
const modelCache = new Map<string, ChatOpenAI>();

export function createModel(env: AgentEnv, options?: { timeout?: number }): ChatOpenAI {
	const cacheKey = `${MODEL_NAME}:${env.AI_GATEWAY_BASE_URL}`;
	if (modelCache.has(cacheKey)) return modelCache.get(cacheKey)!;

	const model = new ChatOpenAI({
		model: MODEL_NAME,
		apiKey: env.AI_GATEWAY_API_KEY,
		configuration: { baseURL: env.AI_GATEWAY_BASE_URL },
		timeout: options?.timeout ?? 300_000,
	});
	modelCache.set(cacheKey, model);
	return model;
}
