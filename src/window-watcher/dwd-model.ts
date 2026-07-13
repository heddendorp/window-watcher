export type DwdStation = {
	code: string;
	fileCode: string;
	name: string;
	latitude: number;
	longitude: number;
	distanceMeters: number;
};

export type DwdObservation = {
	station: DwdStation;
	temperatureC: number;
	humidityPercent?: number;
	observedAt: string;
	observedAtMs: number;
};

export type DwdConsensus = {
	temperatureC: number;
	humidityPercent?: number;
	observedAt: string;
	stations: Array<DwdStation>;
};

const TEMPERATURE_COLUMN = 9;
const HUMIDITY_COLUMN = 37;
const POI_HEADER_ROWS = 3;
const MAX_FUTURE_CLOCK_SKEW_MS = 10 * 60 * 1000;

export function parseDwdStationList(
	text: string,
	location: { latitude: number; longitude: number },
) {
	const stations = text
		.split(/\r?\n/)
		.slice(1)
		.map((line) => parseDwdStation(line, location))
		.filter((station): station is DwdStation => station != null);
	const uniqueStations = new Map<string, DwdStation>();
	for (const station of stations) {
		const existing = uniqueStations.get(station.fileCode);
		if (!existing || station.distanceMeters < existing.distanceMeters) {
			uniqueStations.set(station.fileCode, station);
		}
	}

	return [...uniqueStations.values()].sort(
		(left, right) => left.distanceMeters - right.distanceMeters,
	);
}

export function parseDwdPoiObservation(
	text: string,
	station: DwdStation,
	options: { nowMs: number; maxAgeMs: number },
): DwdObservation | undefined {
	for (const line of text.split(/\r?\n/).slice(POI_HEADER_ROWS)) {
		const columns = line.split(";");
		const observedAtMs = parseDwdUtcTimestamp(columns[0], columns[1]);
		const temperatureC = parseDwdNumber(columns[TEMPERATURE_COLUMN]);
		if (observedAtMs == null || temperatureC == null) continue;
		if (temperatureC < -60 || temperatureC > 60) continue;

		const ageMs = options.nowMs - observedAtMs;
		if (ageMs < -MAX_FUTURE_CLOCK_SKEW_MS || ageMs > options.maxAgeMs) {
			return undefined;
		}

		const humidityPercent = parseDwdNumber(columns[HUMIDITY_COLUMN]);
		return {
			station,
			temperatureC,
			humidityPercent:
				humidityPercent != null &&
				humidityPercent >= 0 &&
				humidityPercent <= 100
					? humidityPercent
					: undefined,
			observedAt: new Date(observedAtMs).toISOString(),
			observedAtMs,
		};
	}

	return undefined;
}

export function selectDwdConsensus(
	observations: Array<DwdObservation>,
	options: { minimumStations: number; maximumSpreadC: number },
): DwdConsensus | undefined {
	const uniqueObservations = new Map<string, DwdObservation>();
	for (const observation of observations) {
		const existing = uniqueObservations.get(observation.station.fileCode);
		if (!existing || observation.observedAtMs > existing.observedAtMs) {
			uniqueObservations.set(observation.station.fileCode, observation);
		}
	}
	if (uniqueObservations.size < options.minimumStations) return undefined;

	const sorted = [...uniqueObservations.values()].sort(
		(left, right) => left.temperatureC - right.temperatureC,
	);
	let bestCluster: Array<DwdObservation> = [];

	for (let start = 0; start < sorted.length; start += 1) {
		let end = start;
		while (
			end + 1 < sorted.length &&
			sorted[end + 1].temperatureC - sorted[start].temperatureC <=
				options.maximumSpreadC
		) {
			end += 1;
		}

		const candidate = sorted.slice(start, end + 1);
		if (isBetterCluster(candidate, bestCluster)) bestCluster = candidate;
	}

	if (bestCluster.length < options.minimumStations) return undefined;

	const humidities = bestCluster
		.map((observation) => observation.humidityPercent)
		.filter((humidity): humidity is number => humidity != null)
		.sort((left, right) => left - right);
	const oldestObservedAtMs = Math.min(
		...bestCluster.map((observation) => observation.observedAtMs),
	);

	return {
		temperatureC: median(
			bestCluster.map((observation) => observation.temperatureC),
		),
		humidityPercent:
			humidities.length >= options.minimumStations
				? median(humidities)
				: undefined,
		observedAt: new Date(oldestObservedAtMs).toISOString(),
		stations: bestCluster
			.map((observation) => observation.station)
			.sort((left, right) => left.distanceMeters - right.distanceMeters),
	};
}

