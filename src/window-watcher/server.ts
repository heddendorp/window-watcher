import "@tanstack/react-start/server-only";

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
	type DwdConsensus,
	type DwdStation,
	parseDwdPoiObservation,
	parseDwdStationList,
	selectDwdConsensus,
} from "./dwd-model";
import {
	findSustainedThresholdWindow,
	getForecastTemperatureAt,
	getTimeWeightedForecastTemperature,
} from "./forecast-model";
import { sanitizeTemperatureHistoryEntry } from "./history-model";
import { classifySampleFailure, createSampleFailure } from "./sample-failure";
import { getNextExpectedCheckAt } from "./sampling-schedule";
import {
	selectTadoRoomSnapshots,
	type TadoRoomSnapshot,
	type TadoZone,
	type TadoZoneStatesResponse,
} from "./tado-model";
import { buildStoredTadoToken, type TadoTokenResponse } from "./tado-token";
import {
	findNearbyTemperature,
	getOutdoorTemperatureSeries,
	getRoomTemperatureSeries,
} from "./temperature-series";
import type {
	CoolingStatus,
	RoomReading,
	TemperatureHistoryEntry,
	TrendDirection,
} from "./types";
import {
	type BrightSkyCurrentWeatherResponse,
	type BrightSkyHourlyWeatherResponse,
	selectBrightSkyCurrentObservation,
	type WeatherSource,
} from "./weather-model";

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
const TADO_LOGIN_ORIGIN = "https://login.tado.com";
const CACHE_MS = 55 * 1000;
const DEFAULT_SAMPLE_INTERVAL_MS = process.env.RAILWAY_ENVIRONMENT_ID
	? 10 * 60 * 1000
	: 60 * 1000;
const DEFAULT_WEATHER_CACHE_MS = 4 * 60 * 1000;
const DEFAULT_WEATHER_RATE_LIMIT_BACKOFF_MS = 10 * 60 * 1000;
const DEFAULT_DWD_OBSERVATION_MAX_AGE_MS = 90 * 60 * 1000;
const DEFAULT_DWD_MINIMUM_STATIONS = 2;
const DEFAULT_DWD_MAXIMUM_SPREAD_C = 3;
const DWD_STATION_CANDIDATE_COUNT = 6;
const DWD_STATION_LIST_CACHE_MS = 24 * 60 * 60 * 1000;
const DWD_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DWD_STATION_LIST_URL =
	"https://opendata.dwd.de/weather/weather_reports/stationlist_synoptic_germany.csv";
const DWD_POI_BASE_URL = "https://opendata.dwd.de/weather/weather_reports/poi";
const DEFAULT_TADO_RATE_LIMIT_BACKOFF_MS = 10 * 60 * 1000;
const DEFAULT_TADO_OBSERVATION_MAX_AGE_MS = 30 * 60 * 1000;
const TADO_TOPOLOGY_CACHE_MS = 60 * 60 * 1000;
const TADO_RECONNECT_START_WINDOW_MS = 10 * 60 * 1000;
const TADO_RECONNECT_MAX_STARTS_PER_WINDOW = 12;
const DEFAULT_THERMAL_MASS_TAU_HOURS = 8;
const DEFAULT_REBOUND_FACTOR = 0.7;
const DEFAULT_PREDICTION_HORIZON_MINUTES = 90;
const DEFAULT_MIN_PREDICTED_OPEN_BENEFIT_C = 0.3;
const DEFAULT_TARGET_MAX_C = 22.5;
const DEFAULT_MIN_FORECAST_COOLING_WINDOW_MINUTES = 30;
const IS_RAILWAY =
	Boolean(process.env.RAILWAY_ENVIRONMENT_ID) ||
	Boolean(process.env.RAILWAY_ENVIRONMENT);

loadEnv();

function shouldStartBackgroundSampler() {
	if (process.env.BACKGROUND_SAMPLER === "true") {
		return true;
	}

	if (process.env.BACKGROUND_SAMPLER === "false") {
		return false;
	}

	return !IS_RAILWAY;
}

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
	backgroundSampler: shouldStartBackgroundSampler(),
	weatherCacheMs: Number(
		process.env.WEATHER_CACHE_MS || DEFAULT_WEATHER_CACHE_MS,
	),
	weatherRateLimitBackoffMs: Number(
		process.env.WEATHER_RATE_LIMIT_BACKOFF_MS ||
			DEFAULT_WEATHER_RATE_LIMIT_BACKOFF_MS,
	),
	dwdObservationMaxAgeMs: Math.min(
		2 * 60 * 60 * 1000,
		Math.max(
			30 * 60 * 1000,
			Number(process.env.DWD_OBSERVATION_MAX_AGE_MS) ||
				DEFAULT_DWD_OBSERVATION_MAX_AGE_MS,
		),
	),
	dwdMinimumStations: Math.max(
		2,
		Math.floor(
			Number(process.env.DWD_MINIMUM_STATIONS) || DEFAULT_DWD_MINIMUM_STATIONS,
		),
	),
	dwdMaximumSpreadC: Math.min(
		5,
		Math.max(
			0.5,
			Number(process.env.DWD_MAXIMUM_SPREAD_C) || DEFAULT_DWD_MAXIMUM_SPREAD_C,
		),
	),
	tadoRateLimitBackoffMs: Number(
		process.env.TADO_RATE_LIMIT_BACKOFF_MS ||
			DEFAULT_TADO_RATE_LIMIT_BACKOFF_MS,
	),
	tadoObservationMaxAgeMs: Math.min(
		60 * 60 * 1000,
		Math.max(
			20 * 60 * 1000,
			Number(process.env.TADO_OBSERVATION_MAX_AGE_MS) ||
				DEFAULT_TADO_OBSERVATION_MAX_AGE_MS,
		),
	),
	thermalMassTauHours: Number(
		process.env.THERMAL_MASS_TAU_HOURS || DEFAULT_THERMAL_MASS_TAU_HOURS,
	),
	reboundFactor: Number(process.env.REBOUND_FACTOR || DEFAULT_REBOUND_FACTOR),
	predictionHorizonMinutes: Number(
		process.env.PREDICTION_HORIZON_MINUTES ||
			DEFAULT_PREDICTION_HORIZON_MINUTES,
	),
	minPredictedOpenBenefitC: Number(
		process.env.MIN_PREDICTED_OPEN_BENEFIT_C ||
			DEFAULT_MIN_PREDICTED_OPEN_BENEFIT_C,
	),
	targetMaxC: Number(process.env.TARGET_MAX_C || DEFAULT_TARGET_MAX_C),
	minForecastCoolingWindowMinutes: Number(
		process.env.MIN_FORECAST_COOLING_WINDOW_MINUTES ||
			DEFAULT_MIN_FORECAST_COOLING_WINDOW_MINUTES,
	),
};

let refreshInFlight: Promise<TadoToken> | null = null;
let tokenMutationLock: Promise<void> = Promise.resolve();
let sampleInFlight: Promise<CoolingStatus | null> | null = null;
let statusCache: { createdAt: number; data: CoolingStatus } | null = null;
let samplerStarted = false;
let lastSampleError: { key: string; loggedAt: number } | null = null;
let lastSampleFailure: Error | null = null;
let outsideWeatherCache: { createdAt: number; data: OutsideWeather } | null =
	null;
let dwdStationCache: { createdAt: number; stations: Array<DwdStation> } | null =
	null;
