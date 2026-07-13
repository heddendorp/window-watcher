import { describe, expect, it } from "vitest";
import {
	type DwdObservation,
	type DwdStation,
	parseDwdPoiObservation,
	parseDwdStationList,
	selectDwdConsensus,
} from "./dwd-model";

const location = { latitude: 48.0956, longitude: 11.5611 };

const stationList = `#ID;wigosIdentifier;Kennung;Stationsname;Geraetetyp;Messnetz;von_Datum;Geog_Breite;Geog_Laenge
1;id;10865;Muenchen-Stadt;type;15;01.01.1900;48.1632;11.5429
2;id;P830;Oberhaching-Laufzorn;type;15;01.01.1900;48.0130;11.5524
4;id;10865;Muenchen-Stadt duplicate;type;15;01.01.1900;48.1632;11.5429
3;id;bad;Ignored;type;15;01.01.1900;not-a-number;11.5`;

const poiHeader = `surface observations;Parameter description
10865;Unit
Datum;Uhrzeit (UTC)`;

function poiRow(
	date: string,
	time: string,
	temperature: string,
	humidity: string,
) {
	const columns = Array.from({ length: 43 }, () => "---");
	columns[0] = date;
	columns[1] = time;
	columns[9] = temperature;
	columns[37] = humidity;
	return columns.join(";");
}

describe("DWD observation model", () => {
	it("sorts stations by distance and pads DWD POI file codes", () => {
		const stations = parseDwdStationList(stationList, location);

		expect(stations.map((station) => station.name)).toEqual([
			"Muenchen-Stadt",
			"Oberhaching-Laufzorn",
		]);
		expect(stations[0].fileCode).toBe("10865");
		expect(stations[1].fileCode).toBe("P830_");
	});

	it("uses the newest actual temperature and rejects it when stale", () => {
		const station = parseDwdStationList(stationList, location)[0];
		const text = [
			poiHeader,
			poiRow("13.07.26", "15:00", "---", "---"),
			poiRow("13.07.26", "14:00", "29,1", "32"),
		].join("\n");

		expect(
			parseDwdPoiObservation(text, station, {
				nowMs: Date.parse("2026-07-13T15:10:00Z"),
				maxAgeMs: 90 * 60 * 1000,
			}),
		).toMatchObject({
			temperatureC: 29.1,
			humidityPercent: 32,
			observedAt: "2026-07-13T14:00:00.000Z",
		});

		expect(
			parseDwdPoiObservation(text, station, {
				nowMs: Date.parse("2026-07-13T16:00:01Z"),
				maxAgeMs: 90 * 60 * 1000,
			}),
		).toBeUndefined();
	});

	it("requires a fresh agreeing cluster and excludes an outlier", () => {
		const stations = parseDwdStationList(stationList, location);
		const observations = [
			observation(stations[0], 29.1, "2026-07-13T14:00:00Z"),
			observation(stations[1], 30.2, "2026-07-13T14:10:00Z"),
			observation(
				{
					...stations[1],
					code: "00000",
					fileCode: "00000",
					name: "Bad station",
				},
				18.4,
				"2026-07-13T14:10:00Z",
			),
		];

		expect(
			selectDwdConsensus(observations, {
				minimumStations: 2,
				maximumSpreadC: 3,
			}),
		).toMatchObject({
			temperatureC: 29.65,
			observedAt: "2026-07-13T14:00:00.000Z",
			stations: [{ name: "Muenchen-Stadt" }, { name: "Oberhaching-Laufzorn" }],
		});

		expect(
			selectDwdConsensus(observations.slice(0, 1), {
				minimumStations: 2,
				maximumSpreadC: 3,
			}),
		).toBeUndefined();
	});
});

function observation(
	station: DwdStation,
	temperatureC: number,
	observedAt: string,
): DwdObservation {
	return {
		station,
		temperatureC,
		observedAt,
		observedAtMs: Date.parse(observedAt),
	};
}
