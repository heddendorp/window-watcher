import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import type { TemperatureHistoryEntry } from "./types";

export function createHistoryCollection(
	history: Array<TemperatureHistoryEntry>,
) {
	return createCollection(
		localOnlyCollectionOptions<TemperatureHistoryEntry, string>({
			id: "window-watcher-history",
			getKey: (entry) => entry.checkedAt,
			initialData: history,
		}),
	);
}
