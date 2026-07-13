import { describe, expect, it } from "vitest";
import { selectBrightSkyCurrentObservation } from "./weather-model";

describe("selectBrightSkyCurrentObservation", () => {
	it("uses the dedicated current-weather observation", () => {
		const observation = selectBrightSkyCurrentObservation({
			weather: {
				source_id: 10,
				timestamp: "2026-07-13T15:00:00Z",
				temperature: 28.4,
				relative_humidity: 42,
			},
			sources: [
				{
					id: 10,
					observation_type: "synop",
					station_name: "Muenchen-Stadt",
				},
			],
		});

		expect(observation).toMatchObject({
			temperatureC: 28.4,
			humidityPercent: 42,
			source: { station_name: "Muenchen-Stadt" },
		});
	});

	it("reports no observation when the current endpoint has no value", () => {
		expect(selectBrightSkyCurrentObservation(undefined)).toBeUndefined();
		expect(selectBrightSkyCurrentObservation({ weather: {} })).toBeUndefined();
	});
});
