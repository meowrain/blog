import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { locatePost, slugFromUrl } from '../agents/find/_locate.ts';
import { collectPostBody } from '../agents/find/_post-body.ts';

interface FakePost {
	slug: string;
	id?: number;
}

const corpus: FakePost[] = [
	{ slug: 'pin', id: 0 },
	{ slug: '合集/ssm', id: 35 },
	{ slug: 'Java/JUC/JUC-synchronized', id: 16 },
	{ slug: 'Mixed/Case', id: 40 },
	{ slug: 'no-id-post' },
];

describe('slugFromUrl', () => {
	it('站内链接取出去掉 /posts 的 slug', () => {
		assert.equal(slugFromUrl('/posts/pin/'), 'pin');
		assert.equal(slugFromUrl('/posts/合集/ssm/'), '合集/ssm');
	});

	it('认带域名的完整链接', () => {
		assert.equal(
			slugFromUrl('https://blog.meowrain.cn/posts/合集/ssm/'),
			'合集/ssm',
		);
		assert.equal(slugFromUrl('http://localhost:4321/posts/pin'), 'pin');
	});

	it('认纯 slug 与查询串 / hash', () => {
		assert.equal(slugFromUrl('合集/ssm'), '合集/ssm');
		assert.equal(slugFromUrl('/posts/pin/?a=1#top'), 'pin');
	});

	it('百分号编码的链接能解回中文', () => {
		assert.equal(slugFromUrl('/posts/%E5%90%88%E9%9B%86/ssm/'), '合集/ssm');
	});

	it('坏编码不抛，按原样保留', () => {
		assert.equal(slugFromUrl('/posts/100%off/'), '100%off');
	});

	it('空输入得到空串', () => {
		assert.equal(slugFromUrl('   '), '');
		assert.equal(slugFromUrl('/posts/'), '');
	});
});

describe('locatePost', () => {
	it('链接、slug、完整 URL 都能定位到同一条，并带出文档号', () => {
		for (const input of [
			'/posts/合集/ssm/',
			'合集/ssm',
			'https://blog.meowrain.cn/posts/合集/ssm/',
		]) {
			const hit = locatePost(corpus, input);
			assert.ok(hit, `应命中：${input}`);
			assert.equal(hit.id, 35);
			assert.equal(hit.post.slug, '合集/ssm');
		}
	});

	it('不存在的 slug 返回 null，而不是猜一个文档号', () => {
		assert.equal(locatePost(corpus, '/posts/不存在的文章/'), null);
		assert.equal(locatePost(corpus, ''), null);
	});

	it('语料里没有 id 的文章判为找不到，不拿数组下标顶上', () => {
		assert.equal(locatePost(corpus, '/posts/no-id-post/'), null);
	});

	it('大小写不一致时只在唯一命中时宽容', () => {
		assert.equal(locatePost(corpus, '/posts/mixed/case/')?.id, 40);
		const ambiguous: FakePost[] = [
			{ slug: 'Abc', id: 1 },
			{ slug: 'abc', id: 2 },
		];
		assert.equal(locatePost(ambiguous, '/posts/ABC/'), null);
	});
});

/** 造一篇 groups 组、每组 chunksPerGroup 块的假文章，块长恒为 chunkChars */
function fakeBody(
	groups: number,
	chunksPerGroup = 4,
	chunkChars = 1800,
): {
	fetchGroup: (group: number) => Promise<string[] | null>;
	calls: number[];
} {
	const calls: number[] = [];
	return {
		calls,
		async fetchGroup(group: number) {
			calls.push(group);
			if (group >= groups) return null; // 越界 404
			return Array.from({ length: chunksPerGroup }, (_, i) =>
				`g${group}c${i}`.padEnd(chunkChars, 'x'),
			);
		},
	};
}

