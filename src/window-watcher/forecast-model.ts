export type ForecastPoint = {
	timestamp: number;
	temperatureC: number;
};

export type ThresholdWindow = {
	startTime: number;
	endTime: number;
};

function sortForecastPoints(points: Array<ForecastPoint>) {
	return points
		.filter(
			(point) =>
				Number.isFinite(point.timestamp) && Number.isFinite(point.temperatureC),
		)
		.sort((left, right) => left.timestamp - right.timestamp);
}

export function getForecastTemperatureAt(
	points: Array<ForecastPoint>,
	targetTime: number,
) {
	const sorted = sortForecastPoints(points);
	if (!sorted.length || !Number.isFinite(targetTime)) return undefined;

	const exact = sorted.find((point) => point.timestamp === targetTime);
	if (exact) return exact.temperatureC;

	const before = sorted.findLast((point) => point.timestamp < targetTime);
	const after = sorted.find((point) => point.timestamp > targetTime);
	if (!before || !after) {
		return before?.temperatureC ?? after?.temperatureC;
	}

	const progress =
		(targetTime - before.timestamp) / (after.timestamp - before.timestamp);
	return (
		before.temperatureC + (after.temperatureC - before.temperatureC) * progress
	);
}

export function getTimeWeightedForecastTemperature({
	currentTemperatureC,
	startTime,
	endTime,
	forecastPoints,
}: {
	currentTemperatureC: number;
	startTime: number;
	endTime: number;
	forecastPoints: Array<ForecastPoint>;
}) {
	if (
		!Number.isFinite(currentTemperatureC) ||
		!Number.isFinite(startTime) ||
		!Number.isFinite(endTime) ||
		endTime <= startTime
	) {
		return currentTemperatureC;
	}

	const points = sortForecastPoints([
		{ timestamp: startTime, temperatureC: currentTemperatureC },
		...forecastPoints.filter((point) => point.timestamp > startTime),
	]);
	const endTemperatureC =
		getForecastTemperatureAt(points, endTime) ?? currentTemperatureC;
	const timeline = [
		{ timestamp: startTime, temperatureC: currentTemperatureC },
		...points.filter(
			(point) => point.timestamp > startTime && point.timestamp < endTime,
		),
		{ timestamp: endTime, temperatureC: endTemperatureC },
	];

	let weightedTemperature = 0;
	for (let index = 1; index < timeline.length; index += 1) {
		const previous = timeline[index - 1];
		const current = timeline[index];
		const duration = current.timestamp - previous.timestamp;
		weightedTemperature +=
			((previous.temperatureC + current.temperatureC) / 2) * duration;
	}

	return weightedTemperature / (endTime - startTime);
}

export function findSustainedThresholdWindow(
	points: Array<ForecastPoint>,
	thresholdC: number,
	minimumDurationMs: number,
) {
	const sorted = sortForecastPoints(points);
	if (
		sorted.length < 2 ||
		!Number.isFinite(thresholdC) ||
		!Number.isFinite(minimumDurationMs) ||
		minimumDurationMs <= 0
	) {
		return undefined;
	}

	let activeStart: number | undefined;
	let activeEnd: number | undefined;

	for (let index = 1; index < sorted.length; index += 1) {
		const previous = sorted[index - 1];
		const current = sorted[index];
		if (current.timestamp <= previous.timestamp) continue;

		const previousBelow = previous.temperatureC <= thresholdC;
		const currentBelow = current.temperatureC <= thresholdC;
		let segmentStart: number | undefined;
		let segmentEnd: number | undefined;

		if (previousBelow && currentBelow) {
			segmentStart = previous.timestamp;
			segmentEnd = current.timestamp;
		} else if (previousBelow !== currentBelow) {
			const progress =
				(thresholdC - previous.temperatureC) /
				(current.temperatureC - previous.temperatureC);
			const crossingTime =
				previous.timestamp +
				progress * (current.timestamp - previous.timestamp);

			if (previousBelow) {
				segmentStart = previous.timestamp;
				segmentEnd = crossingTime;
			} else {
				segmentStart = crossingTime;
				segmentEnd = current.timestamp;
			}
		}

		if (segmentStart == null || segmentEnd == null) {
			activeStart = undefined;
			activeEnd = undefined;
			continue;
		}

		if (
			activeStart == null ||
			activeEnd == null ||
			segmentStart > activeEnd + 1
		) {
			activeStart = segmentStart;
			activeEnd = segmentEnd;
		} else {
			activeEnd = Math.max(activeEnd, segmentEnd);
		}

		if (activeEnd - activeStart >= minimumDurationMs) {
			return {
				startTime: activeStart,
				endTime: activeEnd,
			} satisfies ThresholdWindow;
		}
	}

	return undefined;
}
