import "@tanstack/react-start/server-only";

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

loadEnv();

const config = {
	locationLabel: process.env.LOCATION_LABEL || "Untergiesing-Harlaching",
	latitude: Number(process.env.LATITUDE || 48.0956),
	longitude: Number(process.env.LONGITUDE || 11.5611),
	homeId: process.env.TADO_HOME_ID || "",
	zoneId: process.env.TADO_ZONE_ID || "",
	coolingMarginC: Number(process.env.COOLING_MARGIN_C || 2),
	requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 5000),
	sampleIntervalMs: Number(process.env.SAMPLE_INTERVAL_MS || 60 * 1000),
	outdoorTrendHours: Number(process.env.OUTDOOR_TREND_HOURS || 3),
	outdoorTrendDeltaC: Number(process.env.OUTDOOR_TREND_DELTA_C || 0.3),
};

let refreshInFlight: Promise<TadoToken> | null = null;
let sampleInFlight: Promise<CoolingStatus | null> | null = null;
let statusCache: { createdAt: number; data: CoolingStatus } | null = null;
let samplerStarted = false;

type TadoToken = {
	access_token?: string;
	refresh_token?: string;
	expires_at?: number;
	expires_in?: number;
	token_type?: string;
};

type TadoRoom = {
	homeId: number | string;
	zoneId: number | string;
	zoneName: string;
	type?: string;
	temperatureC: number;
	humidityPercent?: number;
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
					return null;
				}
				throw legacyError;
			}
		}
		throw error;
	}
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
	const params = new URLSearchParams({
		latitude: String(config.latitude),
		longitude: String(config.longitude),
		current: "temperature_2m,relative_humidity_2m,weather_code",
		timezone: "Europe/Berlin",
	});

	return requestJson<{
		current?: {
			temperature_2m?: number;
			relative_humidity_2m?: number;
		};
	}>(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
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

function buildTrendVerdict(
	rooms: Array<TadoRoom>,
	outsideC: number,
	trend: ReturnType<typeof analyzeOutdoorTrend>,
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

		return {
			referenceRoom: warmestRoom,
			action: outsideC <= limitC ? ("open" as const) : ("closed" as const),
			title: outsideC <= limitC ? "Open the windows" : "Keep windows closed",
			detail:
				outsideC <= limitC
					? `Outdoor temperature is falling; outside is at or below ${warmestRoom.zoneName} plus 1.0 C.`
					: `Outdoor temperature is falling, but outside is still ${(outsideC - limitC).toFixed(1)} C above ${warmestRoom.zoneName} plus 1.0 C.`,
			strategy: "falling-outdoor-warmest-plus-one",
			thresholdC: limitC,
			marginToThresholdC,
		};
	}

	const limitC = coldestRoom.temperatureC - config.coolingMarginC;
	const marginToThresholdC = limitC - outsideC;

	if (outsideC < limitC) {
		return {
			referenceRoom: coldestRoom,
			action: "open" as const,
			title: "Open the windows",
			detail: `Outdoor temperature is ${trend.direction}; outside is more than ${config.coolingMarginC.toFixed(1)} C below ${coldestRoom.zoneName}.`,
			strategy: "rising-or-steady-outdoor-coldest-minus-two",
			thresholdC: limitC,
			marginToThresholdC,
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
	};
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
	const outsideC = outside.current?.temperature_2m;

	if (outsideC == null) throw new Error("Could not read outside temperature.");

	const previousHistory = await readHistory(
		Math.ceil(config.outdoorTrendHours * 60),
	);
	const checkedAt = new Date().toISOString();
	const trend = analyzeOutdoorTrend(previousHistory, outsideC, checkedAt);
	const recommendation = buildTrendVerdict(target.rooms, outsideC, trend);
	const referenceRoom = recommendation.referenceRoom;
	const rooms = target.rooms.map((room) => ({
		...room,
		differenceC: room.temperatureC - outsideC,
		verdict: buildVerdict(room.temperatureC, outsideC, room.zoneName),
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
			humidityPercent: outside.current?.relative_humidity_2m,
		},
		recommendation: {
			outdoorTrend: trend,
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
			console.error(`[window-watcher:${reason}] ${error.message}`);
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