let dwdObservationCache: {
	createdAt: number;
	consensus?: DwdConsensus;
} | null = null;
let weatherRateLimitUntil = 0;
let tadoRateLimitUntil = 0;
let tadoTopologyCache: {
	createdAt: number;
	homeId: number | string;
	zones: Array<TadoZone>;
} | null = null;
const tadoDeviceFlows = new Map<string, TadoDeviceFlow>();
let tadoReconnectStarts: Array<number> = [];

type TadoToken = TadoTokenResponse;

type TadoDeviceFlow = {
	ownerId: string;
	approvedToken?: TadoToken;
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete: string;
	expiresAt: number;
	intervalSeconds: number;
	nextPollAt: number;
};

type TadoRoom = TadoRoomSnapshot;

type ModeledRoom = TadoRoom & {
	differenceC: number;
	prediction: NonNullable<RoomReading["prediction"]>;
};

type OutsideWeather = {
	currentUnavailableReason?: string;
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

function isHttpError(error: unknown, status: number) {
	return (
		error instanceof Error &&
		"status" in error &&
		(error as { status?: number }).status === status
	);
}

function tagProviderError(error: unknown, provider: string) {
	const detail = error instanceof Error ? error.message : "request failed";
	return Object.assign(new Error(`${provider} failed: ${detail}`), {
		cause: error,
		provider,
	});
}

async function requestJson<T>(
	url: string,
	options: RequestInit & { errorContext?: string } = {},
) {
	const { errorContext, ...fetchOptions } = options;
	let response: Response;
	let text: string;
	try {
		response = await fetch(url, {
			...fetchOptions,
			signal:
				fetchOptions.signal || AbortSignal.timeout(config.requestTimeoutMs),
		});
		text = await response.text();
	} catch (error) {
		if (errorContext) throw tagProviderError(error, errorContext);
		throw error;
	}
	let data: Record<string, unknown> = {};
	try {
		data = text ? JSON.parse(text) : {};
	} catch {
		data = {};
	}

	if (!response.ok) {
		const providerMessage = [
			data.message,
			data.detail,
			data.error_description,
			data.error,
		].find(
			(value): value is string => typeof value === "string" && value.length > 0,
		);
		const message =
			providerMessage ||
			`${errorContext || "Request"} failed with ${response.status}`;
		const error = new Error(message) as Error & {
			status?: number;
			details?: unknown;
			provider?: string;
		};
		error.status = response.status;
		error.details = data;
		if (errorContext) error.provider = errorContext;
		throw error;
	}

	return data as T;
}

async function requestText(url: string, errorContext: string) {
	let response: Response;
	try {
		response = await fetch(url, {
			redirect: "error",
			signal: AbortSignal.timeout(config.requestTimeoutMs),
		});
	} catch (error) {
		throw tagProviderError(error, errorContext);
	}
	if (!response.ok) {
		throw Object.assign(
			new Error(`${errorContext} failed with ${response.status}`),
			{ status: response.status, provider: errorContext },
		);
	}

	const contentLength = Number(response.headers.get("content-length"));
	if (
		Number.isFinite(contentLength) &&
		contentLength > DWD_MAX_RESPONSE_BYTES
	) {
		throw new Error(`${errorContext} response was unexpectedly large.`);
	}

	let text: string;
	try {
		text = await response.text();
	} catch (error) {
		throw tagProviderError(error, errorContext);
	}
	if (Buffer.byteLength(text, "utf8") > DWD_MAX_RESPONSE_BYTES) {
		throw new Error(`${errorContext} response was unexpectedly large.`);
	}
	return text;
}

function validateTadoVerificationUrl(value: string) {
	const url = new URL(value);
	if (url.origin !== TADO_LOGIN_ORIGIN) {
		throw new Error("tado returned an unexpected verification address.");
	}
	return url;
}

function requireTadoResponseString(value: unknown, field: string) {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`tado returned an invalid ${field}.`);
	}
	return value;
}

function boundedTadoSeconds(
	value: unknown,
	fallback: number,
	minimum: number,
	maximum: number,
) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function claimTadoReconnectStart() {
	const cutoff = Date.now() - TADO_RECONNECT_START_WINDOW_MS;
	tadoReconnectStarts = tadoReconnectStarts.filter((startedAt) => {
		return startedAt > cutoff;
	});
	if (tadoReconnectStarts.length >= TADO_RECONNECT_MAX_STARTS_PER_WINDOW) {
		throw Object.assign(
			new Error(
				"Too many tado reconnect attempts. Try again in a few minutes.",
			),
			{ status: 429 },
		);
	}
	tadoReconnectStarts.push(Date.now());
}

async function assertTadoReconnectHome(token: TadoToken) {
	if (!config.homeId) {
		if (IS_RAILWAY || process.env.NODE_ENV === "production") {
			throw Object.assign(
				new Error(
					"TADO_HOME_ID must be configured before tado can reconnect in production.",
				),
				{ reconnectTerminal: true, status: 503 },
			);
		}
		return;
	}
	if (!token.access_token) {
		throw Object.assign(
			new Error("tado did not return an access token for verification."),
			{ reconnectTerminal: true, status: 502 },
		);
	}

	const me = await requestJson<{ homes?: Array<{ id: number | string }> }>(
		"https://my.tado.com/api/v2/me",
		{
			errorContext: "tado reconnect",
			headers: { Authorization: `Bearer ${token.access_token}` },
		},
	);
	const expectedHomeId = String(config.homeId);
	const hasExpectedHome = me.homes?.some((home) => {
		return String(home.id) === expectedHomeId;
	});
	if (!hasExpectedHome) {
		throw Object.assign(
			new Error(
				"The approved tado account does not have access to this Window Watcher home.",
			),
			{ reconnectTerminal: true, status: 403 },
		);
	}
}

function isTerminalTadoReconnectError(error: unknown) {
	return Boolean(
		error instanceof Error &&
			"reconnectTerminal" in error &&
			(error as { reconnectTerminal?: boolean }).reconnectTerminal,
	);
}

async function withTokenMutation<T>(mutation: () => Promise<T>) {
	const previousMutation = tokenMutationLock;
	let releaseMutation: () => void = () => undefined;
	tokenMutationLock = new Promise<void>((resolve) => {
		releaseMutation = resolve;
	});

	await previousMutation;
	try {
		return await mutation();
	} finally {
		releaseMutation();
	}
}

