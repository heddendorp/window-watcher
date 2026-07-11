import { describe, expect, it } from "vitest";
import { getSparklineAreaStops } from "./sparkline";

describe("getSparklineAreaStops", () => {
	it("colors rising intervals red and falling intervals green by elapsed time", () => {
		const transitionOffset = (10 / 30) * 100;
		const stops = getSparklineAreaStops([
			{ time: 0, value: 20 },
			{ time: 10, value: 21 },
			{ time: 30, value: 20.5 },
		]);

		expect(stops).toEqual([
			{
				key: "0-start",
				offset: 0,
				color: "var(--ww-ember)",
				opacity: 0.18,
			},
			{
				key: "0-end",
				offset: transitionOffset,
				color: "var(--ww-ember)",
				opacity: 0.18,
			},
			{
				key: "1-start",
				offset: transitionOffset,
				color: "var(--ww-breeze)",
				opacity: 0.18,
			},
			{
				key: "1-end",
				offset: 100,
				color: "var(--ww-breeze)",
				opacity: 0.18,
			},
		]);
	});

	it("uses a restrained neutral fill for unchanged intervals", () => {
		expect(
			getSparklineAreaStops([
				{ time: 0, value: 20 },
				{ time: 10, value: 20 },
			]),
		).toEqual([
			{
				key: "0-start",
				offset: 0,
				color: "var(--ww-ink-faint)",
				opacity: 0.08,
			},
			{
				key: "0-end",
				offset: 100,
				color: "var(--ww-ink-faint)",
				opacity: 0.08,
			},
		]);
	});
});
