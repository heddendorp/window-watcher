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
		})),
		recommendation: undefined,
		verdict: undefined,
		verdictAction: "unknown",
	};
}