describe('collectPostBody', () => {
	it('短文章一个请求读完，complete 为 true', async () => {
		const body = fakeBody(1, 1, 400);
		const result = await collectPostBody(body.fetchGroup, {
			startGroup: 0,
			maxChars: 12_000,
			hardMaxChars: 20_000,
			maxRequests: 4,
		});
		// 第 2 个请求打到 404 才知道已经到结尾 —— 即使这么短也要 2 个请求，这是正常的代价
		assert.equal(result.requests, 2);
		assert.equal(result.complete, true);
		assert.equal(result.text.length, 400);
		assert.equal(result.failed, '');
	});

	it('超长文章（28 组）在默认预算下只发 2 个请求', async () => {
		const body = fakeBody(28, 4, 1800); // 每组 7200 字
		const result = await collectPostBody(body.fetchGroup, {
			startGroup: 0,
			maxChars: 12_000,
			hardMaxChars: 20_000,
			maxRequests: 4,
		});
		assert.equal(result.requests, 2);
		assert.deepEqual(body.calls, [0, 1]);
		assert.equal(result.complete, false);
		assert.equal(result.nextGroup, 2);
	});

	it('请求上限是硬的：maxChars 再大也只发 4 个', async () => {
		const body = fakeBody(28, 4, 1800);
		const result = await collectPostBody(body.fetchGroup, {
			startGroup: 0,
			maxChars: 1_000_000,
			hardMaxChars: 20_000,
			maxRequests: 4,
		});
		// 请求确实打满 4 个，但正文被天花板退回两整组，续读从 group 2 接上
		assert.equal(result.requests, 4);
		assert.deepEqual(body.calls, [0, 1, 2, 3]);
		assert.equal(result.complete, false);
		assert.equal(result.nextGroup, 2);
	});

	it('预算在拉取过程中生效：够了就不再发下一个请求', async () => {
		const body = fakeBody(28, 4, 1800); // 每组 7200 字
		const result = await collectPostBody(body.fetchGroup, {
			startGroup: 0,
			maxChars: 8_000,
			hardMaxChars: 20_000,
			maxRequests: 10,
		});
		// 第一组 7200 不够、第二组之后 14400 超过 8000，所以停在第二组，第 3 个请求都不发
		assert.equal(result.requests, 2);
		assert.deepEqual(body.calls, [0, 1]);
		assert.equal(result.complete, false);
		assert.equal(result.nextGroup, 2);
		assert.ok(result.text.length >= 8_000, '宁可多给一组，也不从块中间切');
	});

	it('超过绝对天花板时退回最后一整组，续读不会漏字', async () => {
		const body = fakeBody(28, 4, 1800); // 每组 7200 字
		const result = await collectPostBody(body.fetchGroup, {
			startGroup: 0,
			maxChars: 1_000_000, // 软预算放开，只靠天花板
			hardMaxChars: 20_000,
			maxRequests: 4,
		});
		assert.ok(result.text.length <= 20_000, `实际 ${result.text.length}`);
		assert.equal(result.complete, false);
		// 每组 4 块 7200 字 + 3 个换行 = 7203 字；退回后两组，剩两组 14407 字，续读从 group 2 开始
		assert.equal(result.text.length, 14407);
		assert.equal(result.nextGroup, 2);
	});

	it('被天花板截断时不会把正文块切开', async () => {
		const body = fakeBody(28, 4, 1800);
		const result = await collectPostBody(body.fetchGroup, {
			startGroup: 0,
			maxChars: 1_000_000,
			hardMaxChars: 20_000,
			maxRequests: 4,
		});
		// 结尾必须是最后一块的结尾，而不是某块被截了一半
		assert.ok(result.text.endsWith('x'), '结尾应完整');
		assert.equal(result.text.split('\n').length % 4, 0, '块数应是 4 的整数倍');
	});

	it('完整读完的长文不会误报截断', async () => {
		const body = fakeBody(2, 2, 500); // 两组、共 4 块 2000 字
		const result = await collectPostBody(body.fetchGroup, {
			startGroup: 0,
			maxChars: 12_000,
			hardMaxChars: 20_000,
			maxRequests: 4,
		});
		assert.equal(result.complete, true);
		assert.equal(result.text.length, 2000 + 3); // 4 块之间有 3 个换行
	});

	it('续读从 startGroup 开始，越界时 nextGroup 指回最后一个存在的组', async () => {
		const body = fakeBody(2, 1, 300);
		const result = await collectPostBody(body.fetchGroup, {
			startGroup: 2,
			maxChars: 12_000,
			hardMaxChars: 20_000,
			maxRequests: 4,
		});
		assert.equal(result.text, '');
		assert.equal(result.complete, true);
		assert.equal(result.nextGroup, 2);
	});

	it('中途失败保留已拿到的部分', async () => {
		let n = 0;
		const result = await collectPostBody(
			async (group) => {
				n += 1;
				if (n === 2) throw new Error('HTTP 502');
				return [`chunk-${group}`.padEnd(300, 'y')];
			},
			{ startGroup: 0, maxChars: 12_000, hardMaxChars: 20_000, maxRequests: 4 },
		);
		assert.equal(result.text.length, 300);
		assert.equal(result.failed, 'HTTP 502');
		assert.equal(result.complete, false);
	});
});
