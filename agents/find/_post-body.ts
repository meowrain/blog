/**
 * read_post 拉正文的核心逻辑：按 group 递增拉、边拉边卡预算、撞到 404 收尾。
 *
 * 抽成纯函数是为了能测。请求数上限、累计字符预算、硬天花板这三条，表现都是「什么时候停」，
 * 塞在工具函数里只能靠线上观察；这里把 fetch 当参数注入，测试就能用假数据把长文的停手位置
 * 精确验一遍。
 *
 * 本文件不许 import 任何东西（见 _model.ts 顶部的说明）。
 */

export interface CollectPlan {
	/** 从第几个正文块开始（续读用；默认 0） */
	startGroup: number;
	/** 软预算：累计到这个字数就不再发下一个请求 */
	maxChars: number;
	/** 绝对天花板：返回的正文绝不超过这个长度 */
	hardMaxChars: number;
	/** 最多发几个请求（硬上限，不随 maxChars 放大） */
	maxRequests: number;
}

export interface CollectResult {
	/** 已拿到的正文，块之间用换行连接；永远是完整的正文块，不会从块中间切开 */
	text: string;
	/** 实际发出的请求数 */
	requests: number;
	/** 该从哪个 group 续读；越界时等于最后一组的组号 */
	nextGroup: number;
	/** 已经读到正文末尾（不是被预算或请求上限截断的） */
	complete: boolean;
	/** 中途失败的说明；空串表示没失败 */
	failed: string;
	/** 为什么停的：complete 读完 / failed 拉取出错 / requests 撞请求上限 / budget 到预算 / ceiling 到硬天花板 */
	stop: StopReason;
}

export type StopReason = 'complete' | 'failed' | 'requests' | 'budget' | 'ceiling';

/**
 * 拉正文。`fetchGroup(group)` 返回该组的块数组；返回 null 表示这一组不存在（404）。
 * 抛错视为「拉取失败」：已拿到的部分保留，由调用方决定怎么告诉模型。
 *
 * 两处刻意的设计：
 * - 停手只在组与组之间判断，所以返回的正文永远是整组，续读按 group 接上不会漏内容；
 * - 组内约 7200 字，软预算因此可能超一点（最多一组）；超到天花板才把最后一整组退回去，
 *   退回去的那组就是 nextGroup，一样不漏。
 */
export async function collectPostBody(
	fetchGroup: (group: number) => Promise<string[] | null>,
	plan: CollectPlan,
): Promise<CollectResult> {
	const groups: string[] = [];
	let used = 0;
	let requests = 0;
	let complete = false;
	let failed = '';

	for (let i = 0; i < plan.maxRequests; i++) {
		const group = plan.startGroup + i;
		if (used >= plan.maxChars) break; // 预算够了，别再发请求
		requests += 1;
		let chunks: string[] | null;
		try {
			chunks = await fetchGroup(group);
		} catch (e) {
			failed = (e as Error)?.message || String(e);
			break;
		}
		if (chunks === null) {
			complete = true; // 越界 404：这篇的正文到底了
			break;
		}
		const text = chunks.join('\n');
		groups.push(text);
		used += text.length + (groups.length > 1 ? 1 : 0);
	}

	let nextGroup = plan.startGroup + groups.length;
	// 天花板：超了就把最后一整组退回给下一次读（组已经是完整正文块，退回去不会漏字）
	let ceilingHit = false;
	while (groups.length > 1 && joinedLength(groups) > plan.hardMaxChars) {
		groups.pop();
		complete = false;
		nextGroup = plan.startGroup + groups.length;
		ceilingHit = true;
	}
	if (groups.length === 1 && joinedLength(groups) > plan.hardMaxChars)
		complete = false;

	const stop: StopReason = complete
		? 'complete'
		: failed
			? 'failed'
			: ceilingHit
				? 'ceiling'
				: requests >= plan.maxRequests
					? 'requests'
					: 'budget';

	return { text: groups.join('\n'), requests, nextGroup, complete, failed, stop };
}

function joinedLength(groups: string[]): number {
	let total = 0;
	for (const [i, text] of groups.entries()) total += text.length + (i ? 1 : 0);
	return total;
}