export async function startTadoReconnectFlow(ownerId: string) {
	if (!ownerId) throw new Error("A reconnect owner is required.");
	claimTadoReconnectStart();

	const now = Date.now();
	for (const [flowId, flow] of tadoDeviceFlows) {
		if (flow.expiresAt <= now || flow.ownerId === ownerId) {
			tadoDeviceFlows.delete(flowId);
		}
	}

	const response = await requestJson<{
		device_code?: unknown;
		user_code?: unknown;
		verification_uri?: unknown;
		verification_uri_complete?: unknown;
		expires_in?: unknown;
		interval?: unknown;
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

	const createdAt = Date.now();
	const deviceCode = requireTadoResponseString(
		response.device_code,
		"device code",
	);
	const userCode = requireTadoResponseString(response.user_code, "user code");
	const verificationUriValue = requireTadoResponseString(
		response.verification_uri,
		"verification address",
	);
	const expiresInSeconds = boundedTadoSeconds(
		response.expires_in,
		300,
		60,
		600,
	);
	const intervalSeconds = boundedTadoSeconds(response.interval, 5, 3, 30);
	const flowId = crypto.randomUUID();
	const expiresAt = createdAt + expiresInSeconds * 1000;
	const verificationUri = validateTadoVerificationUrl(verificationUriValue);
	const verificationUriComplete = response.verification_uri_complete
		? validateTadoVerificationUrl(
				requireTadoResponseString(
					response.verification_uri_complete,
					"complete verification address",
				),
			)
		: new URL(verificationUri);
	if (!response.verification_uri_complete) {
		verificationUriComplete.searchParams.set("user_code", userCode);
	}
	const flow = {
		ownerId,
		deviceCode,
		userCode,
		verificationUri: verificationUri.toString(),
		verificationUriComplete: verificationUriComplete.toString(),
		expiresAt,
		intervalSeconds,
		nextPollAt: createdAt + intervalSeconds * 1000,
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

export async function pollTadoReconnectFlow(flowId: string, ownerId: string) {
	const flow = tadoDeviceFlows.get(flowId);
	if (!flow || flow.ownerId !== ownerId) {
		return {
			status: "expired" as const,
			message: "Start a new tado reconnect flow.",
		};
	}

	const now = Date.now();
	if (now > flow.expiresAt) {
		tadoDeviceFlows.delete(flowId);
		return {
			status: "expired" as const,
			message: "The tado login code expired. Start a new one.",
		};
	}
	if (now < flow.nextPollAt) {
		return {
			status: "pending" as const,
			message: "Waiting for tado approval.",
			intervalSeconds: Math.max(1, Math.ceil((flow.nextPollAt - now) / 1000)),
		};
	}
	flow.nextPollAt = now + flow.intervalSeconds * 1000;

	let token = flow.approvedToken;
	if (!token) {
		try {
			token = await requestJson<TadoToken>(
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
		} catch (error) {
			const details = (error as { details?: { error?: string } }).details;
			if (details?.error === "authorization_pending") {
				return {
					status: "pending" as const,
					message: "Waiting for tado approval.",
					intervalSeconds: flow.intervalSeconds,
				};
			}

			if (details?.error === "slow_down") {
				flow.intervalSeconds += 5;
				flow.nextPollAt = Date.now() + flow.intervalSeconds * 1000;
				return {
					status: "pending" as const,
					message: "Waiting for tado approval.",
					intervalSeconds: flow.intervalSeconds,
				};
			}

			if (
				details?.error === "access_denied" ||
				details?.error === "expired_token"
			) {
				tadoDeviceFlows.delete(flowId);
				return {
					status: "denied" as const,
					message: "tado did not approve this reconnect. Start a new one.",
				};
			}

			throw error;
		}
		flow.approvedToken = token;
	}

	if (!token.access_token || !token.refresh_token) {
		tadoDeviceFlows.delete(flowId);
		return {
			status: "denied" as const,
			message: "tado did not return a complete authorization. Start again.",
		};
	}

	try {
		await assertTadoReconnectHome(token);
		await withTokenMutation(() => writeToken(token));
	} catch (error) {
		if (isTerminalTadoReconnectError(error)) {
			tadoDeviceFlows.delete(flowId);
			return {
				status: "denied" as const,
				message: (error as Error).message,
			};
		}
		throw error;
	}

	tadoDeviceFlows.delete(flowId);
	statusCache = null;
	tadoTopologyCache = null;
	tadoRateLimitUntil = 0;

	return {
		status: "connected" as const,
		message: "tado is connected.",
	};
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

async function writeToken(token: TadoToken, fallbackRefreshToken?: string) {
	const stored = buildStoredTadoToken(token, fallbackRefreshToken);
	await fs.mkdir(path.dirname(TOKEN_FILE), { recursive: true });
	const temporaryTokenFile = `${TOKEN_FILE}.${crypto.randomUUID()}.tmp`;
	try {
		await fs.writeFile(temporaryTokenFile, JSON.stringify(stored, null, 2), {
			flag: "wx",
			mode: 0o600,
		});
		await fs.rename(temporaryTokenFile, TOKEN_FILE);
		await fs.chmod(TOKEN_FILE, 0o600);
	} catch (error) {
		await fs.rm(temporaryTokenFile, { force: true }).catch(() => undefined);
		throw error;
	}
	return stored;
}

async function getAccessToken() {
	const token = await readToken();
	if (!token?.refresh_token) {
		throw Object.assign(new Error("tado is not connected yet."), {
			provider: "tado authorization",
			status: 401,
		});
	}

	if (token.access_token && Number(token.expires_at) > Date.now()) {
		return token.access_token;
	}

	refreshInFlight ??= refreshStoredToken().finally(() => {
		refreshInFlight = null;
	});

	const refreshed = await refreshInFlight;
	return refreshed.access_token;
}

async function refreshStoredToken() {
	return withTokenMutation(async () => {
		const currentToken = await readToken();
		if (!currentToken?.refresh_token) {
			throw Object.assign(new Error("tado is not connected yet."), {
				provider: "tado authorization",
				status: 401,
			});
		}
		if (
			currentToken.access_token &&
			Number(currentToken.expires_at) > Date.now()
		) {
			return currentToken;
		}

		const params = new URLSearchParams({
			client_id: TADO_CLIENT_ID,
			grant_type: "refresh_token",
			refresh_token: currentToken.refresh_token,
		});
		const refreshedToken = await requestJson<TadoToken>(
			"https://login.tado.com/oauth2/token",
			{
				errorContext: "tado authorization",
				method: "POST",
				body: params,
				headers: {
					"content-type": "application/x-www-form-urlencoded",
				},
			},
		);
		return writeToken(refreshedToken, currentToken.refresh_token);
	});
}

async function tadoApi<T>(pathname: string) {
	const token = await getAccessToken();
	return requestJson<T>(`https://my.tado.com/api/v2${pathname}`, {
		errorContext: "tado",
		headers: { Authorization: `Bearer ${token}` },
	});
}

async function resolveTadoTopology() {
	const now = Date.now();
	if (
		tadoTopologyCache &&
		now - tadoTopologyCache.createdAt < TADO_TOPOLOGY_CACHE_MS
	) {
		return tadoTopologyCache;
	}

	const me = await tadoApi<{ homes?: Array<{ id: number | string }> }>("/me");
	const homeId = config.homeId || me.homes?.[0]?.id;

	if (!homeId) {
		throw createSampleFailure(
			"No tado home found for this account.",
			"provider_unavailable",
			"tado",
		);
	}

	const zones = await tadoApi<Array<TadoZone>>(
		`/homes/${encodeURIComponent(homeId)}/zones`,
	);
	const topology = { createdAt: now, homeId, zones };
	tadoTopologyCache = topology;
	return topology;
}

async function resolveTadoRooms() {
	if (Date.now() < tadoRateLimitUntil) {
		throw Object.assign(new Error("tado is rate limited."), {
			status: 429,
			provider: "tado",
		});
	}

	const { homeId, zones } = await resolveTadoTopology();
	const zoneStates = await tadoApi<TadoZoneStatesResponse>(
		`/homes/${encodeURIComponent(homeId)}/zoneStates`,
	);
	const rooms = selectTadoRoomSnapshots({
		homeId,
		maximumObservationAgeMs: config.tadoObservationMaxAgeMs,
		nowMs: Date.now(),
		selectedZoneId: config.zoneId || undefined,
		zones,
		zoneStates,
	});
	if (!rooms.length) {
		throw createSampleFailure(
			"No tado rooms with inside temperature readings were found.",
			"provider_unavailable",
			"tado",
		);
	}

	return { homeId, rooms };
}

async function readTadoRoomsWithRateLimitBackoff() {
	try {
		return await resolveTadoRooms();
	} catch (error) {
		if (isHttpError(error, 429)) {
			tadoRateLimitUntil = Date.now() + config.tadoRateLimitBackoffMs;
		}
		throw error;
	}
}

async function fetchDwdStations() {
	const nowMs = Date.now();
	if (
		dwdStationCache &&
		nowMs - dwdStationCache.createdAt < DWD_STATION_LIST_CACHE_MS
	) {
		return dwdStationCache.stations;
	}

	const stationList = await requestText(
		DWD_STATION_LIST_URL,
		"DWD station list",
	);
	const stations = parseDwdStationList(stationList, {
		latitude: config.latitude,
		longitude: config.longitude,
	}).slice(0, DWD_STATION_CANDIDATE_COUNT);
	if (!stations.length) {
		throw new Error("DWD station list had no usable nearby stations.");
	}

	dwdStationCache = { createdAt: nowMs, stations };
	return stations;
}

async function fetchDwdCurrentConsensus(nowMs: number) {
	if (
		dwdObservationCache &&
		nowMs - dwdObservationCache.createdAt < config.weatherCacheMs
	) {
		return dwdObservationCache.consensus;
	}

	try {
		const stations = await fetchDwdStations();
		const results = await Promise.allSettled(
			stations.map(async (station) => {
				const response = await requestText(
					`${DWD_POI_BASE_URL}/${station.fileCode}-BEOB.csv`,
					`DWD observation for ${station.name}`,
				);
				return parseDwdPoiObservation(response, station, {
					nowMs,
					maxAgeMs: config.dwdObservationMaxAgeMs,
				});
			}),
		);
		const observations = results
			.filter(
				(
					result,
				): result is PromiseFulfilledResult<
					NonNullable<Awaited<ReturnType<typeof parseDwdPoiObservation>>>
				> => result.status === "fulfilled" && result.value != null,
			)
			.map((result) => result.value);
		const consensus = selectDwdConsensus(observations, {
			minimumStations: config.dwdMinimumStations,
			maximumSpreadC: config.dwdMaximumSpreadC,
		});

		dwdObservationCache = { createdAt: nowMs, consensus };
		if (!consensus) {
			logWeatherFallback(
				"dwd-consensus-unavailable",
				`Direct DWD fallback had ${observations.length} fresh nearby observation(s), but ${config.dwdMinimumStations} agreeing stations are required.`,
			);
		}
		return consensus;
	} catch (error) {
		dwdObservationCache = { createdAt: nowMs };
		logWeatherFallback(
			"dwd-fallback-failed",
			`Direct DWD fallback failed (${errorMessage(error)}).`,
		);
		return undefined;
	}
}

function currentWeatherFromDwdConsensus(consensus: DwdConsensus) {
	return {
		temperatureC: consensus.temperatureC,
		humidityPercent: consensus.humidityPercent,
		observedAt: consensus.observedAt,
		source: {
			name: "DWD Open Data station consensus",
			stationName: consensus.stations
				.map((station) => station.name)
				.join(" + "),
			distanceMeters: consensus.stations[0]?.distanceMeters,
		},
	};
}

async function fetchOutsideWeather() {
	const nowMs = Date.now();
	if (
		outsideWeatherCache &&
		nowMs - outsideWeatherCache.createdAt < config.weatherCacheMs
	) {
		return outsideWeatherCache.data;
	}

	if (outsideWeatherCache && nowMs < weatherRateLimitUntil) {
		const dwdConsensus = await fetchDwdCurrentConsensus(nowMs);
		return {
			...outsideWeatherCache.data,
			current: dwdConsensus
				? currentWeatherFromDwdConsensus(dwdConsensus)
				: undefined,
			currentUnavailableReason: dwdConsensus
				? undefined
				: "Bright Sky is temporarily rate limited, and direct DWD observations were not fresh enough to provide a current outdoor value.",
		};
	}

	const now = new Date();
	const forecastStart = startOfHour(
		new Date(now.getTime() - 2 * 60 * 60 * 1000),
	);
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

	const [currentResult, forecastResult] = await Promise.allSettled([
		requestJson<BrightSkyCurrentWeatherResponse>(
			`https://api.brightsky.dev/current_weather?${currentParams.toString()}`,
			{ errorContext: "Bright Sky current weather" },
		),
		requestJson<BrightSkyHourlyWeatherResponse>(
			`https://api.brightsky.dev/weather?${forecastParams.toString()}`,
			{ errorContext: "Bright Sky forecast" },
		),
	]);
	const current =
		currentResult.status === "fulfilled" ? currentResult.value : undefined;
	const forecast =
		forecastResult.status === "fulfilled" ? forecastResult.value : undefined;
	const failures = [currentResult, forecastResult]
		.filter((result) => result.status === "rejected")
		.map((result) => result.reason);

	if (failures.some((error) => isHttpError(error, 429))) {
		weatherRateLimitUntil = nowMs + config.weatherRateLimitBackoffMs;
	}

	const observation = selectBrightSkyCurrentObservation(current);
	const dwdConsensus = observation
		? undefined
		: await fetchDwdCurrentConsensus(nowMs);
	if (currentResult.status === "rejected") {
		logWeatherFallback(
			"current-observation-unavailable",
			`Bright Sky current weather unavailable (${errorMessage(currentResult.reason)}); checking direct DWD observations.`,
		);
	} else if (!observation) {
		logWeatherFallback(
			"current-observation-empty",
			"Bright Sky current weather had no temperature; checking direct DWD observations.",
		);
	}
	if (dwdConsensus) {
		logWeatherFallback(
			"dwd-fallback-active",
			`Using fresh direct DWD consensus from ${dwdConsensus.stations.length} nearby stations.`,
		);
	}
	if (forecastResult.status === "rejected") {
		logWeatherFallback(
			"forecast-unavailable",
			`Forecast unavailable (${errorMessage(forecastResult.reason)}); continuing with the current observation.`,
		);
	}

	const forecastSource =
		forecast?.sources?.find(
			(source) => source.observation_type === "forecast",
		) ||
		findWeatherSource(
			forecast?.sources,
			forecast?.weather?.find((point) => point.source_id != null)?.source_id,
		);

	const outsideWeather = {
		currentUnavailableReason:
			observation || dwdConsensus
				? undefined
				: "Neither Bright Sky nor enough fresh, agreeing direct DWD observations provided a current outdoor value.",
		current: observation
			? {
					temperatureC: observation.temperatureC,
					humidityPercent: observation.humidityPercent,
					observedAt: observation.observedAt,
					source: describeWeatherSource(
						"Bright Sky DWD observation",
						observation.source,
					),
				}
			: dwdConsensus
				? currentWeatherFromDwdConsensus(dwdConsensus)
				: undefined,
		forecast: forecast
			? {
					source: describeWeatherSource(
						"Bright Sky DWD forecast",
						forecastSource,
					),
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
				}
			: undefined,
	} satisfies OutsideWeather;

	outsideWeatherCache = { createdAt: nowMs, data: outsideWeather };
	return outsideWeather;
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

let lastWeatherFallback: { key: string; loggedAt: number } | null = null;

function logWeatherFallback(key: string, message: string) {
	const now = Date.now();
	if (
		lastWeatherFallback?.key === key &&
		now - lastWeatherFallback.loggedAt < 10 * 60 * 1000
	) {
		return;
	}

	lastWeatherFallback = { key, loggedAt: now };
	console.log(`[window-watcher:weather] ${message}`);
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : "unknown error";
}

function buildVerdict(insideC: number, outsideC: number, roomName = "inside") {
	const difference = insideC - outsideC;

	if (difference > config.coolingMarginC) {
		return {
			action: "open" as const,
			title: "Open the windows",
			detail: `Outside is ${difference.toFixed(1)} °C cooler than ${roomName}.`,
		};
	}

	if (difference > 0) {
		return {
			action: "maybe" as const,
			title: "Only open briefly",
			detail: `Outside is just ${difference.toFixed(1)} °C cooler than ${roomName}.`,
		};
	}

	return {
		action: "closed" as const,
		title: "Keep windows closed",
		detail: `Outside is ${Math.abs(difference).toFixed(1)} °C warmer than ${roomName}.`,
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
	const actionablePoints = [
		{ time: checkedAt, timestamp: checkedTime, temperatureC: outsideC },
		...points.filter(
			(point) => point.timestamp > checkedTime && point.timestamp <= horizonEnd,
		),
	];

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
	const window = findSustainedThresholdWindow(
		forecast?.actionablePoints || [],
		thresholdC,
		config.minForecastCoolingWindowMinutes * 60 * 1000,
	);
	return window ? new Date(window.startTime).toISOString() : undefined;
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
	return `Forecast low is ${forecast.minTemperatureC.toFixed(1)} °C, still above the ${thresholdC.toFixed(1)} °C threshold.`;
}

function updateMassTemp(
	previousMass: number,
	indoorTemp: number,
	dtHours: number,
	tauHours = config.thermalMassTauHours,
) {
	const alpha = 1 - Math.exp(-Math.max(0, dtHours) / tauHours);
	return previousMass + alpha * (indoorTemp - previousMass);
}

function getRoomHistoryPoints(
	history: Array<TemperatureHistoryEntry>,
	zoneId: number | string,
) {
	return getRoomTemperatureSeries(history, zoneId).map((point) => ({
		time: point.time,
		indoorC: point.value,
	}));
}

function estimateMassTemperature(
	room: TadoRoom,
	history: Array<TemperatureHistoryEntry>,
	checkedAt: string,
) {
	const checkedTime = new Date(checkedAt).getTime();
	const cutoff =
		checkedTime - Math.max(12, config.thermalMassTauHours * 2) * 60 * 60 * 1000;
	const points = getRoomHistoryPoints(history, room.zoneId).filter(
		(point) => point.time >= cutoff && point.time <= checkedTime,
	);
	const observedTime = new Date(room.observedAt || checkedAt).getTime();
	const samples = points.some((point) => point.time === observedTime)
		? points
		: [...points, { time: observedTime, indoorC: room.temperatureC }].sort(
				(left, right) => left.time - right.time,
			);

	let massTemperatureC = samples[0]?.indoorC ?? room.temperatureC;
	let previousTime = samples[0]?.time ?? checkedTime;

	for (const sample of samples.slice(1)) {
		const dtHours = (sample.time - previousTime) / (60 * 60 * 1000);
		if (dtHours > 0) {
			massTemperatureC = updateMassTemp(
				massTemperatureC,
				sample.indoorC,
				dtHours,
			);
			previousTime = sample.time;
		}
	}

	return massTemperatureC;
}

function median(values: Array<number>) {
	const sorted = values
		.filter((value) => Number.isFinite(value))
		.sort((left, right) => left - right);
	if (!sorted.length) return undefined;
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function roundPredictionValue(value: number) {
	return Math.round(value * 100) / 100;
}

function estimateObservedCoolingRate(
	room: TadoRoom,
	history: Array<TemperatureHistoryEntry>,
) {
	const points = getRoomHistoryPoints(history, room.zoneId);
	const outdoorPoints = getOutdoorTemperatureSeries(history);
	const rates: Array<number> = [];

	for (let index = 1; index < points.length; index += 1) {
		const previous = points[index - 1];
		const current = points[index];
		const previousOutsideC = findNearbyTemperature(
			outdoorPoints,
			previous.time,
		);
		if (previousOutsideC == null) continue;

		const dtHours = (current.time - previous.time) / (60 * 60 * 1000);
		if (dtHours < 5 / 60 || dtHours > 2) continue;

		const coolingGapC = previous.indoorC - previousOutsideC;
		const rate = (current.indoorC - previous.indoorC) / dtHours;
		if (coolingGapC > 0.5 && rate <= 0.05) rates.push(rate);
	}

	const observed = median(rates);
	if (observed == null) return undefined;
	return clamp(observed, -1.5, -0.05);
}

function estimateLearnedOpenOffset(
	room: TadoRoom,
	history: Array<TemperatureHistoryEntry>,
) {
	const points = getRoomHistoryPoints(history, room.zoneId);
	const outdoorPoints = getOutdoorTemperatureSeries(history);
	const offsets: Array<number> = [];

	for (let index = 1; index < points.length; index += 1) {
		const previous = points[index - 1];
		const current = points[index];
		const previousOutsideC = findNearbyTemperature(
			outdoorPoints,
			previous.time,
		);
		const currentOutsideC = findNearbyTemperature(outdoorPoints, current.time);
		if (previousOutsideC == null || currentOutsideC == null) continue;

		const dtHours = (current.time - previous.time) / (60 * 60 * 1000);
		if (dtHours < 10 / 60 || dtHours > 2) continue;

		const rate = (current.indoorC - previous.indoorC) / dtHours;
		const offset = current.indoorC - currentOutsideC;
		if (Math.abs(rate) < 0.1 && offset > 0.5) offsets.push(offset);
	}

	const learned = median(offsets);
	if (learned == null) return undefined;
	return clamp(learned, 0.5, 8);
}

function buildRoomPrediction(
	room: TadoRoom,
	outsideC: number,
	history: Array<TemperatureHistoryEntry>,
	checkedAt: string,
	forecast: ReturnType<typeof analyzeForecast>,
) {
	const checkedTime = new Date(checkedAt).getTime();
	const horizonMinutes = config.predictionHorizonMinutes;
	const horizonHours = horizonMinutes / 60;
	const horizonEnd = checkedTime + horizonMinutes * 60 * 1000;
	const forecastPoints = (forecast?.actionablePoints || []).filter(
		(point) => point.timestamp >= checkedTime && point.timestamp <= horizonEnd,
	);
	const averageOutdoorC = getTimeWeightedForecastTemperature({
		currentTemperatureC: outsideC,
		startTime: checkedTime,
		endTime: horizonEnd,
		forecastPoints,
	});
	const outdoorAtHorizonC =
		getForecastTemperatureAt(forecast?.actionablePoints || [], horizonEnd) ??
		forecastPoints.at(-1)?.temperatureC ??
		outsideC;
	const massTemperatureC = estimateMassTemperature(room, history, checkedAt);
	const reboundRiskC = Math.max(0, massTemperatureC - room.temperatureC);
	const expectedReboundC = config.reboundFactor * reboundRiskC;
	const effectiveHotTemperatureC = room.temperatureC + expectedReboundC;
	const observedCoolingRateCPerHour = estimateObservedCoolingRate(
		room,
		history,
	);
	const learnedOpenOffsetC = estimateLearnedOpenOffset(room, history);
	const modeledOpenRateCPerHour = clamp(
		0.28 * (averageOutdoorC - room.temperatureC) +
			0.1 * (massTemperatureC - room.temperatureC),
		-1.2,
		0.5,
	);
	const openRateCPerHour =
		observedCoolingRateCPerHour == null || averageOutdoorC >= room.temperatureC
			? modeledOpenRateCPerHour
			: Math.max(
					modeledOpenRateCPerHour,
					clamp(
						observedCoolingRateCPerHour +
							0.06 * (massTemperatureC - room.temperatureC),
						-1.5,
						0.5,
					),
				);
	const rawPredictedOpenC = room.temperatureC + openRateCPerHour * horizonHours;
	const openWindowFloorC =
		learnedOpenOffsetC == null
			? undefined
			: outdoorAtHorizonC + learnedOpenOffsetC;
	const predictedOpenTemperatureC =
		openWindowFloorC == null
			? rawPredictedOpenC
			: Math.max(rawPredictedOpenC, openWindowFloorC);
	const predictedClosedTemperatureC = room.temperatureC + expectedReboundC;
	const predictedOpenBenefitC =
		predictedClosedTemperatureC - predictedOpenTemperatureC;
	const openUsefulOutdoorThresholdC =
		effectiveHotTemperatureC - config.minPredictedOpenBenefitC;
	const coolingWindow = findSustainedThresholdWindow(
		forecastPoints,
		openUsefulOutdoorThresholdC,
		config.minForecastCoolingWindowMinutes * 60 * 1000,
	);
	const coolingWindowStartsAt = coolingWindow
		? new Date(coolingWindow.startTime).toISOString()
		: undefined;

	return {
		horizonMinutes,
		massTemperatureC: roundPredictionValue(massTemperatureC),
		reboundRiskC: roundPredictionValue(reboundRiskC),
		expectedReboundC: roundPredictionValue(expectedReboundC),
		effectiveHotTemperatureC: roundPredictionValue(effectiveHotTemperatureC),
		predictedOpenTemperatureC: roundPredictionValue(predictedOpenTemperatureC),
		predictedClosedTemperatureC: roundPredictionValue(
			predictedClosedTemperatureC,
		),
		predictedOpenBenefitC: roundPredictionValue(predictedOpenBenefitC),
		coolingOpportunityC: roundPredictionValue(
			effectiveHotTemperatureC - outsideC,
		),
		observedCoolingRateCPerHour:
			observedCoolingRateCPerHour == null
				? undefined
				: roundPredictionValue(observedCoolingRateCPerHour),
		learnedOpenOffsetC:
			learnedOpenOffsetC == null
				? undefined
				: roundPredictionValue(learnedOpenOffsetC),
		openWindowFloorC:
			openWindowFloorC == null
				? undefined
				: roundPredictionValue(openWindowFloorC),
		coolingWindowStartsAt,
		coolingWindowEndsAt: undefined,
	} satisfies NonNullable<RoomReading["prediction"]>;
}

function buildRecommendationPrediction(room: ModeledRoom) {
	const prediction = room.prediction;
	return {
		referenceZoneId: room.zoneId,
		referenceZoneName: room.zoneName,
		horizonMinutes: prediction.horizonMinutes,
		targetMaxC: config.targetMaxC,
		massTemperatureC: prediction.massTemperatureC,
		expectedReboundC: prediction.expectedReboundC,
		predictedOpenTemperatureC: prediction.predictedOpenTemperatureC,
		predictedClosedTemperatureC: prediction.predictedClosedTemperatureC,
		predictedOpenBenefitC: prediction.predictedOpenBenefitC,
		coolingOpportunityC: prediction.coolingOpportunityC,
		openWindowFloorC: prediction.openWindowFloorC,
		coolingWindowStartsAt: prediction.coolingWindowStartsAt,
		coolingWindowEndsAt: prediction.coolingWindowEndsAt,
	} satisfies NonNullable<CoolingStatus["recommendation"]["prediction"]>;
}

function buildRoomTrendVerdict(
	room: ModeledRoom,
	outsideC: number,
	trend: ReturnType<typeof analyzeOutdoorTrend>,
) {
	const prediction = room.prediction;
	if (
		prediction.predictedOpenBenefitC >= config.minPredictedOpenBenefitC &&
		prediction.coolingOpportunityC > 0 &&
		outsideC < room.temperatureC
	) {
		return {
			action: "open" as const,
			title: "Open this window",
			detail: `Open air is predicted to beat closing by ${prediction.predictedOpenBenefitC.toFixed(1)} °C over ${prediction.horizonMinutes} min.`,
		};
	}

	if (
		prediction.expectedReboundC > 0.3 &&
		outsideC < room.temperatureC &&
		prediction.predictedOpenTemperatureC <=
			prediction.predictedClosedTemperatureC
	) {
		return {
			action: "open" as const,
			title: "Keep cooling",
			detail: `Closing now may rebound by about ${prediction.expectedReboundC.toFixed(1)} °C.`,
		};
	}

	if (
		prediction.expectedReboundC < 0.2 &&
		prediction.predictedClosedTemperatureC <= config.targetMaxC
	) {
		return {
			action: "closed" as const,
			title: "Close soon",
			detail: `Predicted settled temperature is ${prediction.predictedClosedTemperatureC.toFixed(1)} °C.`,
		};
	}

	if (trend.direction === "falling") {
		const limitC = room.temperatureC + 1;
		const difference = limitC - outsideC;
		return {
			action: outsideC <= limitC ? ("open" as const) : ("closed" as const),
			title: outsideC <= limitC ? "Open this window" : "Keep closed",
			detail:
				outsideC <= limitC
					? `Outdoor temperature is falling and close enough for ${room.zoneName}.`
					: `Outside is ${Math.abs(difference).toFixed(1)} °C above the falling-air threshold.`,
		};
	}

	const openLimitC = room.temperatureC - config.coolingMarginC;
	const difference = room.temperatureC - outsideC;

	if (outsideC < openLimitC) {
		return {
			action: "open" as const,
			title: "Open this window",
			detail: `Outside is ${difference.toFixed(1)} °C cooler than ${room.zoneName}.`,
		};
	}

	if (outsideC < room.temperatureC) {
		return {
			action: "maybe" as const,
			title: "Only open briefly",
			detail: `Outside is cooler than ${room.zoneName}, but not by ${config.coolingMarginC.toFixed(1)} °C.`,
		};
	}

	return {
		action: "closed" as const,
		title: "Keep closed",
		detail: `Outside is ${Math.abs(difference).toFixed(1)} °C warmer than ${room.zoneName}.`,
	};
}

function buildTrendVerdict(
	rooms: Array<ModeledRoom>,
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
	const bestOpenRoom = rooms.reduce((best, room) =>
		room.prediction.predictedOpenBenefitC >
		best.prediction.predictedOpenBenefitC
			? room
			: best,
	);
	const hottestSettledRoom = rooms.reduce((hottest, room) =>
		room.prediction.predictedClosedTemperatureC >
		hottest.prediction.predictedClosedTemperatureC
			? room
			: hottest,
	);
	const predictiveReferenceRoom =
		bestOpenRoom.prediction.predictedOpenBenefitC > 0
			? bestOpenRoom
			: hottestSettledRoom;
	const predictiveThresholdC =
		predictiveReferenceRoom.prediction.effectiveHotTemperatureC -
		config.minPredictedOpenBenefitC;
	const predictiveMarginToThresholdC = predictiveThresholdC - outsideC;
	const predictiveThresholdAt = findThresholdTime(
		forecast,
		predictiveThresholdC,
	);
	const predictiveForecastSummary = buildForecastSummary(
		forecast,
		predictiveThresholdAt,
		predictiveThresholdC,
	);
	const predictiveForecast = forecast
		? {
				horizonHours: forecast.horizonHours,
				minTemperatureC: forecast.minTemperatureC,
				minAt: forecast.minAt,
				changeC: forecast.changeC,
				reachesThresholdAt: predictiveThresholdAt,
				summary: predictiveForecastSummary,
				source: forecast.source,
				points: forecast.points.map((point) => ({
					time: point.time,
					temperatureC: point.temperatureC,
				})),
			}
		: undefined;
	const predictiveSummary = buildRecommendationPrediction(
		predictiveReferenceRoom,
	);

	if (
		predictiveReferenceRoom.prediction.predictedOpenBenefitC >=
			config.minPredictedOpenBenefitC &&
		predictiveReferenceRoom.prediction.coolingOpportunityC > 0 &&
		outsideC < predictiveReferenceRoom.temperatureC
	) {
		return {
			referenceRoom: predictiveReferenceRoom,
			action: "open" as const,
			title: "Open / keep open",
			detail: `Closing now predicts ${predictiveReferenceRoom.zoneName} at ${predictiveReferenceRoom.prediction.predictedClosedTemperatureC.toFixed(1)} °C; open air is ${predictiveReferenceRoom.prediction.predictedOpenBenefitC.toFixed(1)} °C better over ${predictiveReferenceRoom.prediction.horizonMinutes} min.`,
			strategy: "rebound-aware-predictive-open",
			thresholdC: predictiveThresholdC,
			marginToThresholdC: predictiveMarginToThresholdC,
			forecast: predictiveForecast,
			prediction: predictiveSummary,
		};
	}

	if (
		predictiveReferenceRoom.prediction.expectedReboundC > 0.3 &&
		outsideC < predictiveReferenceRoom.temperatureC &&
		predictiveReferenceRoom.prediction.predictedOpenTemperatureC <=
			predictiveReferenceRoom.prediction.predictedClosedTemperatureC
	) {
		return {
			referenceRoom: predictiveReferenceRoom,
			action: "open" as const,
			title: "Keep cooling",
			detail: `${predictiveReferenceRoom.zoneName} air is cooler, but stored heat still implies about ${predictiveReferenceRoom.prediction.expectedReboundC.toFixed(1)} °C rebound if you close now.`,
			strategy: "rebound-aware-keep-cooling",
			thresholdC: predictiveThresholdC,
			marginToThresholdC: predictiveMarginToThresholdC,
			forecast: predictiveForecast,
			prediction: predictiveSummary,
		};
	}

	if (
		hottestSettledRoom.prediction.expectedReboundC < 0.2 &&
		hottestSettledRoom.prediction.predictedClosedTemperatureC <=
			config.targetMaxC
	) {
		return {
			referenceRoom: hottestSettledRoom,
			action: "closed" as const,
			title: "Close soon",
			detail: `${hottestSettledRoom.zoneName} should settle near ${hottestSettledRoom.prediction.predictedClosedTemperatureC.toFixed(1)} °C after closing, within the ${config.targetMaxC.toFixed(1)} °C target.`,
			strategy: "rebound-aware-close-settled",
			thresholdC:
				hottestSettledRoom.prediction.effectiveHotTemperatureC -
				config.minPredictedOpenBenefitC,
			marginToThresholdC:
				hottestSettledRoom.prediction.effectiveHotTemperatureC -
				config.minPredictedOpenBenefitC -
				outsideC,
			forecast: predictiveForecast,
			prediction: buildRecommendationPrediction(hottestSettledRoom),
		};
	}

	if (predictiveThresholdAt) {
		return {
			referenceRoom: predictiveReferenceRoom,
			action: "maybe" as const,
			title: "Open later",
			detail: `Forecast should make open-window cooling useful around ${formatForecastTime(predictiveThresholdAt)}.`,
			strategy: "rebound-aware-forecast-window",
			thresholdC: predictiveThresholdC,
			marginToThresholdC: predictiveMarginToThresholdC,
			forecast: predictiveForecast,
			prediction: predictiveSummary,
		};
	}

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
				? `Outdoor temperature is falling; outside is at or below ${warmestRoom.zoneName} plus 1.0 °C.`
				: reachesThresholdAt
					? `Outdoor temperature is falling and should become useful around ${formatForecastTime(reachesThresholdAt)}.`
					: `Outdoor temperature is falling, but outside is still ${(outsideC - limitC).toFixed(1)} °C above ${warmestRoom.zoneName} plus 1.0 °C.`,
			strategy: "falling-outdoor-warmest-plus-one",
			thresholdC: limitC,
			marginToThresholdC,
			prediction: buildRecommendationPrediction(warmestRoom),
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
			detail: `Outdoor temperature is ${trend.direction}; outside is more than ${config.coolingMarginC.toFixed(1)} °C below ${coldestRoom.zoneName}.`,
			strategy: "rising-or-steady-outdoor-coldest-minus-two",
			thresholdC: limitC,
			marginToThresholdC,
			prediction: buildRecommendationPrediction(coldestRoom),
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
			prediction: buildRecommendationPrediction(coldestRoom),
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
			detail: `Outdoor temperature is ${trend.direction}; outside is cooler than ${coldestRoom.zoneName}, but not by ${config.coolingMarginC.toFixed(1)} °C.`,
			strategy: "rising-or-steady-outdoor-coldest-minus-two",
			thresholdC: limitC,
			marginToThresholdC,
			prediction: buildRecommendationPrediction(coldestRoom),
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
		prediction: buildRecommendationPrediction(coldestRoom),
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
			observedAt: room.observedAt,
			differenceC: room.differenceC,
			prediction: room.prediction,
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

async function appendOutsideHistory(
	outside: OutsideWeather,
	checkedAt: string,
	previousHistory: Array<TemperatureHistoryEntry>,
) {
	const outsideC = outside.current?.temperatureC;
	if (outsideC == null) return null;

	await fs.mkdir(DATA_DIR, { recursive: true });

	const trend = analyzeOutdoorTrend(previousHistory, outsideC, checkedAt);
	const forecast = analyzeForecast(outside, outsideC, checkedAt);
	const entry: TemperatureHistoryEntry = {
		checkedAt,
		location: {
			label: config.locationLabel,
			latitude: config.latitude,
			longitude: config.longitude,
		},
		outside: {
			temperatureC: outsideC,
			humidityPercent: outside.current?.humidityPercent,
			observedAt: outside.current?.observedAt,
			source: outside.current?.source,
		},
		rooms: [],
		recommendation: {
			outdoorTrend: trend,
			forecast: forecast
				? {
						horizonHours: forecast.horizonHours,
						minTemperatureC: forecast.minTemperatureC,
						minAt: forecast.minAt,
						changeC: forecast.changeC,
						source: forecast.source,
						points: forecast.points.map((point) => ({
							time: point.time,
							temperatureC: point.temperatureC,
						})),
					}
				: undefined,
			strategy: "outside-only",
			thresholdC: outsideC,
			marginToThresholdC: 0,
		},
		marginC: config.coolingMarginC,
	};

	await fs.appendFile(HISTORY_FILE, `${JSON.stringify(entry)}\n`, {
		mode: 0o600,
	});
	return entry;
}

export async function readHistory(limit = 960) {
	try {
		const raw = await fs.readFile(HISTORY_FILE, "utf8");
		const lines = raw.trim().split("\n").filter(Boolean);
		return lines
			.slice(-limit)
			.map((line) => JSON.parse(line) as TemperatureHistoryEntry)
			.map(sanitizeTemperatureHistoryEntry);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

function buildStatusFromHistoryEntry(
	entry: TemperatureHistoryEntry | undefined,
	error?: Error,
	options: { stale?: boolean } = {},
) {
	if (!entry?.rooms.length) return null;

	const stale = options.stale ?? Boolean(error);
	const entryOutside = entry.outside;
	const outsideC = stale ? undefined : entryOutside?.temperatureC;
	if (outsideC == null) {
		const rooms = buildRoomsWithoutOutdoorComparison(
			entry.rooms.map((room) => ({ ...room, type: "HEATING" })),
		);
		const coldestRoom = rooms.reduce((coldest, room) =>
			room.temperatureC < coldest.temperatureC ? room : coldest,
		);
		const unavailableReason = stale
			? "Fresh temperature data is unavailable."
			: entryOutside?.unavailableReason ||
				"No fresh outdoor observation was available.";

		return {
			checkedAt: stale ? new Date().toISOString() : entry.checkedAt,
			lastFreshAt: entry.checkedAt,
			stale,
			staleReason: stale ? error?.message : undefined,
			staleFailureReason:
				stale && error ? classifySampleFailure(error) : undefined,
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
				referenceStrategy: "outside-unavailable",
			},
			inside: {
				temperatureC: coldestRoom.temperatureC,
				humidityPercent: coldestRoom.humidityPercent,
			},
			rooms,
			outside: { unavailableReason },
			recommendation: buildUnavailableRecommendation(),
			verdict: buildUnavailableVerdict(unavailableReason),
			marginC: entry.marginC || config.coolingMarginC,
		} satisfies CoolingStatus;
	}

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
		checkedAt: stale ? new Date().toISOString() : entry.checkedAt,
		lastFreshAt: entry.checkedAt,
		stale,
		staleReason: stale ? error?.message : undefined,
		staleFailureReason:
			stale && error ? classifySampleFailure(error) : undefined,
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
			humidityPercent: entryOutside?.humidityPercent,
			observedAt: entryOutside?.observedAt,
			source: entryOutside?.source,
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

function buildRoomsWithoutOutdoorComparison(
	rooms: Array<
		Pick<
			RoomReading,
			| "zoneId"
			| "zoneName"
			| "type"
			| "temperatureC"
			| "humidityPercent"
			| "observedAt"
		>
	>,
) {
	return rooms.map(
		(room): RoomReading => ({
			...room,
			differenceC: undefined,
			prediction: undefined,
			verdict: {
				action: "unknown",
				title: "Outdoor comparison unavailable",
				detail: "There is no current outdoor temperature to compare with.",
			},
		}),
	);
}

function buildUnavailableRecommendation(): CoolingStatus["recommendation"] {
	return {
		outdoorTrend: {
			direction: "steady",
			changeC: 0,
			hours: 0,
			sampleCount: 0,
		},
		strategy: "outside-unavailable",
	};
}

function buildUnavailableVerdict(reason: string): CoolingStatus["verdict"] {
	return {
		action: "unknown",
		title: "Current outdoor temperature unavailable",
		detail: `${reason} No window recommendation is shown.`,
	};
}

async function collectFreshCoolingStatus() {
	const previousHistory = await readHistory(
		Math.ceil(Math.max(config.outdoorTrendHours, 24) * 60),
	);
	const outside = await fetchOutsideWeather();
	const outsideC = outside.current?.temperatureC;

	const checkedAt = new Date().toISOString();

	let target: Awaited<ReturnType<typeof readTadoRoomsWithRateLimitBackoff>>;
	try {
		target = await readTadoRoomsWithRateLimitBackoff();
	} catch (error) {
		if (isHttpError(error, 429)) {
			await appendOutsideHistory(outside, checkedAt, previousHistory);
		}
		throw error;
	}

	if (outsideC == null) {
		const referenceRoom = target.rooms.reduce((coldest, room) =>
			room.temperatureC < coldest.temperatureC ? room : coldest,
		);
		const rooms = buildRoomsWithoutOutdoorComparison(target.rooms);
		const unavailableReason =
			outside.currentUnavailableReason ||
			"No fresh outdoor observation was available.";
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
				referenceStrategy: "outside-unavailable",
			},
			inside: {
				temperatureC: referenceRoom.temperatureC,
				humidityPercent: referenceRoom.humidityPercent,
			},
			rooms,
			outside: { unavailableReason },
			recommendation: buildUnavailableRecommendation(),
			verdict: buildUnavailableVerdict(unavailableReason),
			marginC: config.coolingMarginC,
		};

		await appendHistory(status);
		statusCache = { createdAt: Date.now(), data: status };
		return status;
	}

	const trend = analyzeOutdoorTrend(previousHistory, outsideC, checkedAt);
	const forecast = analyzeForecast(outside, outsideC, checkedAt);
	const modeledRooms = target.rooms.map((room) => ({
		...room,
		differenceC: room.temperatureC - outsideC,
		prediction: buildRoomPrediction(
			room,
			outsideC,
			previousHistory,
			checkedAt,
			forecast,
		),
	}));
	const recommendation = buildTrendVerdict(
		modeledRooms,
		outsideC,
		trend,
		forecast,
	);
	const referenceRoom = recommendation.referenceRoom;
	const rooms = modeledRooms.map((room) => ({
		...room,
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
			prediction: recommendation.prediction,
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
			lastSampleFailure = null;
			console.log(`[window-watcher:${reason}] recorded ${status.checkedAt}`);
			return status;
		})
		.catch(async (error: Error) => {
			lastSampleFailure = error;
			logSampleError(reason, error);

			const history = await readHistory(7 * 24 * 60);
			const latestFullHistory = history.findLast(
				(entry) => entry.rooms.length > 0,
			);
			const fallback = buildStatusFromHistoryEntry(latestFullHistory, error);
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
	if (!sampled || sampled.stale) {
		return {
			kind: "unavailable" as const,
			reason:
				sampled?.staleFailureReason || classifySampleFailure(lastSampleFailure),
			status: sampled,
		};
	}
	return { kind: "fresh" as const, status: sampled };
}

async function getCoolingStatus() {
	if (statusCache && Date.now() - statusCache.createdAt < CACHE_MS) {
		return { ...statusCache.data, cached: true };
	}

	const history = await readHistory(
		Math.max(240, Math.ceil(config.sampleIntervalMs / 60_000) + 10),
	);
	const latestFullHistory = history.findLast((entry) => entry.rooms.length > 0);
	const latestHistoryTime = latestFullHistory
		? new Date(latestFullHistory.checkedAt).getTime()
		: Number.NaN;
	if (
		Number.isFinite(latestHistoryTime) &&
		Date.now() - latestHistoryTime < config.sampleIntervalMs
	) {
		const recent = buildStatusFromHistoryEntry(latestFullHistory, undefined, {
			stale: false,
		});
		if (recent) {
			statusCache = { createdAt: Date.now(), data: recent };
			return recent;
		}
	}

	const sampled = await sampleCoolingStatus("request");
	if (sampled) return sampled;

	const fallback = buildStatusFromHistoryEntry(
		latestFullHistory,
		lastSampleFailure || new Error("Fresh temperature data is unavailable."),
	);
	if (!fallback) {
		throw (
			lastSampleFailure ||
			new Error("Could not read fresh temperatures and no history exists.")
		);
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
	const generatedAt = new Date();
	const lastSuccessfulCheckAt = new Date(
		status.lastFreshAt || status.checkedAt,
	).getTime();
	return {
		status,
		history,
		generatedAt: generatedAt.toISOString(),
		sampling: {
			intervalMs: config.sampleIntervalMs,
			nextExpectedCheckAt: new Date(
				getNextExpectedCheckAt(lastSuccessfulCheckAt, config.sampleIntervalMs),
			).toISOString(),
		},
	};
}
