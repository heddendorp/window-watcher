import "@tanstack/react-start/server-only";

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type {
	CoolingStatus,
	RoomReading,
	TemperatureHistoryEntry,
	TrendDirection,
} from "./types";

const ROOT = process.cwd();
const DEFAULT_DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
	? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "window-watcher")
	: path.join(ROOT, "data");
const DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA_DIR;
const TOKEN_FILE =
	process.env.TADO_TOKEN_FILE || path.join(DATA_DIR, ".tado-token.json");
const LEGACY_TOKEN_FILE = path.join(ROOT, ".tado-token.json");
const HISTORY_FILE = path.join(DATA_DIR, "temperature-history.jsonl");
const TADO_CLIENT_ID = "1bb50063-6b0c-4d11-bd99-387f4a91cc46";
const CACHE_MS = 55 * 1000;
const DEFAULT_SAMPLE_INTERVAL_MS = process.env.RAILWAY_ENVIRONMENT_ID
	? 5 * 60 * 1000
	: 60 * 1000;

loadEnv();

const config = {
	locationLabel: process.env.LOCATION_LABEL || "Untergiesing-Harlaching",
	latitude: Number(process.env.LATITUDE || 48.0956),
	longitude: Number(process.env.LONGITUDE || 11.5611),
	homeId: process.env.TADO_HOME_ID || "",
	zoneId: process.env.TADO_ZONE_ID || "",
	coolingMarginC: Number(process.env.COOLING_MARGIN_C || 2),
	requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 5000),
	sampleIntervalMs: Number(
		process.env.SAMPLE_INTERVAL_MS || DEFAULT_SAMPLE_INTERVAL_MS,
	),
	outdoorTrendHours: Number(process.env.OUTDOOR_TREND_HOURS || 3),
	outdoorTrendDeltaC: Number(process.env.OUTDOOR_TREND_DELTA_C || 0.3),
	backgroundSampler: process.env.BACKGROUND_SAMPLER !== "false",
};

let refreshInFlight: Promise<TadoToken> | null = null;
let sampleInFlight: Promise<CoolingStatus | null> | null = null;
let statusCache: { createdAt: number; data: CoolingStatus } | null = null;
let samplerStarted = false;
let lastSampleError: { key: string; loggedAt: number } | null = null;
const tadoDeviceFlows = new Map<string, TadoDeviceFlow>();

type TadoToken = {
	access_token?: string;
	refresh_token?: string;
	expires_at?: number;
	expires_in?: number;
	token_type?: string;
};

type TadoDeviceFlow = {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete: string;
	expiresAt: number;
	intervalSeconds: number;
};

type TadoRoom = {
	homeId: number | string;
	zoneId: number | string;
	zoneName: string;
	type?: string;
	temperatureC: number;
	humidityPercent?: number;
};

type WeatherSource = {
	id?: number;
	dwd_station_id?: string;
	observation_type?: string;
	lat?: number;
	lon?: number;
	station_name?: string;
	wmo_station_id?: string;
	distance?: number;
};

type OutsideWeather = {
	current?: {
		temperatureC?: number;
		humidityPercent?: number;
		observedAt?: string;
		source?: {
			name: string;
			stationName?: string;
			distanceMeters?: number;
		};
	};
	forecast?: {
		source?: {
			name: string;
			stationName?: string;
			distanceMeters?: number;
		};
		points: Array<{
			time: string;
			timestamp: number;
			temperatureC: number;
		}>;
	};
};

