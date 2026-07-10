import { describe, expect, it } from "vitest";
import {
	findSustainedThresholdWindow,
	getTimeWeightedForecastTemperature,
} from "./forecast-model";

const minute = 60 * 1000;

describe("getTimeWeightedForecastTemperature", () => {
	it("does not treat a cool final forecast point as the whole horizon", () => {
		const average = getTimeWeightedForecastTemperature({
			currentTemperatureC: 26,
			startTime: 0,
			endTime: 90 * minute,
			forecastPoints: [
				{ timestamp: 30 * minute, temperatureC: 26 },
				{ timestamp: 90 * minute, temperatureC: 20 },
			],
		});

		expect(average).toBeCloseTo(24, 5);
		expect(average).toBeGreaterThan(20);
	});
});

describe("findSustainedThresholdWindow", () => {
	it("rejects a threshold reached only at the final instant", () => {
		const window = findSustainedThresholdWindow(
			[
				{ timestamp: 0, temperatureC: 26 },
				{ timestamp: 60 * minute, temperatureC: 24 },
				{ timestamp: 120 * minute, temperatureC: 22 },
			],
			22,
			30 * minute,
		);

		expect(window).toBeUndefined();
	});

	it("interpolates a useful window instead of snapping to the final point", () => {
		const window = findSustainedThresholdWindow(
			[
				{ timestamp: 0, temperatureC: 26 },
				{ timestamp: 60 * minute, temperatureC: 26 },
				{ timestamp: 120 * minute, temperatureC: 20 },
			],
			23,
			30 * minute,
		);

		expect(window?.startTime).toBe(90 * minute);
		expect(window?.endTime).toBe(120 * minute);
	});

	it("rejects a brief dip below the threshold", () => {
		const window = findSustainedThresholdWindow(
			[
				{ timestamp: 0, temperatureC: 24 },
				{ timestamp: 20 * minute, temperatureC: 21 },
				{ timestamp: 40 * minute, temperatureC: 24 },
			],
			22,
			30 * minute,
		);

		expect(window).toBeUndefined();
	});
});
