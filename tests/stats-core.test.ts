import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildChartModel,
	compactNumber,
	niceMax,
	shortDate,
	toPolyline,
	type DailyPoint,
} from "../src/utils/stats-core.ts";

const series = (values: number[]): DailyPoint[] =>
	values.map((v, i) => ({
		date: `2026-10-${String(i + 1).padStart(2, "0")}`,
		views: v,
		visitors: Math.round(v / 2),
	}));

describe("niceMax", () => {
	it("向上取到 1/2/5 × 10^n", () => {
		assert.equal(niceMax(1), 1);
		assert.equal(niceMax(3), 5);
		assert.equal(niceMax(7), 10);
		assert.equal(niceMax(12), 20);
		assert.equal(niceMax(43), 50);
		assert.equal(niceMax(120), 200);
		assert.equal(niceMax(900), 1000);
	});

	it("非法或非正数兜底为 1", () => {
		assert.equal(niceMax(0), 1);
		assert.equal(niceMax(-5), 1);
		assert.equal(niceMax(Number.NaN), 1);
	});
});

describe("compactNumber", () => {
	it("千、百万级用 K/M 紧凑表示", () => {
		assert.equal(compactNumber(0), "0");
		assert.equal(compactNumber(999), "999");
		assert.equal(compactNumber(1000), "1K");
		assert.equal(compactNumber(1234), "1.2K");
		assert.equal(compactNumber(12000), "12K");
		assert.equal(compactNumber(1_200_000), "1.2M");
	});
});

describe("shortDate", () => {
	it("YYYY-MM-DD → MM-DD，其它原样返回", () => {
		assert.equal(shortDate("2026-10-27"), "10-27");
		assert.equal(shortDate("bad"), "bad");
	});
});

describe("buildChartModel", () => {
	it("y 轴刻度是圆整值，从 0 到 yMax 且首尾对齐", () => {
		const model = buildChartModel(series([3, 7, 12]), { width: 400 });
		// peak 12 → 步长 5 → yMax 15，刻度 0/5/10/15
		assert.equal(model.yMax, 15);
		assert.deepEqual(
			model.yTicks.map((t) => t.value),
			[0, 5, 10, 15],
		);
		assert.equal(model.yTicks[0].value, 0);
		assert.equal(
			model.yTicks[model.yTicks.length - 1].value,
			model.yMax,
		);
	});

	it("刻度步长始终为整数，不出现 13/38 这种值", () => {
		const model = buildChartModel(series([44, 27, 39]));
		for (const tick of model.yTicks) {
			assert.equal(Number.isInteger(tick.value), true);
		}
	});

	it("越大的值 y 坐标越小（越靠上）", () => {
		const model = buildChartModel(series([1, 10]));
		const [first, second] = model.points;
		assert.ok(second.yViews < first.yViews);
	});

	it("点数量与输入一致，x 落在绘图区内", () => {
		const model = buildChartModel(series([1, 2, 3, 4]), { width: 500 });
		assert.equal(model.points.length, 4);
		assert.ok(model.points.every((p) => p.x >= model.plotLeft));
		assert.ok(
			model.points.every((p) => p.x <= model.plotRight),
		);
	});

	it("x 轴标签数量不超过上限，且不重复", () => {
		const model = buildChartModel(series(Array.from({ length: 90 }, () => 1)), {
			maxXLabels: 6,
		});
		assert.ok(model.xLabels.length <= 6);
		const idx = model.xLabels.map((l) => l.index);
		assert.equal(new Set(idx).size, idx.length);
	});

	it("空序列返回合法空模型", () => {
		const model = buildChartModel([]);
		assert.equal(model.points.length, 0);
		assert.equal(model.xLabels.length, 0);
		assert.ok(model.yMax >= 1);
	});
});

describe("toPolyline", () => {
	it("首点用 M，其余用 L；空数组返回空串", () => {
		const model = buildChartModel(series([1, 2, 3]));
		const d = toPolyline(model.points, "yViews");
		assert.ok(d.startsWith("M"));
		assert.equal((d.match(/L/g) || []).length, 2);
		assert.equal(toPolyline([], "yViews"), "");
	});
});
