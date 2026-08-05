import { describe, expect, it } from "vitest";
import { selectTadoRoomSnapshots } from "./tado-model";

const zones = [
	{ id: 1, name: "Bedroom", type: "HEATING" },
	{ id: 4, name: "Living room", type: "HEATING" },
];
const nowMs = new Date("2026-08-05T08:40:00.000Z").getTime();

const zoneStates = {
	zoneStates: {
		"1": {
			sensorDataPoints: {
				insideTemperature: {
					celsius: 22.98,
					timestamp: "2026-08-05T08:34:16.245Z",
				},
				humidity: { percentage: 44.4 },
			},
		},
		"4": {
			sensorDataPoints: {
				insideTemperature: {
					celsius: 24.35,
					timestamp: "2026-08-05T08:35:00.000Z",
				},
				humidity: { percentage: 49.8 },
			},
		},
	},
};

describe("selectTadoRoomSnapshots", () => {
	it("keeps real sensor timestamps from a bulk zone-state response", () => {
		expect(
			selectTadoRoomSnapshots({ homeId: 42, nowMs, zones, zoneStates }),
		).toEqual([
			{
				homeId: 42,
				zoneId: 1,
				zoneName: "Bedroom",
				type: "HEATING",
				temperatureC: 22.98,
				humidityPercent: 44.4,
				observedAt: "2026-08-05T08:34:16.245Z",
			},
			{
				homeId: 42,
				zoneId: 4,
				zoneName: "Living room",
				type: "HEATING",
				temperatureC: 24.35,
				humidityPercent: 49.8,
				observedAt: "2026-08-05T08:35:00.000Z",
			},
		]);
	});

	it("can restrict the bulk response to one configured zone", () => {
		expect(
			selectTadoRoomSnapshots({
				homeId: 42,
				nowMs,
				selectedZoneId: 4,
				zones,
				zoneStates,
			}),
		).toEqual([
			{
				homeId: 42,
				zoneId: 4,
				zoneName: "Living room",
				type: "HEATING",
				temperatureC: 24.35,
				humidityPercent: 49.8,
				observedAt: "2026-08-05T08:35:00.000Z",
			},
		]);
	});

	it("fails the whole check when a heating room is missing", () => {
		expect(() =>
			selectTadoRoomSnapshots({
				homeId: 42,
				nowMs,
				zones,
				zoneStates: { zoneStates: { "1": zoneStates.zoneStates["1"] } },
			}),
		).toThrow("current temperature for Living room");
	});

	it("rejects a cached observation that is too old for recommendations", () => {
		expect(() =>
			selectTadoRoomSnapshots({
				homeId: 42,
				maximumObservationAgeMs: 5 * 60 * 1000,
				nowMs,
				zones,
				zoneStates,
			}),
		).toThrow("observation for Bedroom is too old");
	});
});
