import { describe, expect, it } from "vitest";
import { selectBrightSkyObservation } from "./weather-model";

describe("selectBrightSkyObservation", () => {
	it("prefers the dedicated current-weather observation", () => {
		const observation = selectBrightSkyObservation(
			{
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
			},
			{
				weather: [
					{
						source_id: 20,
						timestamp: "2026-07-13T14:00:00Z",
						temperature: 27,
					},
				],
				sources: [{ id: 20, observation_type: "current" }],
			},
			new Date("2026-07-13T15:30:00Z").getTime(),
		);

		expect(observation).toMatchObject({
			temperatureC: 28.4,
			humidityPercent: 42,
			usedHourlyFallback: false,
			source: { station_name: "Muenchen-Stadt" },
		});
	});

	it("uses the latest hourly observation when current weather is unavailable", () => {
		const observation = selectBrightSkyObservation(
			undefined,
			{
				weather: [
					{
						source_id: 20,
						timestamp: "2026-07-13T14:00:00Z",
						temperature: 21.8,
						relative_humidity: 55,
					},
					{
						source_id: 30,
						timestamp: "2026-07-13T15:00:00Z",
						temperature: 30.6,
					},
				],
				sources: [
					{
						id: 20,
						observation_type: "current",
						station_name: "Oberhaching-Laufzorn",
					},
					{
						id: 30,
						observation_type: "forecast",
						station_name: "Deisenhofen",
					},
				],
			},
			new Date("2026-07-13T15:30:00Z").getTime(),
		);

		expect(observation).toMatchObject({
			temperatureC: 21.8,
			humidityPercent: 55,
			observedAt: "2026-07-13T14:00:00Z",
			usedHourlyFallback: true,
			source: { station_name: "Oberhaching-Laufzorn" },
		});
	});

	it("does not mistake a forecast point for a current observation", () => {
		const observation = selectBrightSkyObservation(
			undefined,
			{
				weather: [
					{
						source_id: 30,
						timestamp: "2026-07-13T15:00:00Z",
						temperature: 30.6,
					},
				],
				sources: [{ id: 30, observation_type: "forecast" }],
			},
			new Date("2026-07-13T15:30:00Z").getTime(),
		);

		expect(observation).toBeUndefined();
	});

	it("rejects an hourly observation older than the current-weather window", () => {
		const observation = selectBrightSkyObservation(
			undefined,
			{
				weather: [
					{
						source_id: 20,
						timestamp: "2026-07-13T14:00:00Z",
						temperature: 21.8,
					},
				],
				sources: [{ id: 20, observation_type: "current" }],
			},
			new Date("2026-07-13T15:31:00Z").getTime(),
		);

		expect(observation).toBeUndefined();
	});
});
