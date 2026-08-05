import { describe, expect, it } from "vitest";
import {
	getOutdoorTemperatureSeries,
	getRoomTemperatureSeries,
} from "./temperature-series";
import type { TemperatureHistoryEntry } from "./types";

const nowMs = new Date("2026-08-05T09:00:00.000Z").getTime();

function historyEntry({
	checkedAt,
	observedAt,
	temperatureC,
}: {
	checkedAt: string;
	observedAt?: string;
	temperatureC: number;
}): TemperatureHistoryEntry {
	return {
		checkedAt,
		outside: { temperatureC: 18, observedAt },
		rooms: [
			{
				zoneId: 1,
				zoneName: "Bedroom",
				temperatureC,
				observedAt,
			},
		],
	};
}

describe("temperature series", () => {
	it("turns repeated polls of one sensor observation into one point", () => {
		const history = [
			historyEntry({
				checkedAt: "2026-08-05T08:40:00.000Z",
				observedAt: "2026-08-05T08:34:16.000Z",
				temperatureC: 23,
			}),
			historyEntry({
				checkedAt: "2026-08-05T08:50:00.000Z",
				observedAt: "2026-08-05T08:34:16.000Z",
				temperatureC: 23,
			}),
		];

		expect(getRoomTemperatureSeries(history, 1, nowMs)).toEqual([
			{ time: new Date("2026-08-05T08:34:16.000Z").getTime(), value: 23 },
		]);
	});

	it("keeps equal temperatures when they have distinct real timestamps", () => {
		const history = [
			historyEntry({
				checkedAt: "2026-08-05T08:40:00.000Z",
				observedAt: "2026-08-05T08:34:16.000Z",
				temperatureC: 23,
			}),
			historyEntry({
				checkedAt: "2026-08-05T08:50:00.000Z",
				observedAt: "2026-08-05T08:46:00.000Z",
				temperatureC: 23,
			}),
		];

		expect(getRoomTemperatureSeries(history, 1, nowMs)).toHaveLength(2);
	});

	it("sorts out-of-order history and falls back to poll time for legacy rows", () => {
		const history = [
			historyEntry({
				checkedAt: "2026-08-05T08:50:00.000Z",
				temperatureC: 23.1,
			}),
			historyEntry({
				checkedAt: "2026-08-05T08:40:00.000Z",
				observedAt: "2026-08-05T08:34:16.000Z",
				temperatureC: 23,
			}),
		];

		expect(getRoomTemperatureSeries(history, 1, nowMs)).toEqual([
			{ time: new Date("2026-08-05T08:34:16.000Z").getTime(), value: 23 },
			{ time: new Date("2026-08-05T08:50:00.000Z").getTime(), value: 23.1 },
		]);
	});

	it("does not let a future provider timestamp stretch either chart series", () => {
		const history = [
			historyEntry({
				checkedAt: "2026-08-05T08:50:00.000Z",
				observedAt: "2026-08-06T08:50:00.000Z",
				temperatureC: 23,
			}),
		];
		const expected = [
			{ time: new Date("2026-08-05T08:50:00.000Z").getTime(), value: 23 },
		];

		expect(getRoomTemperatureSeries(history, 1, nowMs)).toEqual(expected);
		expect(getOutdoorTemperatureSeries(history, nowMs)).toEqual([
			{ ...expected[0], value: 18 },
		]);
	});
});