function loadEnv() {
	try {
		const raw = readFileSync(path.join(ROOT, ".env"), "utf8");

		for (const line of raw.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;

			const separator = trimmed.indexOf("=");
			if (separator === -1) continue;

			const key = trimmed.slice(0, separator).trim();
			const value = trimmed
				.slice(separator + 1)
				.trim()
				.replace(/^["']|["']$/g, "");

			if (key && process.env[key] == null) process.env[key] = value;
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

async function requestJson<T>(url: string, options: RequestInit = {}) {
	const response = await fetch(url, {
		...options,
		signal: options.signal || AbortSignal.timeout(config.requestTimeoutMs),
	});
	const text = await response.text();
	const data = text ? JSON.parse(text) : {};

	if (!response.ok) {
		const message =
			data.message ||
			data.error_description ||
			data.error ||
			`Request failed with ${response.status}`;
		const error = new Error(message) as Error & {
			status?: number;
			details?: unknown;
		};
		error.status = response.status;
		error.details = data;
		throw error;
	}

	return data as T;
}

function assertLocalTadoReconnectAllowed() {
	if (
		process.env.RAILWAY_ENVIRONMENT_ID ||
		process.env.NODE_ENV === "production"
	) {
		throw Object.assign(
			new Error("tado reconnect is only available on the local dev server."),
			{ status: 403 },
		);
	}
}

export async function startLocalTadoReconnect() {
	assertLocalTadoReconnectAllowed();

	const response = await requestJson<{
		device_code: string;
		user_code: string;
		verification_uri: string;
		verification_uri_complete?: string;
		expires_in?: number;
		interval?: number;
	}>("https://login.tado.com/oauth2/device_authorize", {
		method: "POST",
		body: new URLSearchParams({
			client_id: TADO_CLIENT_ID,
			scope: "offline_access home.user",
		}),
		headers: {
			"content-type": "application/x-www-form-urlencoded",
		},
	});

	const flowId = crypto.randomUUID();
	const expiresAt = Date.now() + Number(response.expires_in || 300) * 1000;
	const flow = {
		deviceCode: response.device_code,
		userCode: response.user_code,
		verificationUri: response.verification_uri,
		verificationUriComplete:
			response.verification_uri_complete ||
			`${response.verification_uri}?user_code=${encodeURIComponent(response.user_code)}`,
		expiresAt,
		intervalSeconds: Number(response.interval || 5),
	};

	tadoDeviceFlows.set(flowId, flow);

	return {
		flowId,
		userCode: flow.userCode,
		verificationUri: flow.verificationUri,
		verificationUriComplete: flow.verificationUriComplete,
		expiresAt: new Date(flow.expiresAt).toISOString(),
		intervalSeconds: flow.intervalSeconds,
	};
}

export async function pollLocalTadoReconnect(flowId: string) {
	assertLocalTadoReconnectAllowed();

	const flow = tadoDeviceFlows.get(flowId);
	if (!flow) {
		return {
			status: "expired" as const,
			message: "Start a new tado reconnect flow.",
		};
	}

	if (Date.now() > flow.expiresAt) {
		tadoDeviceFlows.delete(flowId);
		return {
			status: "expired" as const,
			message: "The tado login code expired. Start a new one.",
		};
	}

	try {
		const token = await requestJson<TadoToken>(
			"https://login.tado.com/oauth2/token",
			{
				method: "POST",
				body: new URLSearchParams({
					client_id: TADO_CLIENT_ID,
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
					device_code: flow.deviceCode,
				}),
				headers: {
					"content-type": "application/x-www-form-urlencoded",
				},
			},
		);

		if (!token.refresh_token) {
			throw new Error(
				"tado authorized the login but did not return a refresh token.",
			);
		}

		await writeToken(token);
		tadoDeviceFlows.delete(flowId);
		statusCache = null;

		return {
			status: "connected" as const,
			message: "tado is connected locally.",
		};
	} catch (error) {
		const details = (error as { details?: { error?: string } }).details;
		if (details?.error === "authorization_pending") {
			return {
				status: "pending" as const,
				message: "Waiting for tado approval.",
			};
		}

		if (details?.error === "slow_down") {
			flow.intervalSeconds += 5;
			return {
				status: "pending" as const,
				message: "Waiting for tado approval.",
			};
		}

		throw error;
	}
}

async function readToken() {
	try {
		return JSON.parse(await fs.readFile(TOKEN_FILE, "utf8")) as TadoToken;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			try {
				return JSON.parse(
					await fs.readFile(LEGACY_TOKEN_FILE, "utf8"),
				) as TadoToken;
			} catch (legacyError) {
				if ((legacyError as NodeJS.ErrnoException).code === "ENOENT") {
					return readTokenFromEnvironment();
				}
				throw legacyError;
			}
		}
		throw error;
	}
}

function readTokenFromEnvironment() {
	if (!process.env.TADO_TOKEN_JSON) return null;
	return JSON.parse(process.env.TADO_TOKEN_JSON) as TadoToken;
}

async function writeToken(token: TadoToken) {
	const expiresAt =
		Date.now() + Math.max(0, Number(token.expires_in || 0) - 60) * 1000;
	const stored = {
		access_token: token.access_token,
		refresh_token: token.refresh_token,
		expires_at: expiresAt,
		token_type: token.token_type || "Bearer",
	};
	await fs.mkdir(path.dirname(TOKEN_FILE), { recursive: true });
	await fs.writeFile(TOKEN_FILE, JSON.stringify(stored, null, 2), {
		mode: 0o600,
	});
	return stored;
}

async function getAccessToken() {
	const token = await readToken();
	if (!token?.refresh_token) {
		throw Object.assign(new Error("tado is not connected yet."), {
			status: 401,
		});
	}

	if (token.access_token && Number(token.expires_at) > Date.now()) {
		return token.access_token;
	}

	refreshInFlight ??= refreshToken(token.refresh_token).finally(() => {
		refreshInFlight = null;
	});

	const refreshed = await refreshInFlight;
	return refreshed.access_token;
}

async function refreshToken(refreshTokenValue: string) {
	const params = new URLSearchParams({
		client_id: TADO_CLIENT_ID,
		grant_type: "refresh_token",
		refresh_token: refreshTokenValue,
	});
	const token = await requestJson<TadoToken>(
		`https://login.tado.com/oauth2/token?${params.toString()}`,
		{ method: "POST" },
	);
	return writeToken(token);
}

async function tadoApi<T>(pathname: string) {
	const token = await getAccessToken();
	return requestJson<T>(`https://my.tado.com/api/v2${pathname}`, {
		headers: { Authorization: `Bearer ${token}` },
	});
}

async function resolveTadoRooms() {
	const me = await tadoApi<{ homes?: Array<{ id: number | string }> }>("/me");
	const homeId = config.homeId || me.homes?.[0]?.id;

	if (!homeId) throw new Error("No tado home found for this account.");

	const zones = await tadoApi<
		Array<{ id: number | string; name: string; type?: string }>
	>(`/homes/${encodeURIComponent(homeId)}/zones`);
	const selectedZones = config.zoneId
		? zones.filter((zone) => String(zone.id) === String(config.zoneId))
		: zones;

	const roomResults = await Promise.all(
		selectedZones.map(async (zone) => {
			const state = await tadoApi<{
				sensorDataPoints?: {
					insideTemperature?: { celsius?: number };
					humidity?: { percentage?: number };
				};
			}>(
				`/homes/${encodeURIComponent(homeId)}/zones/${encodeURIComponent(zone.id)}/state`,
			);
			const temperatureC = state.sensorDataPoints?.insideTemperature?.celsius;

			if (temperatureC == null) return null;

			return {
				homeId,
				zoneId: zone.id,
				zoneName: zone.name,
				type: zone.type,
				temperatureC,
				humidityPercent: state.sensorDataPoints?.humidity?.percentage,
			} satisfies TadoRoom;
		}),
	);

	const rooms = roomResults.filter((room): room is TadoRoom => room != null);
	if (!rooms.length) {
		throw new Error(
			"No tado rooms with inside temperature readings were found.",
		);
	}

	return { homeId, rooms };
}

async function fetchOutsideWeather() {
	const now = new Date();
	const forecastStart = startOfHour(new Date(now.getTime() - 30 * 60 * 1000));
	const forecastEnd = new Date(now.getTime() + 5 * 60 * 60 * 1000);
	const currentParams = new URLSearchParams({
		lat: String(config.latitude),
		lon: String(config.longitude),
	});
	const forecastParams = new URLSearchParams({
		lat: String(config.latitude),
		lon: String(config.longitude),
		date: forecastStart.toISOString(),
		last_date: forecastEnd.toISOString(),
	});

	const [current, forecast] = await Promise.all([
		requestJson<{
			weather?: {
				source_id?: number;
				timestamp?: string;
				temperature?: number;
				relative_humidity?: number;
			};
			sources?: Array<WeatherSource>;
		}>(`https://api.brightsky.dev/current_weather?${currentParams.toString()}`),
		requestJson<{
			weather?: Array<{
				source_id?: number;
				timestamp?: string;
				temperature?: number;
			}>;
			sources?: Array<WeatherSource>;
		}>(`https://api.brightsky.dev/weather?${forecastParams.toString()}`),
	]);

	const currentSource = findWeatherSource(
		current.sources,
		current.weather?.source_id,
	);
	const forecastSource = findWeatherSource(
		forecast.sources,
		forecast.weather?.find((point) => point.source_id != null)?.source_id,
	);

	return {
		current: {
			temperatureC: current.weather?.temperature,
			humidityPercent: current.weather?.relative_humidity,
			observedAt: current.weather?.timestamp,
			source: describeWeatherSource(
				"Bright Sky DWD observation",
				currentSource,
			),
		},
		forecast: {
			source: describeWeatherSource("Bright Sky DWD forecast", forecastSource),
			points: (forecast.weather || [])
				.map((point) => ({
					time: point.timestamp || "",
					timestamp: new Date(point.timestamp || "").getTime(),
					temperatureC: point.temperature,
				}))
				.filter(
					(
						point,
					): point is {
						time: string;
						timestamp: number;
						temperatureC: number;
					} =>
						Boolean(point.time) &&
						Number.isFinite(point.timestamp) &&
						Number.isFinite(point.temperatureC),
				),
		},
	} satisfies OutsideWeather;
}

function startOfHour(date: Date) {
	const rounded = new Date(date);
	rounded.setMinutes(0, 0, 0);
	return rounded;
}

function findWeatherSource(
	sources: Array<WeatherSource> | undefined,
	sourceId: number | undefined,
) {
	if (sourceId == null) return sources?.[0];
	return sources?.find((source) => source.id === sourceId) || sources?.[0];
}

function describeWeatherSource(
	name: string,
	source: WeatherSource | undefined,
) {
	return {
		name,
		stationName: source?.station_name,
		distanceMeters: source?.distance,
	};
}

function buildVerdict(insideC: number, outsideC: number, roomName = "inside") {
	const difference = insideC - outsideC;

	if (difference > config.coolingMarginC) {
		return {
			action: "open" as const,
			title: "Open the windows",
			detail: `Outside is ${difference.toFixed(1)} C cooler than ${roomName}.`,
		};
	}

	if (difference > 0) {
		return {
			action: "maybe" as const,
			title: "Only open briefly",
			detail: `Outside is just ${difference.toFixed(1)} C cooler than ${roomName}.`,
		};
	}

	return {
		action: "closed" as const,
		title: "Keep windows closed",
		detail: `Outside is ${Math.abs(difference).toFixed(1)} C warmer than ${roomName}.`,
	};
}

function analyzeOutdoorTrend(
	history: Array<TemperatureHistoryEntry>,
	outsideC: number,
	checkedAt: string,
) {
	const checkedTime = new Date(checkedAt).getTime();
	const windowStart = checkedTime - config.outdoorTrendHours * 60 * 60 * 1000;
	const points = history
		.map((entry) => ({
			time: new Date(entry.checkedAt).getTime(),
			value: entry.outside?.temperatureC,
		}))
		.filter(
			(point) =>
				Number.isFinite(point.time) &&
				Number.isFinite(point.value) &&
				point.time >= windowStart,
		)
		.sort((a, b) => a.time - b.time);

	if (!points.length) {
		return {
			direction: "steady" as TrendDirection,
			changeC: 0,
			hours: config.outdoorTrendHours,
			sampleCount: 1,
		};
	}

	const first = points[0];
	const changeC = outsideC - Number(first.value);
	const direction =
		changeC <= -config.outdoorTrendDeltaC
			? "falling"
			: changeC >= config.outdoorTrendDeltaC
				? "rising"
				: "steady";

	return {
		direction: direction as TrendDirection,
		changeC,
		hours: Math.max(0, (checkedTime - first.time) / (60 * 60 * 1000)),
		sampleCount: points.length + 1,
	};
}

function analyzeForecast(
	outside: OutsideWeather,
	outsideC: number,
	checkedAt: string,
) {
	const checkedTime = new Date(checkedAt).getTime();
	const horizonHours = 4;
	const horizonEnd = checkedTime + horizonHours * 60 * 60 * 1000;
	const chartStart = startOfHour(
		new Date(checkedTime - 30 * 60 * 1000),
	).getTime();
	const points = (outside.forecast?.points || []).filter(
		(point) => point.timestamp >= chartStart && point.timestamp <= horizonEnd,
	);
	const actionablePoints = points.filter(
		(point) => point.timestamp >= checkedTime && point.timestamp <= horizonEnd,
	);

	if (!actionablePoints.length) return undefined;

	const coolest = actionablePoints.reduce((best, point) =>
		point.temperatureC < best.temperatureC ? point : best,
	);

	return {
		horizonHours,
		minTemperatureC: Number(coolest.temperatureC),
		minAt: coolest.time,
		changeC: Number(coolest.temperatureC) - outsideC,
		source: outside.forecast?.source,
		points,
		actionablePoints,
	};
}

function findThresholdTime(
	forecast: ReturnType<typeof analyzeForecast>,
	thresholdC: number,
) {
	return forecast?.actionablePoints.find(
		(point) => point.temperatureC <= thresholdC,
	)?.time;
}

function buildForecastSummary(
	forecast: ReturnType<typeof analyzeForecast>,
	reachesThresholdAt: string | undefined,
	thresholdC: number,
) {
	if (!forecast?.minTemperatureC) return undefined;
	if (reachesThresholdAt) {
		return `Forecast reaches the cooling threshold around ${formatForecastTime(reachesThresholdAt)}.`;
	}
	return `Forecast low is ${forecast.minTemperatureC.toFixed(1)} C, still above the ${thresholdC.toFixed(1)} C threshold.`;
}

function buildRoomTrendVerdict(
	room: TadoRoom,
	outsideC: number,
	trend: ReturnType<typeof analyzeOutdoorTrend>,
) {
	if (trend.direction === "falling") {
		const limitC = room.temperatureC + 1;
		const difference = limitC - outsideC;
		return {
			action: outsideC <= limitC ? ("open" as const) : ("closed" as const),
			title: outsideC <= limitC ? "Open this window" : "Keep closed",
			detail:
				outsideC <= limitC
					? `Outdoor temperature is falling and close enough for ${room.zoneName}.`
					: `Outside is ${Math.abs(difference).toFixed(1)} C above the falling-air threshold.`,
		};
	}

	const openLimitC = room.temperatureC - config.coolingMarginC;
	const difference = room.temperatureC - outsideC;

	if (outsideC < openLimitC) {
		return {
			action: "open" as const,
			title: "Open this window",
			detail: `Outside is ${difference.toFixed(1)} C cooler than ${room.zoneName}.`,
		};
	}

	if (outsideC < room.temperatureC) {
		return {
			action: "maybe" as const,
			title: "Only open briefly",
			detail: `Outside is cooler than ${room.zoneName}, but not by ${config.coolingMarginC.toFixed(1)} C.`,
		};
	}

	return {
		action: "closed" as const,
		title: "Keep closed",
		detail: `Outside is ${Math.abs(difference).toFixed(1)} C warmer than ${room.zoneName}.`,
	};
}

function buildTrendVerdict(
	rooms: Array<TadoRoom>,
	outsideC: number,
	trend: ReturnType<typeof analyzeOutdoorTrend>,
	forecast?: ReturnType<typeof analyzeForecast>,
) {
	const coldestRoom = rooms.reduce((coldest, room) =>
		room.temperatureC < coldest.temperatureC ? room : coldest,
	);
	const warmestRoom = rooms.reduce((warmest, room) =>
		room.temperatureC > warmest.temperatureC ? room : warmest,
	);

	if (trend.direction === "falling") {
		const limitC = warmestRoom.temperatureC + 1;
		const marginToThresholdC = limitC - outsideC;
		const reachesThresholdAt = findThresholdTime(forecast, limitC);
		const forecastSummary = buildForecastSummary(
			forecast,
			reachesThresholdAt,
			limitC,
		);
		const shouldOpen = outsideC <= limitC;

		return {
			referenceRoom: warmestRoom,
			action: shouldOpen
				? ("open" as const)
				: reachesThresholdAt
					? ("maybe" as const)
					: ("closed" as const),
			title: shouldOpen
				? "Open the windows"
				: reachesThresholdAt
					? "Open soon"
					: "Keep windows closed",
			detail: shouldOpen
				? `Outdoor temperature is falling; outside is at or below ${warmestRoom.zoneName} plus 1.0 C.`
				: reachesThresholdAt
					? `Outdoor temperature is falling and should become useful around ${formatForecastTime(reachesThresholdAt)}.`
					: `Outdoor temperature is falling, but outside is still ${(outsideC - limitC).toFixed(1)} C above ${warmestRoom.zoneName} plus 1.0 C.`,
			strategy: "falling-outdoor-warmest-plus-one",
			thresholdC: limitC,
			marginToThresholdC,
			forecast: forecast
				? {
						horizonHours: forecast.horizonHours,
						minTemperatureC: forecast.minTemperatureC,
						minAt: forecast.minAt,
						changeC: forecast.changeC,
						reachesThresholdAt,
						summary: forecastSummary,
						source: forecast.source,
						points: forecast.points.map((point) => ({
							time: point.time,
							temperatureC: point.temperatureC,
						})),
					}
				: undefined,
		};
	}

	const limitC = coldestRoom.temperatureC - config.coolingMarginC;
	const marginToThresholdC = limitC - outsideC;
	const reachesThresholdAt = findThresholdTime(forecast, limitC);
	const forecastSummary = buildForecastSummary(
		forecast,
		reachesThresholdAt,
		limitC,
	);

	if (outsideC < limitC) {
		return {
			referenceRoom: coldestRoom,
			action: "open" as const,
			title: "Open the windows",
			detail: `Outdoor temperature is ${trend.direction}; outside is more than ${config.coolingMarginC.toFixed(1)} C below ${coldestRoom.zoneName}.`,
			strategy: "rising-or-steady-outdoor-coldest-minus-two",
			thresholdC: limitC,
			marginToThresholdC,
			forecast: forecast
				? {
						horizonHours: forecast.horizonHours,
						minTemperatureC: forecast.minTemperatureC,
						minAt: forecast.minAt,
						changeC: forecast.changeC,
						reachesThresholdAt,
						summary: forecastSummary,
						source: forecast.source,
						points: forecast.points.map((point) => ({
							time: point.time,
							temperatureC: point.temperatureC,
						})),
					}
				: undefined,
		};
	}

	if (reachesThresholdAt) {
		return {
			referenceRoom: coldestRoom,
			action: "maybe" as const,
			title: "Wait for cooler air",
			detail: `Forecast reaches useful cooling around ${formatForecastTime(reachesThresholdAt)}.`,
			strategy: "forecast-cooling-window",
			thresholdC: limitC,
			marginToThresholdC,
			forecast: forecast
				? {
						horizonHours: forecast.horizonHours,
						minTemperatureC: forecast.minTemperatureC,
						minAt: forecast.minAt,
						changeC: forecast.changeC,
						reachesThresholdAt,
						summary: forecastSummary,
						source: forecast.source,
						points: forecast.points.map((point) => ({
							time: point.time,
							temperatureC: point.temperatureC,
						})),
					}
				: undefined,
		};
	}

	if (outsideC < coldestRoom.temperatureC) {
		return {
			referenceRoom: coldestRoom,
			action: "maybe" as const,
			title: "Only open briefly",
			detail: `Outdoor temperature is ${trend.direction}; outside is cooler than ${coldestRoom.zoneName}, but not by ${config.coolingMarginC.toFixed(1)} C.`,
			strategy: "rising-or-steady-outdoor-coldest-minus-two",
			thresholdC: limitC,
			marginToThresholdC,
			forecast: forecast
				? {
						horizonHours: forecast.horizonHours,
						minTemperatureC: forecast.minTemperatureC,
						minAt: forecast.minAt,
						changeC: forecast.changeC,
						reachesThresholdAt,
						summary: forecastSummary,
						source: forecast.source,
						points: forecast.points.map((point) => ({
							time: point.time,
							temperatureC: point.temperatureC,
						})),
					}
				: undefined,
		};
	}

	return {
		referenceRoom: coldestRoom,
		action: "closed" as const,
		title: "Keep windows closed",
		detail: `Outdoor temperature is ${trend.direction}; outside is warmer than ${coldestRoom.zoneName}.`,
		strategy: "rising-or-steady-outdoor-coldest-minus-two",
		thresholdC: limitC,
		marginToThresholdC,
		forecast: forecast
			? {
					horizonHours: forecast.horizonHours,
					minTemperatureC: forecast.minTemperatureC,
					minAt: forecast.minAt,
					changeC: forecast.changeC,
					reachesThresholdAt,
					summary: forecastSummary,
					source: forecast.source,
					points: forecast.points.map((point) => ({
						time: point.time,
						temperatureC: point.temperatureC,
					})),
				}
			: undefined,
	};
}

function formatForecastTime(value: string) {
	return new Intl.DateTimeFormat("en-GB", {
		hour: "2-digit",
		minute: "2-digit",
		timeZone: "Europe/Berlin",
	}).format(new Date(value));
}

async function appendHistory(status: CoolingStatus) {
	await fs.mkdir(DATA_DIR, { recursive: true });

	const entry: TemperatureHistoryEntry = {
		checkedAt: status.checkedAt,
		location: status.location,
		tado: status.tado,
		inside: status.inside,
		outside: status.outside,
		rooms: status.rooms.map((room) => ({
			zoneId: room.zoneId,
			zoneName: room.zoneName,
			temperatureC: room.temperatureC,
			humidityPercent: room.humidityPercent,
			differenceC: room.differenceC,
			verdictAction: room.verdict.action,
		})),
		recommendation: status.recommendation,
		verdict: status.verdict,
		verdictAction: status.verdict.action,
		marginC: status.marginC,
	};

	await fs.appendFile(HISTORY_FILE, `${JSON.stringify(entry)}\n`, {
		mode: 0o600,
	});
}

export async function readHistory(limit = 960) {
	try {
		const raw = await fs.readFile(HISTORY_FILE, "utf8");
		const lines = raw.trim().split("\n").filter(Boolean);
		return lines
			.slice(-limit)
			.map((line) => JSON.parse(line) as TemperatureHistoryEntry);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

function buildStatusFromHistoryEntry(
	entry: TemperatureHistoryEntry | undefined,
	error: Error,
) {
	if (!entry?.outside?.temperatureC) return null;

	const outsideC = entry.outside.temperatureC;
	const rooms = entry.rooms.map((room) => ({
		...room,
		type: "HEATING",
		differenceC: Number(room.temperatureC) - outsideC,
		verdict: buildVerdict(room.temperatureC, outsideC, room.zoneName),
	}));
	const coldestRoom = rooms.reduce((coldest, room) =>
		room.temperatureC < coldest.temperatureC ? room : coldest,
	);

	return {
		checkedAt: new Date().toISOString(),
		lastFreshAt: entry.checkedAt,
		stale: true,
		staleReason: error.message,
		location: entry.location || {
			label: config.locationLabel,
			latitude: config.latitude,
			longitude: config.longitude,
		},
		tado: {
			homeId: entry.tado?.homeId,
			roomCount: rooms.length,
			referenceZoneId: coldestRoom.zoneId,
			referenceZoneName: coldestRoom.zoneName,
			referenceStrategy: "stale-history-coldest-room",
		},
		inside: {
			temperatureC: coldestRoom.temperatureC,
			humidityPercent: coldestRoom.humidityPercent,
		},
		rooms: rooms as Array<RoomReading>,
		outside: {
			temperatureC: outsideC,
			humidityPercent: entry.outside.humidityPercent,
			observedAt: entry.outside.observedAt,
			source: entry.outside.source,
		},
		recommendation: entry.recommendation || {
			outdoorTrend: {
				direction: "steady" as const,
				changeC: 0,
				hours: 0,
				sampleCount: 0,
			},
			strategy: "stale-history",
			thresholdC: coldestRoom.temperatureC - config.coolingMarginC,
			marginToThresholdC:
				coldestRoom.temperatureC - config.coolingMarginC - outsideC,
		},
		verdict: entry.verdict || buildVerdict(coldestRoom.temperatureC, outsideC),
		marginC: entry.marginC || config.coolingMarginC,
	} satisfies CoolingStatus;
}

async function collectFreshCoolingStatus() {
	const [target, outside] = await Promise.all([
		resolveTadoRooms(),
		fetchOutsideWeather(),
	]);
	const outsideC = outside.current?.temperatureC;

	if (outsideC == null) throw new Error("Could not read outside temperature.");

	const previousHistory = await readHistory(
		Math.ceil(config.outdoorTrendHours * 60),
	);
	const checkedAt = new Date().toISOString();
	const trend = analyzeOutdoorTrend(previousHistory, outsideC, checkedAt);
	const forecast = analyzeForecast(outside, outsideC, checkedAt);
	const recommendation = buildTrendVerdict(
		target.rooms,
		outsideC,
		trend,
		forecast,
	);
	const referenceRoom = recommendation.referenceRoom;
	const rooms = target.rooms.map((room) => ({
		...room,
		differenceC: room.temperatureC - outsideC,
		verdict: buildRoomTrendVerdict(room, outsideC, trend),
	}));

	const status: CoolingStatus = {
		checkedAt,
		location: {
			label: config.locationLabel,
			latitude: config.latitude,
			longitude: config.longitude,
		},
		tado: {
			homeId: target.homeId,
			roomCount: rooms.length,
			referenceZoneId: referenceRoom.zoneId,
			referenceZoneName: referenceRoom.zoneName,
			referenceStrategy: recommendation.strategy,
		},
		inside: {
			temperatureC: referenceRoom.temperatureC,
			humidityPercent: referenceRoom.humidityPercent,
		},
		rooms,
		outside: {
			temperatureC: outsideC,
			humidityPercent: outside.current?.humidityPercent,
			observedAt: outside.current?.observedAt,
			source: outside.current?.source,
		},
		recommendation: {
			outdoorTrend: trend,
			forecast: recommendation.forecast,
			strategy: recommendation.strategy,
			thresholdC: recommendation.thresholdC,
			marginToThresholdC: recommendation.marginToThresholdC,
		},
		verdict: {
			action: recommendation.action,
			title: recommendation.title,
			detail: recommendation.detail,
		},
		marginC: config.coolingMarginC,
	};

	await appendHistory(status);
	statusCache = { createdAt: Date.now(), data: status };
	return status;
}

async function sampleCoolingStatus(reason = "interval") {
	if (sampleInFlight) return sampleInFlight;

	sampleInFlight = collectFreshCoolingStatus()
		.then((status) => {
			console.log(`[window-watcher:${reason}] recorded ${status.checkedAt}`);
			return status;
		})
		.catch(async (error: Error) => {
			logSampleError(reason, error);
			const history = await readHistory(1);
			const fallback = buildStatusFromHistoryEntry(history.at(-1), error);
			if (fallback) statusCache = { createdAt: Date.now(), data: fallback };
			return fallback;
		})
		.finally(() => {
			sampleInFlight = null;
		});

	return sampleInFlight;
}

function logSampleError(reason: string, error: Error) {
	const key = `${reason}:${error.message}`;
	const now = Date.now();
	if (lastSampleError?.key === key && now - lastSampleError.loggedAt < 60_000) {
		return;
	}

	lastSampleError = { key, loggedAt: now };
	process.stderr.write(`[window-watcher:${reason}] ${error.message}\n`);
}

export async function recordCoolingStatusSample(reason = "manual") {
	const sampled = await sampleCoolingStatus(reason);
	if (!sampled) {
		throw new Error("Could not record a fresh temperature sample.");
	}
	return sampled;
}

async function getCoolingStatus() {
	if (statusCache && Date.now() - statusCache.createdAt < CACHE_MS) {
		return { ...statusCache.data, cached: true };
	}

	const sampled = await sampleCoolingStatus("request");
	if (sampled) return sampled;

	const history = await readHistory(1);
	const fallback = buildStatusFromHistoryEntry(
		history.at(-1),
		new Error("Fresh readings are temporarily unavailable."),
	);
	if (!fallback) {
		throw new Error("Could not read fresh temperatures and no history exists.");
	}
	return fallback;
}

export function startBackgroundSampler() {
	if (!config.backgroundSampler) return;
	if (samplerStarted) return;
	samplerStarted = true;

	void sampleCoolingStatus("startup");
	setInterval(() => {
		void sampleCoolingStatus("interval");
	}, config.sampleIntervalMs);
}

export async function getDashboardPayload() {
	startBackgroundSampler();
	const [status, history] = await Promise.all([
		getCoolingStatus(),
		readHistory(7 * 24 * 60),
	]);
	return {
		status,
		history,
		generatedAt: new Date().toISOString(),
	};
}
