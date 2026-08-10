import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let dataDir: string;
let server: typeof import("./server");
const originalDataDir = process.env.DATA_DIR;
const originalBackgroundSampler = process.env.BACKGROUND_SAMPLER;
const originalTadoHomeId = process.env.TADO_HOME_ID;

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "window-watcher-sample-outcome-"),
	);
	process.env.DATA_DIR = dataDir;
	process.env.BACKGROUND_SAMPLER = "false";
	process.env.TADO_HOME_ID = "12345";
	await fs.writeFile(
		path.join(dataDir, ".tado-token.json"),
		JSON.stringify({
			access_token: "current-access-token",
			expires_at: new Date("2026-08-11T00:00:00.000Z").getTime(),
			refresh_token: "current-refresh-token",
			token_type: "Bearer",
		}),
		{ mode: 0o600 },
	);
	server = await import("./server");
});

afterAll(async () => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	if (originalDataDir == null) delete process.env.DATA_DIR;
	else process.env.DATA_DIR = originalDataDir;
	if (originalBackgroundSampler == null) delete process.env.BACKGROUND_SAMPLER;
	else process.env.BACKGROUND_SAMPLER = originalBackgroundSampler;
	if (originalTadoHomeId == null) delete process.env.TADO_HOME_ID;
	else process.env.TADO_HOME_ID = originalTadoHomeId;
	await fs.rm(dataDir, { force: true, recursive: true });
});

function jsonResponse(body: unknown) {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		status: 200,
	});
}

describe("recordCoolingStatusSample", () => {
	it("reports a stale tado observation as provider-unavailable, not an app crash", async () => {
		const now = new Date("2026-08-10T08:30:00.000Z").getTime();
		vi.spyOn(Date, "now").mockReturnValue(now);
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL | Request) => {
				const url = String(input);
				if (url.includes("api.brightsky.dev/current_weather")) {
					return jsonResponse({
						sources: [{ id: 1, station_name: "Fresh station" }],
						weather: {
							source_id: 1,
							temperature: 20,
							timestamp: "2026-08-10T08:29:00.000Z",
						},
					});
				}
				if (url.includes("api.brightsky.dev/weather")) {
					return jsonResponse({ sources: [], weather: [] });
				}
				if (url.endsWith("/api/v2/me")) {
					return jsonResponse({ homes: [{ id: 12345 }] });
				}
				if (url.endsWith("/api/v2/homes/12345/zones")) {
					return jsonResponse([{ id: 1, name: "Bedroom", type: "HEATING" }]);
				}
				if (url.endsWith("/api/v2/homes/12345/zoneStates")) {
					return jsonResponse({
						zoneStates: {
							"1": {
								sensorDataPoints: {
									insideTemperature: {
										celsius: 23,
										timestamp: "2026-08-10T06:00:00.000Z",
									},
								},
							},
						},
					});
				}
				throw new Error(`Unexpected request: ${url}`);
			}),
		);

		await expect(server.recordCoolingStatusSample("test")).resolves.toEqual({
			kind: "unavailable",
			reason: "provider_unavailable",
			status: null,
		});
	});

	it("reports a rejected tado request as provider-unavailable", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new TypeError("connection reset")),
		);

		await expect(
			server.recordCoolingStatusSample("network-test"),
		).resolves.toEqual({
			kind: "unavailable",
			reason: "provider_unavailable",
			status: null,
		});
	});

	it("keeps the auth failure code when outside-only rows follow room history", async () => {
		const fullHistory = {
			checkedAt: "2026-08-10T08:00:00.000Z",
			outside: { temperatureC: 20 },
			rooms: [
				{
					temperatureC: 23,
					zoneId: 1,
					zoneName: "Bedroom",
				},
			],
		};
		const outsideOnlyHistory = {
			checkedAt: "2026-08-10T08:20:00.000Z",
			outside: { temperatureC: 20.5 },
			rooms: [],
		};
		await fs.writeFile(
			path.join(dataDir, "temperature-history.jsonl"),
			`${JSON.stringify(fullHistory)}\n${JSON.stringify(outsideOnlyHistory)}\n`,
			{ mode: 0o600 },
		);
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL | Request) => {
				const url = String(input);
				if (url.endsWith("/api/v2/homes/12345/zoneStates")) {
					return new Response(JSON.stringify({ error: "unauthorized" }), {
						headers: { "content-type": "application/json" },
						status: 401,
					});
				}
				throw new Error(`Unexpected request: ${url}`);
			}),
		);

		const dashboard = await server.getDashboardPayload();
		expect(dashboard.status).toMatchObject({
			lastFreshAt: fullHistory.checkedAt,
			stale: true,
			staleFailureReason: "tado_auth_invalid",
			staleReason: "unauthorized",
		});
	});
});
