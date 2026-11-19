import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type DailyPoint,
	audienceSplit,
	buildBarModel,
	buildChartModel,
	compactNumber,
	hourLabel,
	niceMax,
	sharePercent,
	shortDate,
	toPolyline,
	weekdayLabel,
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
		assert.equal(model.yTicks[model.yTicks.length - 1].value, model.yMax);
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
		assert.ok(model.points.every((p) => p.x <= model.plotRight));
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

describe("buildBarModel", () => {
	it("24 根柱子等宽、贴基线，且不超出绘图区", () => {
		const values = Array.from({ length: 24 }, (_, i) => i);
		const model = buildBarModel(values, { width: 600, labelFor: hourLabel });
		assert.equal(model.bars.length, 24);
		for (const bar of model.bars) {
			assert.ok(bar.x >= model.plotLeft - 0.001);
			assert.ok(bar.x + bar.width <= model.plotRight + 0.001);
			// 柱底 = 基线
			assert.ok(Math.abs(bar.y + bar.height - model.plotBottom) < 0.001);
		}
		assert.equal(model.bars[23].label, "23:00");
	});

	it("峰值为 0 时仍是合法模型", () => {
		const model = buildBarModel(new Array(24).fill(0));
		assert.equal(model.bars.length, 24);
		assert.ok(model.yMax >= 1);
		assert.ok(model.bars.every((b) => b.height === 0));
	});

	it("x 轴标签按步长抽稀，不会 24 个全上", () => {
		const model = buildBarModel(new Array(24).fill(1), { maxXLabels: 6 });
		assert.ok(model.xLabels.length <= 8);
	});

	it("空数组不崩", () => {
		const model = buildBarModel([]);
		assert.equal(model.bars.length, 0);
		assert.equal(model.xLabels.length, 0);
	});
});

describe("hourLabel / weekdayLabel", () => {
	it("小时补零，越界回绕", () => {
		assert.equal(hourLabel(0), "00:00");
		assert.equal(hourLabel(8), "08:00");
		assert.equal(hourLabel(23), "23:00");
		assert.equal(hourLabel(24), "00:00");
	});

	it("周几中文名，越界为空串", () => {
		assert.equal(weekdayLabel(0), "周日");
		assert.equal(weekdayLabel(6), "周六");
		assert.equal(weekdayLabel(9), "");
	});
});

describe("sharePercent / audienceSplit", () => {
	it("占比保留一位小数，总数非正时为 0", () => {
		assert.equal(sharePercent(1, 3), 33.3);
		assert.equal(sharePercent(0, 0), 0);
		assert.equal(sharePercent(5, -1), 0);
	});

	it("新老访客拆分", () => {
		const split = audienceSplit(3, 1);
		assert.equal(split.newPercent, 75);
		assert.equal(split.returningPercent, 25);
		const empty = audienceSplit(0, 0);
		assert.equal(empty.newPercent, 0);
		assert.equal(empty.returningPercent, 0);
	});
});
