import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DEFAULT_READING_LAYOUT,
	READING_LAYOUT_OPTIONS,
	isReadingLayout,
	normalizeReadingLayout,
} from "../src/utils/reading-layout-core.ts";

describe("normalizeReadingLayout", () => {
	it("认得三种模式", () => {
		assert.equal(normalizeReadingLayout("standard"), "standard");
		assert.equal(normalizeReadingLayout("wide"), "wide");
		assert.equal(normalizeReadingLayout("focus"), "focus");
	});

	it("空值回落到标准布局", () => {
		assert.equal(normalizeReadingLayout(null), DEFAULT_READING_LAYOUT);
		assert.equal(normalizeReadingLayout(""), DEFAULT_READING_LAYOUT);
		assert.equal(normalizeReadingLayout(undefined), DEFAULT_READING_LAYOUT);
	});

	it("脏数据不会把页面卡在未知模式", () => {
		assert.equal(normalizeReadingLayout("fullscreen"), "standard");
		assert.equal(normalizeReadingLayout(1), "standard");
		assert.equal(normalizeReadingLayout({ value: "wide" }), "standard");
	});
});

describe("isReadingLayout", () => {
	it("只放行白名单里的值", () => {
		assert.equal(isReadingLayout("wide"), true);
		assert.equal(isReadingLayout("WIDE"), false);
		assert.equal(isReadingLayout(0), false);
	});
});

describe("READING_LAYOUT_OPTIONS", () => {
	it("覆盖三种模式且不重复", () => {
		const values = READING_LAYOUT_OPTIONS.map((option) => option.value);
		assert.deepEqual(values, ["standard", "wide", "focus"]);
		assert.equal(new Set(values).size, values.length);
	});

	it("每项都有界面需要的文案与图标", () => {
		for (const option of READING_LAYOUT_OPTIONS) {
			assert.ok(option.label.length > 0);
			assert.ok(option.description.length > 0);
			assert.match(option.icon, /^material-symbols:/);
		}
	});
});
