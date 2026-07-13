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
};

export function selectBrightSkyCurrentObservation(
	current: BrightSkyCurrentWeatherResponse | undefined,
): BrightSkyObservation | undefined {
	if (!Number.isFinite(current?.weather?.temperature)) return undefined;

	return {
		temperatureC: Number(current?.weather?.temperature),
		humidityPercent: optionalFiniteNumber(current?.weather?.relative_humidity),
		observedAt: current?.weather?.timestamp,
		source: findWeatherSource(current?.sources, current?.weather?.source_id),
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
