import { describe, expect, it } from "vitest";
import { sanitizeTemperatureHistoryEntry } from "./history-model";
import type { TemperatureHistoryEntry } from "./types";

const baseEntry: TemperatureHistoryEntry = {
	checkedAt: "2026-07-13T15:45:21.323Z",
	outside: {
		temperatureC: 21.7,
		source: { name: "Bright Sky DWD hourly observation" },
	},
	rooms: [
		{
			zoneId: 1,
			zoneName: "Living room",
			temperatureC: 29.4,
			observedAt: "2026-07-13T15:43:00.000Z",
			differenceC: 7.7,
			verdictAction: "open",
		},
	],
	recommendation: {
		outdoorTrend: {
			direction: "falling",
			changeC: -8.4,
			hours: 1,
			sampleCount: 2,
		},
		strategy: "predictive-open-benefit",
		thresholdC: 27.4,
		marginToThresholdC: 5.7,
	},
	verdict: {
		action: "open",
		title: "Open the windows",
		detail: "Outside appears cooler.",
	},
};

describe("sanitizeTemperatureHistoryEntry", () => {
	it("removes values and recommendations derived from the retired hourly fallback", () => {
		const sanitized = sanitizeTemperatureHistoryEntry(baseEntry);

		expect(sanitized.outside).toEqual({
			unavailableReason:
				"The saved value was not a dedicated current outdoor observation.",
		});
		expect(sanitized.rooms[0]).toEqual({
			zoneId: 1,
			zoneName: "Living room",
			temperatureC: 29.4,
			humidityPercent: undefined,
			observedAt: "2026-07-13T15:43:00.000Z",
		});
		expect(sanitized.recommendation).toBeUndefined();
		expect(sanitized.verdict).toBeUndefined();
		expect(sanitized.verdictAction).toBe("unknown");
	});

	it("keeps dedicated current observations unchanged", () => {
		const entry = {
			...baseEntry,
			outside: {
				...baseEntry.outside,
				source: { name: "Bright Sky DWD observation" },
			},
		};

		expect(sanitizeTemperatureHistoryEntry(entry)).toBe(entry);
	});
});
