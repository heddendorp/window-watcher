export type WeatherSource = {
	id?: number;
	dwd_station_id?: string;
	observation_type?: string;
	lat?: number;
	lon?: number;
	station_name?: string;
	wmo_station_id?: string;
	distance?: number;
};

type BrightSkyWeatherPoint = {
	source_id?: number;
	timestamp?: string;
	temperature?: number;
	relative_humidity?: number | null;
};

export type BrightSkyCurrentWeatherResponse = {
	weather?: BrightSkyWeatherPoint;
	sources?: Array<WeatherSource>;
};

export type BrightSkyHourlyWeatherResponse = {
	weather?: Array<BrightSkyWeatherPoint>;
	sources?: Array<WeatherSource>;
};

export type BrightSkyObservation = {
	temperatureC: number;
	humidityPercent?: number;
	observedAt?: string;
	source?: WeatherSource;
	usedHourlyFallback: boolean;
};

const DEFAULT_MAX_HOURLY_OBSERVATION_AGE_MS = 90 * 60 * 1000;

export function selectBrightSkyObservation(
	current: BrightSkyCurrentWeatherResponse | undefined,
	hourly: BrightSkyHourlyWeatherResponse | undefined,
	nowMs = Date.now(),
	maxHourlyObservationAgeMs = DEFAULT_MAX_HOURLY_OBSERVATION_AGE_MS,
): BrightSkyObservation | undefined {
	if (Number.isFinite(current?.weather?.temperature)) {
		return {
			temperatureC: Number(current?.weather?.temperature),
			humidityPercent: optionalFiniteNumber(
				current?.weather?.relative_humidity,
			),
			observedAt: current?.weather?.timestamp,
			source: findWeatherSource(current?.sources, current?.weather?.source_id),
			usedHourlyFallback: false,
		};
	}

	const candidates = (hourly?.weather || [])
		.map((point) => ({
			point,
			source: findWeatherSource(hourly?.sources, point.source_id),
			timestamp: new Date(point.timestamp || "").getTime(),
		}))
		.filter(
			(candidate) =>
				candidate.source?.observation_type !== "forecast" &&
				candidate.source != null &&
				Number.isFinite(candidate.point.temperature) &&
				Number.isFinite(candidate.timestamp) &&
				candidate.timestamp >= nowMs - maxHourlyObservationAgeMs &&
				candidate.timestamp <= nowMs,
		)
		.sort((a, b) => b.timestamp - a.timestamp);

	const latest = candidates[0];
	if (!latest) return undefined;

	return {
		temperatureC: Number(latest.point.temperature),
		humidityPercent: optionalFiniteNumber(latest.point.relative_humidity),
		observedAt: latest.point.timestamp,
		source: latest.source,
		usedHourlyFallback: true,
	};
}

function findWeatherSource(
	sources: Array<WeatherSource> | undefined,
	sourceId: number | undefined,
) {
	if (sourceId == null) return sources?.[0];
	return sources?.find((source) => source.id === sourceId);
}

function optionalFiniteNumber(value: number | null | undefined) {
	return Number.isFinite(value) ? Number(value) : undefined;
}
