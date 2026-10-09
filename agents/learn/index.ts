import { createDeepAgent } from 'deepagents';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger, sseEvent, createSSEResponse } from '../_shared';
import { getAgentEnv, createModel } from '../_model';

const logger = createLogger('learn');

// Cache agent instances by index-systemPrompt to avoid rebuild per request
const agentCache = new Map<string, any>();

function getAgent(model: any, systemPrompt: string, tools: any[]) {
	const cacheKey = systemPrompt.slice(0, 30);
	if (agentCache.has(cacheKey)) return agentCache.get(cacheKey)!;
	const agent = createDeepAgent({ model, systemPrompt, tools });
	agentCache.set(cacheKey, agent);
	return agent;
}

function getInternetSearch() {
	return tool(
		async ({ query }: { query: string }) => {
			return `Internet search for "${query}" is not configured yet (set WSA_API_KEY).`;
		},
		{ name: 'internet_search', description: 'Internet search', schema: z.object({ query: z.string() }) },
	);
}

type ChatMessage = { role: 'user' | 'assistant'; content: string };

interface LearnRequestBody {
	messages?: ChatMessage[];
	slug?: string;
	mode?: 'tutor' | 'quiz' | 'eval';
}

const MODE_PROMPTS: Record<string, string> = {
	tutor: '你是一位耐心的学习导师。基于用户当前提供的博文内容，用循序渐进的方式讲解该文章中的知识点，举浅显的例子，主动指出易混淆的概念，并在讲解中穿插提问来检验用户是否真的理解。',
	quiz: '你是一位出题老师。基于用户当前提供的博文内容，出一套 5 道题的测验（3 道选择题 + 2 道简答题），先一次性给出全部题目，等用户作答后再逐题批改并给出解析。',
	eval: '你是一位严格的阅卷老师。用户会回答你之前的测验题目，请逐题判断对错、给出正确答案与解析，最后按 0~100 分打分并给出薄弱知识点的改进建议。',
};

function buildSystemPrompt(mode: string): string {
	const base = '你是博文学习助手，运行在用户的个人技术博客（Fuwari 静态博客，技术类文章为主）内，帮助访客通过对话深入理解博客文章。回复使用简体中文，使用 Markdown。回复中不要重复整篇文章内容，只针对知识点展开。';
	return `${base}\n\n当前任务模式：${MODE_PROMPTS[mode] ?? MODE_PROMPTS.tutor}`;
}

async function* eventStream(
	agent: any,
	messages: ChatMessage[],
	conversationId: string,
	signal?: AbortSignal,
) {
	try {
		const stream = await agent.stream(
			{ messages },
			{
				streamMode: 'messages',
				signal,
				recursionLimit: 30,
				configurable: { thread_id: conversationId },
			},
		);
		for await (const chunk of stream) {
			if (signal?.aborted) break;
			const [msg] = chunk;
			if (msg.tool_call_chunks?.length) {
				for (const tc of msg.tool_call_chunks) {
					if (tc.name) yield sseEvent({ type: 'tool_call', name: tc.name });
				}
			} else if (msg.type === 'tool') {
				yield sseEvent({ type: 'tool_result', name: msg.name, content: msg.text?.slice(0, 500) ?? '' });
			} else if (msg.text) {
				yield sseEvent({ type: 'ai_response', content: msg.text });
			}
		}
	} catch (e) {
		if ((e as Error).name !== 'AbortError' && !signal?.aborted) {
			yield sseEvent({ type: 'error_message', content: (e as Error).message });
		}
	}
	yield 'data: [DONE]\n\n';
}

export async function onRequest(context: any) {
	const { request, env, conversation_id: conversationId } = context;

	const body = (request?.body ?? {}) as LearnRequestBody;

	const slug = body.slug?.trim() || '';
	const mode = body.mode?.trim() || 'tutor';

	const messages = (Array.isArray(body.messages) ? body.messages : [])
		.filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.trim());
	if (messages.length === 0) {
		return new Response(JSON.stringify({ error: "'messages' is required" }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	let historyNote = '';
	try {
		const history = await context.store.getMessages({
			conversationId,
			limit: 50,
		});
		if (history?.length) {
			historyNote = `\n历史消息（供参考，最新一轮在最后）：\n${history
				.map((m: { role?: string; content?: string }) => `${m.role ?? 'unknown'}: ${(m.content ?? '').slice(0, 300)}`)
				.join('\n')}`;
		}
	} catch (e) {
		logger.error('getMessages failed, continuing without history', (e as Error).message);
	}

	const model = createModel(getAgentEnv(env));
	const agent = getAgent(model, buildSystemPrompt(mode), [getInternetSearch()]);
	const postContext = slug
		? `当前学习文章 slug：${slug}`
		: '当前未指定文章，请引导用户从博客目录中选择一篇来学习。';
	const conversationIdLine = `conversation_id: ${conversationId}`;
	const agentMessages: ChatMessage[] = [
		{
			role: 'user',
			content: `${postContext}\n${conversationIdLine}${historyNote}\n用户消息：${messages.at(-1)!.content}`,
		},
	];

	await context.store
		.appendMessage({ conversationId, role: 'user', content: messages.at(-1)!.content })
		.catch((e: unknown) => logger.error('appendMessage failed', (e as Error).message));

	logger.log('POST /learn slug=%s mode=%s conv=%s', slug, mode, conversationId);
	const signal = request?.signal as AbortSignal | undefined;
	return createSSEResponse((sig) => eventStream(agent, agentMessages, conversationId, sig), signal);
}
