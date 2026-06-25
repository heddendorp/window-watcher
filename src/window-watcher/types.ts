export type TrendDirection = "falling" | "steady" | "rising";

export type VerdictAction = "open" | "maybe" | "closed";

export type RoomReading = {
	zoneId: number | string;
	zoneName: string;
	type?: string;
	temperatureC: number;
	humidityPercent?: number;
	differenceC: number;
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
	};
	rooms: Array<
		Pick<
			RoomReading,
			"zoneId" | "zoneName" | "temperatureC" | "humidityPercent" | "differenceC"
		> & {
			verdictAction?: VerdictAction;
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
		temperatureC: number;
		humidityPercent?: number;
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
		};
		strategy: string;
		thresholdC: number;
		marginToThresholdC: number;
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
};
