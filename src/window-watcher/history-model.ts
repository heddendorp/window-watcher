import type { TemperatureHistoryEntry } from "./types";

const INVALID_CURRENT_SOURCE_NAMES = new Set([
	"Bright Sky DWD hourly observation",
]);

export function sanitizeTemperatureHistoryEntry(
	entry: TemperatureHistoryEntry,
): TemperatureHistoryEntry {
	if (!INVALID_CURRENT_SOURCE_NAMES.has(entry.outside?.source?.name || "")) {
		return entry;
	}

	return {
		...entry,
		outside: {
			unavailableReason:
				"The saved value was not a dedicated current outdoor observation.",
		},
		rooms: entry.rooms.map((room) => ({
			zoneId: room.zoneId,
			zoneName: room.zoneName,
			temperatureC: room.temperatureC,
			humidityPercent: room.humidityPercent,
			observedAt: room.observedAt,
		})),
		recommendation: undefined,
		verdict: undefined,
		verdictAction: "unknown",
	};
}

export function getHistoryEntryLimit(
	durationMs: number,
	sampleIntervalMs: number,
) {
	if (!Number.isFinite(durationMs) || durationMs <= 0) {
		throw new RangeError("History duration must be positive.");
	}
	if (!Number.isFinite(sampleIntervalMs) || sampleIntervalMs <= 0) {
		throw new RangeError("Sample interval must be positive.");
	}

	return Math.ceil(durationMs / sampleIntervalMs) + 1;
}

export function compactDashboardHistoryEntry(
	entry: TemperatureHistoryEntry,
): TemperatureHistoryEntry {
	return {
		checkedAt: entry.checkedAt,
		outside: entry.outside
			? {
					temperatureC: entry.outside.temperatureC,
					observedAt: entry.outside.observedAt,
				}
			: undefined,
		rooms: entry.rooms.map((room) => ({
			zoneId: room.zoneId,
			zoneName: room.zoneName,
			temperatureC: room.temperatureC,
			observedAt: room.observedAt,
		})),
	};
}
