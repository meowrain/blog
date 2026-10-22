import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	formatShortcutTokens,
	matchesShortcut,
	normalizeKeyName,
	parseShortcut,
} from "../src/utils/shortcuts-core.ts";

function event(
	key: string,
	modifiers: Partial<{
		ctrlKey: boolean;
		metaKey: boolean;
		shiftKey: boolean;
		altKey: boolean;
	}> = {},
) {
	return {
		key,
		ctrlKey: modifiers.ctrlKey ?? false,
		metaKey: modifiers.metaKey ?? false,
		shiftKey: modifiers.shiftKey ?? false,
		altKey: modifiers.altKey ?? false,
	};
}

describe("parseShortcut", () => {
	it("解析 mod 组合键", () => {
		assert.deepEqual(parseShortcut("mod+k"), {
			key: "k",
			mod: true,
			shift: false,
			alt: false,
			ctrl: false,
			meta: false,
		});
	});

	it("把 space 之类的别名归一化", () => {
		assert.equal(normalizeKeyName("space"), " ");
		assert.equal(normalizeKeyName("esc"), "Escape");
		assert.equal(normalizeKeyName("ArrowLeft"), "ArrowLeft");
	});

	it("单独的 + 作为键解析", () => {
		assert.equal(parseShortcut("+").key, "+");
		assert.equal(
			matchesShortcut(event("+", { shiftKey: true }), parseShortcut("+")),
			true,
		);
	});
});

describe("matchesShortcut", () => {
	it("mod 同时接受 Ctrl 和 ⌘", () => {
		const shortcut = parseShortcut("mod+k");
		assert.equal(
			matchesShortcut(event("k", { ctrlKey: true }), shortcut),
			true,
		);
		assert.equal(
			matchesShortcut(event("k", { metaKey: true }), shortcut),
			true,
		);
		assert.equal(matchesShortcut(event("k"), shortcut), false);
	});

	it("? 不受 Shift 状态影响", () => {
		const shortcut = parseShortcut("?");
		assert.equal(
			matchesShortcut(event("?", { shiftKey: true }), shortcut),
			true,
		);
		assert.equal(
			matchesShortcut(event("?", { shiftKey: false }), shortcut),
			true,
		);
	});

	it("/ 不会被 Ctrl+/ 误触发", () => {
		const shortcut = parseShortcut("/");
		assert.equal(matchesShortcut(event("/"), shortcut), true);
		assert.equal(
			matchesShortcut(event("/", { ctrlKey: true }), shortcut),
			false,
		);
	});

	it("字母键要求 Shift 精确匹配", () => {
		const plain = parseShortcut("j");
		const shifted = parseShortcut("Shift+j");
		assert.equal(matchesShortcut(event("j"), plain), true);
		assert.equal(matchesShortcut(event("J", { shiftKey: true }), plain), false);
		assert.equal(
			matchesShortcut(event("J", { shiftKey: true }), shifted),
			true,
		);
	});

	it("方向键别名与 Shift 组合", () => {
		const shortcut = parseShortcut("Shift+ArrowRight");
		assert.equal(
			matchesShortcut(event("ArrowRight", { shiftKey: true }), shortcut),
			true,
		);
		assert.equal(matchesShortcut(event("ArrowRight"), shortcut), false);
	});
});

describe("formatShortcutTokens", () => {
	it("mac 上把 mod 显示成 ⌘", () => {
		assert.deepEqual(formatShortcutTokens("mod+k", true), ["⌘", "K"]);
	});

	it("其他平台把 mod 显示成 Ctrl", () => {
		assert.deepEqual(formatShortcutTokens("mod+k", false), ["Ctrl", "K"]);
	});

	it("方向键显示成箭头", () => {
		assert.deepEqual(formatShortcutTokens("Shift+ArrowLeft", true), ["⇧", "←"]);
	});
});
