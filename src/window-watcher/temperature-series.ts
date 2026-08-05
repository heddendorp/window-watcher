import type { TemperatureHistoryEntry } from "./types";

export type TemperaturePoint = {
	time: number;
	value: number;
};

const maximumClockSkewMs = 5 * 60 * 1000;

export function getRoomTemperatureSeries(
	history: Array<TemperatureHistoryEntry>,
	zoneId: number | string,
	nowMs = Date.now(),
) {
	const points = history.flatMap((entry): Array<TemperaturePoint> => {
		const room = entry.rooms.find(
			(candidate) => String(candidate.zoneId) === String(zoneId),
		);
		if (!room || !Number.isFinite(room.temperatureC)) return [];

		const time = resolveObservationTime(
			room.observedAt,
			entry.checkedAt,
			nowMs,
		);
		return time == null ? [] : [{ time, value: room.temperatureC }];
	});

	return sortAndDeduplicate(points);
}

export function getOutdoorTemperatureSeries(
	history: Array<TemperatureHistoryEntry>,
	nowMs = Date.now(),
) {
	const points = history.flatMap((entry): Array<TemperaturePoint> => {
		const temperatureC = entry.outside?.temperatureC;
		if (!Number.isFinite(temperatureC)) return [];

		const time = resolveObservationTime(
			entry.outside?.observedAt,
			entry.checkedAt,
			nowMs,
		);
		return time == null ? [] : [{ time, value: Number(temperatureC) }];
	});

	return sortAndDeduplicate(points);
}

export function findNearbyTemperature(
	points: Array<TemperaturePoint>,
	targetTime: number,
	maximumGapMs = 30 * 60 * 1000,
) {
	let nearest: TemperaturePoint | undefined;
	for (const point of points) {
		if (
			Math.abs(point.time - targetTime) <= maximumGapMs &&
			(!nearest ||
				Math.abs(point.time - targetTime) < Math.abs(nearest.time - targetTime))
		) {
			nearest = point;
		}
	}
	return nearest?.value;
}

function resolveObservationTime(
	observedAt: string | undefined,
	checkedAt: string,
	nowMs: number,
) {
	const observedTime = observedAt ? new Date(observedAt).getTime() : Number.NaN;
	if (
		Number.isFinite(observedTime) &&
		observedTime <= nowMs + maximumClockSkewMs
	) {
		return observedTime;
	}

	const checkedTime = new Date(checkedAt).getTime();
	return Number.isFinite(checkedTime) &&
		checkedTime <= nowMs + maximumClockSkewMs
		? checkedTime
		: undefined;
}

function sortAndDeduplicate(points: Array<TemperaturePoint>) {
	return points
		.sort((left, right) => left.time - right.time)
		.filter(
			(point, index, sorted) =>
				index === 0 || point.time !== sorted[index - 1].time,
		);
}
