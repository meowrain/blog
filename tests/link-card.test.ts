import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	extractMetadata,
	matchCardParagraph,
} from "../src/plugins/rehype-link-card.mjs";

const link = (
	href: string,
	text?: string,
	extra: Record<string, unknown> = {},
) => ({
	type: "element" as const,
	tagName: "a",
	properties: { href, ...extra },
	children: text ? [{ type: "text" as const, value: text }] : [],
});

const para = (...children: unknown[]) => ({
	type: "element" as const,
	tagName: "p",
	children: children as never[],
});

const options = { site: "https://blog.meowrain.cn", skipDomains: [] };

describe("matchCardParagraph 触发判定", () => {
	it("裸 URL 独占一段 → 命中", () => {
		const hit = matchCardParagraph(
			para(link("https://example.com", "https://example.com")),
			options,
		);
		assert.equal(hit?.hostname, "example.com");
		// 文字和 URL 相同时不重复当标题
		assert.equal(hit?.linkText, "");
	});

	it("带文字的独占链接 → 命中并带上文字", () => {
		const hit = matchCardParagraph(
			para(link("https://example.com", "示例站点")),
			options,
		);
		assert.equal(hit?.linkText, "示例站点");
	});

	it("段落里还有别的文字 → 不命中", () => {
		assert.equal(
			matchCardParagraph(
				para(
					{ type: "text", value: "看看 " },
					link("https://example.com", "示例"),
				),
				options,
			),
			null,
		);
	});

	it("段落里有两个链接 → 不命中", () => {
		assert.equal(
			matchCardParagraph(
				para(link("https://a.com"), link("https://b.com")),
				options,
			),
			null,
		);
	});

	it("站内同域与子域 → 不命中", () => {
		assert.equal(
			matchCardParagraph(
				para(link("https://blog.meowrain.cn/posts/")),
				options,
			),
			null,
		);
		assert.equal(
			matchCardParagraph(para(link("https://img.meowrain.cn/a.png")), options),
			null,
		);
	});

	it("非 http(s) 与相对链接 → 不命中", () => {
		for (const href of [
			"mailto:a@b.com",
			"tel:123",
			"javascript:void(0)",
			"/posts/",
		]) {
			assert.equal(matchCardParagraph(para(link(href)), options), null, href);
		}
	});

	it("{linkcard=false} 与 skipDomains 都能显式关闭", () => {
		assert.equal(
			matchCardParagraph(
				para(link("https://example.com", "示例", { linkcard: false })),
				options,
			),
			null,
		);
		assert.equal(
			matchCardParagraph(para(link("https://x.example.com")), {
				...options,
				skipDomains: ["example.com"],
			}),
			null,
		);
	});
});

describe("extractMetadata", () => {
	it("优先 og，缺省回落到 title/description，并补全相对地址", () => {
		const meta = extractMetadata(
			`<html><head><title>页面标题</title>
			<meta property="og:title" content="OG &amp; 标题">
			<meta name="description" content="普通描述">
			<meta property="og:image" content="/cover.png">
			<link rel="icon" href="/favicon.ico"></head></html>`,
			"https://example.com/post/",
		);
		assert.equal(meta?.title, "OG & 标题");
		assert.equal(meta?.description, "普通描述");
		assert.equal(meta?.image, "https://example.com/cover.png");
		assert.equal(meta?.icon, "https://example.com/favicon.ico");
	});

	it("完全没有 meta 时返回 null（触发降级）", () => {
		assert.equal(
			extractMetadata("<html><body>hi</body></html>", "https://a.com"),
			null,
		);
	});

	it("纯 meta refresh 跳转页返回 redirectTo", () => {
		const meta = extractMetadata(
			'<meta http-equiv="refresh" content="0;url=/en/getting-started/">',
			"https://docs.example.com/",
		);
		assert.equal(
			meta?.redirectTo,
			"https://docs.example.com/en/getting-started/",
		);
	});
});

describe("防爬壳页面", () => {
	it("只有 data: 图标、没有标题描述 → 返回 null 走降级", () => {
		const meta = extractMetadata(
			'<html><head><link rel="icon" href="data:;base64,="><script>x</script></head></html>',
			"https://juejin.cn/post/1",
		);
		assert.equal(meta, null);
	});

	it("data: 图标被丢弃，不会渲染成碎图", () => {
		const meta = extractMetadata(
			'<html><head><title>标题</title><link rel="icon" href="data:image/png;base64,AAA"></head></html>',
			"https://example.com/",
		);
		assert.equal(meta?.icon, "");
		assert.equal(meta?.title, "标题");
	});
});

describe("事件循环不被抓取拖空", () => {
	// 回归用例：EdgeOne 上外链集体超时，undici 的 socket 是 unref 的，
	// fetch 的 Promise 迟迟不 settle，Node 直接触发 beforeExit，rollup 报
	// "Unexpected early exit. This happens when Promises returned by plugins
	// cannot resolve." 并把整次构建判失败（而且 Astro 一行日志都不打）。
	const TIMEOUT = 200;

	it("外链全部超时时，插件仍然正常返回而不是让进程提前退出", async () => {
		const { rehype } = await import("rehype");
		const { default: rehypeLinkCard } = await import(
			"../src/plugins/rehype-link-card.mjs"
		);
		// .invalid 是 RFC 2606 保留的顶级域，永远解析不到，保证走超时分支
		const tree = {
			type: "root" as const,
			children: [
				para(link("https://a.invalid/one")),
				para(link("https://b.invalid/two")),
				para(link("https://c.invalid/three")),
			],
		};
		const proc = rehype().use(rehypeLinkCard, {
			site: "https://blog.meowrain.cn",
			timeout: TIMEOUT,
			cacheDir: "/tmp/link-card-test-cache",
			log: () => {},
		});

		const startedAt = Date.now();
		const html = String(
			proc.stringify(await proc.run(structuredClone(tree))),
		);
		const elapsed = Date.now() - startedAt;

		// 三张卡全降级，但流程走完了
		assert.equal(html.match(/link-card no-styling is-degraded/g)?.length, 3);
		// 硬截止是 timeout + 1500ms 宽限；两次重试共 2×timeout，不该无限挂
		assert.ok(
			elapsed < TIMEOUT * 2 + 3000,
			`抓取耗时 ${elapsed}ms，超出了预期上限`,
		);
	});
});

describe("卡片 DOM", () => {
	it("卡片链接带 no-styling，避免继承正文的虚线下划线", async () => {
		const { rehype } = await import("rehype");
		const { default: rehypeLinkCard } = await import(
			"../src/plugins/rehype-link-card.mjs"
		);
		const tree = {
			type: "root" as const,
			children: [para(link("https://this-plus-domain-does-not-exist-9x.test"))],
		};
		const proc = rehype().use(rehypeLinkCard, {
			site: "https://blog.meowrain.cn",
			timeout: 300,
			cacheDir: "/tmp/link-card-test-cache",
			log: () => {},
		});
		const html = String(proc.stringify(await proc.run(structuredClone(tree))));
		assert.match(html, /class="link-card no-styling is-degraded"/);
		assert.match(html, /rel="noopener noreferrer"/);
		assert.match(html, /target="_blank"/);
	});
});
