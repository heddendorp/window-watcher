import { createSampleFailure } from "./sample-failure";

export type TadoZone = {
	id: number | string;
	name: string;
	type?: string;
};

type TadoSensorValue = {
	timestamp?: string;
};

export type TadoZoneState = {
	sensorDataPoints?: {
		insideTemperature?: TadoSensorValue & { celsius?: number };
		humidity?: TadoSensorValue & { percentage?: number };
	};
};

export type TadoZoneStatesResponse = {
	zoneStates?: Record<string, TadoZoneState>;
};

export type TadoRoomSnapshot = {
	homeId: number | string;
	zoneId: number | string;
	zoneName: string;
	type?: string;
	temperatureC: number;
	humidityPercent?: number;
	observedAt?: string;
};

export function selectTadoRoomSnapshots({
	homeId,
	maximumObservationAgeMs = 30 * 60 * 1000,
	nowMs = Date.now(),
	selectedZoneId,
	zones,
	zoneStates,
}: {
	homeId: number | string;
	maximumObservationAgeMs?: number;
	nowMs?: number;
	selectedZoneId?: number | string;
	zones: Array<TadoZone>;
	zoneStates: TadoZoneStatesResponse;
}) {
	const selectedZones = selectedZoneId
		? zones.filter((zone) => String(zone.id) === String(selectedZoneId))
		: zones;

	return selectedZones.flatMap((zone): Array<TadoRoomSnapshot> => {
		const state = zoneStates.zoneStates?.[String(zone.id)];
		const temperature = state?.sensorDataPoints?.insideTemperature;
		if (!Number.isFinite(temperature?.celsius)) {
			if (zone.type === "HOT_WATER") return [];
			throw createSampleFailure(
				`tado did not return a current temperature for ${zone.name}.`,
				"provider_unavailable",
				"tado",
			);
		}
		const observedAt = validTimestamp(temperature?.timestamp, nowMs);
		if (!observedAt) {
			throw createSampleFailure(
				`tado returned an invalid observation time for ${zone.name}.`,
				"provider_unavailable",
				"tado",
			);
		}
		if (nowMs - new Date(observedAt).getTime() > maximumObservationAgeMs) {
			throw createSampleFailure(
				`tado's observation for ${zone.name} is too old.`,
				"provider_unavailable",
				"tado",
			);
		}

		return [
			{
				homeId,
				zoneId: zone.id,
				zoneName: zone.name,
				type: zone.type,
				temperatureC: Number(temperature?.celsius),
				humidityPercent: finiteNumber(
					state?.sensorDataPoints?.humidity?.percentage,
				),
				observedAt,
			},
		];
	});
}

function finiteNumber(value: number | undefined) {
	return Number.isFinite(value) ? value : undefined;
}

function validTimestamp(value: string | undefined, nowMs: number) {
	if (!value) return undefined;
	const timestamp = new Date(value).getTime();
	if (!Number.isFinite(timestamp) || timestamp > nowMs + 5 * 60 * 1000) {
		return undefined;
	}
	return new Date(timestamp).toISOString();
}