function parseDwdStation(
	line: string,
	location: { latitude: number; longitude: number },
): DwdStation | undefined {
	const columns = line.split(";");
	const code = columns[2]?.trim();
	const name = columns[3]?.trim();
	const latitude = Number(columns[7]);
	const longitude = Number(columns[8]);
	if (
		!code ||
		!name ||
		!/^[A-Z0-9]{4,5}$/.test(code) ||
		!Number.isFinite(latitude) ||
		!Number.isFinite(longitude)
	) {
		return undefined;
	}

	return {
		code,
		fileCode: code.padEnd(5, "_"),
		name,
		latitude,
		longitude,
		distanceMeters: haversineDistanceMeters(
			location.latitude,
			location.longitude,
			latitude,
			longitude,
		),
	};
}

function parseDwdUtcTimestamp(
	date: string | undefined,
	time: string | undefined,
) {
	const dateMatch = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(date?.trim() || "");
	const timeMatch = /^(\d{2}):(\d{2})$/.exec(time?.trim() || "");
	if (!dateMatch || !timeMatch) return undefined;

	const observedAtMs = Date.UTC(
		2000 + Number(dateMatch[3]),
		Number(dateMatch[2]) - 1,
		Number(dateMatch[1]),
		Number(timeMatch[1]),
		Number(timeMatch[2]),
	);
	return Number.isFinite(observedAtMs) ? observedAtMs : undefined;
}

function parseDwdNumber(value: string | undefined) {
	const normalized = value?.trim().replace(",", ".");
	if (!normalized || normalized === "---") return undefined;
	const parsed = Number(normalized);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function isBetterCluster(
	candidate: Array<DwdObservation>,
	current: Array<DwdObservation>,
) {
	if (candidate.length !== current.length)
		return candidate.length > current.length;
	if (!candidate.length) return false;

	const candidateSpread = clusterSpread(candidate);
	const currentSpread = clusterSpread(current);
	if (candidateSpread !== currentSpread) return candidateSpread < currentSpread;

	return (
		candidate.reduce(
			(total, observation) => total + observation.station.distanceMeters,
			0,
		) <
		current.reduce(
			(total, observation) => total + observation.station.distanceMeters,
			0,
		)
	);
}

function clusterSpread(observations: Array<DwdObservation>) {
	const temperatures = observations.map(
		(observation) => observation.temperatureC,
	);
	return Math.max(...temperatures) - Math.min(...temperatures);
}

function median(values: Array<number>) {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

function haversineDistanceMeters(
	latitudeA: number,
	longitudeA: number,
	latitudeB: number,
	longitudeB: number,
) {
	const earthRadiusMeters = 6_371_000;
	const latitudeDelta = degreesToRadians(latitudeB - latitudeA);
	const longitudeDelta = degreesToRadians(longitudeB - longitudeA);
	const a =
		Math.sin(latitudeDelta / 2) ** 2 +
		Math.cos(degreesToRadians(latitudeA)) *
			Math.cos(degreesToRadians(latitudeB)) *
			Math.sin(longitudeDelta / 2) ** 2;
	return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degreesToRadians(value: number) {
	return (value * Math.PI) / 180;
}
