import type { SampleFailureReason } from "./sample-failure";

export type TrendDirection = "falling" | "steady" | "rising";

export type VerdictAction = "open" | "maybe" | "closed" | "unknown";

export type RoomReading = {
	zoneId: number | string;
	zoneName: string;
	type?: string;
	temperatureC: number;
	humidityPercent?: number;
	observedAt?: string;
	differenceC?: number;
	prediction?: {
		horizonMinutes: number;
		massTemperatureC: number;
		reboundRiskC: number;
		expectedReboundC: number;
		effectiveHotTemperatureC: number;
		predictedOpenTemperatureC: number;
		predictedClosedTemperatureC: number;
		predictedOpenBenefitC: number;
		coolingOpportunityC: number;
		observedCoolingRateCPerHour?: number;
		learnedOpenOffsetC?: number;
		openWindowFloorC?: number;
		coolingWindowStartsAt?: string;
		coolingWindowEndsAt?: string;
	};
	verdict: {
		action: VerdictAction;
		title: string;
		detail: string;
	};
};

export type TemperatureHistoryEntry = {
	checkedAt: string;
	location?: {
		label: string;
		latitude: number;
		longitude: number;
	};
	tado?: {
		homeId?: number | string;
		roomCount?: number;
		referenceZoneId?: number | string;
		referenceZoneName?: string;
		referenceStrategy?: string;
	};
	inside?: {
		temperatureC?: number;
		humidityPercent?: number;
	};
	outside?: {
		temperatureC?: number;
		humidityPercent?: number;
		observedAt?: string;
		unavailableReason?: string;
		source?: {
			name: string;
			stationName?: string;
			distanceMeters?: number;
		};
	};
	rooms: Array<
		Pick<
			RoomReading,
			| "zoneId"
			| "zoneName"
			| "temperatureC"
			| "humidityPercent"
			| "observedAt"
			| "differenceC"
		> & {
			verdictAction?: VerdictAction;
			prediction?: RoomReading["prediction"];
		}
	>;
	recommendation?: CoolingStatus["recommendation"];
	verdict?: CoolingStatus["verdict"];
	verdictAction?: VerdictAction;
	marginC?: number;
};

export type CoolingStatus = {
	checkedAt: string;
	lastFreshAt?: string;
	stale?: boolean;
	staleReason?: string;
	staleFailureReason?: SampleFailureReason;
	cached?: boolean;
	location: {
		label: string;
		latitude: number;
		longitude: number;
	};
	tado: {
		homeId?: number | string;
		roomCount: number;
		referenceZoneId?: number | string;
		referenceZoneName?: string;
		referenceStrategy: string;
	};
	inside: {
		temperatureC?: number;
		humidityPercent?: number;
	};
	rooms: Array<RoomReading>;
	outside: {
		temperatureC?: number;
		humidityPercent?: number;
		observedAt?: string;
		unavailableReason?: string;
		source?: {
			name: string;
			stationName?: string;
			distanceMeters?: number;
		};
	};
	recommendation: {
		outdoorTrend: {
			direction: TrendDirection;
			changeC: number;
			hours: number;
			sampleCount: number;
		};
		forecast?: {
			horizonHours: number;
			minTemperatureC?: number;
			minAt?: string;
			changeC?: number;
			reachesThresholdAt?: string;
			summary?: string;
			source?: {
				name: string;
				stationName?: string;
				distanceMeters?: number;
			};
			points?: Array<{
				time: string;
				temperatureC: number;
			}>;
		};
		prediction?: {
			referenceZoneId?: number | string;
			referenceZoneName?: string;
			horizonMinutes: number;
			targetMaxC: number;
			massTemperatureC: number;
			expectedReboundC: number;
			predictedOpenTemperatureC: number;
			predictedClosedTemperatureC: number;
			predictedOpenBenefitC: number;
			coolingOpportunityC: number;
			openWindowFloorC?: number;
			coolingWindowStartsAt?: string;
			coolingWindowEndsAt?: string;
		};
		strategy: string;
		thresholdC?: number;
		marginToThresholdC?: number;
	};
	verdict: {
		action: VerdictAction;
		title: string;
		detail: string;
	};
	marginC: number;
};

export type DashboardData = {
	status: CoolingStatus;
	history: Array<TemperatureHistoryEntry>;
	generatedAt: string;
	sampling: {
		intervalMs: number;
		nextExpectedCheckAt: string;
	};
};
