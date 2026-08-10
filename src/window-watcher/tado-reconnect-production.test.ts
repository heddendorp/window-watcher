import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let dataDir: string;
let reconnect: typeof import("./server");
const originalDataDir = process.env.DATA_DIR;
const originalRailwayEnvironmentId = process.env.RAILWAY_ENVIRONMENT_ID;
const originalTadoHomeId = process.env.TADO_HOME_ID;

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "window-watcher-production-reconnect-"),
	);
	process.env.DATA_DIR = dataDir;
	process.env.RAILWAY_ENVIRONMENT_ID = "test-production";
	delete process.env.TADO_HOME_ID;
	reconnect = await import("./server");
});

afterAll(async () => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	if (originalDataDir == null) delete process.env.DATA_DIR;
	else process.env.DATA_DIR = originalDataDir;
	if (originalRailwayEnvironmentId == null) {
		delete process.env.RAILWAY_ENVIRONMENT_ID;
	} else {
		process.env.RAILWAY_ENVIRONMENT_ID = originalRailwayEnvironmentId;
	}
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

describe("production tado reconnect", () => {
	it("refuses to install a token without a configured home id", async () => {
		const now = new Date("2026-08-10T08:00:00.000Z").getTime();
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(
					jsonResponse({
						device_code: "device-code",
						expires_in: 300,
						interval: 5,
						user_code: "PROD12",
						verification_uri: "https://login.tado.com/oauth2/device",
					}),
				)
				.mockResolvedValueOnce(
					jsonResponse({
						access_token: "candidate-access",
						expires_in: 600,
						refresh_token: "candidate-refresh",
					}),
				),
		);

		const flow = await reconnect.startTadoReconnectFlow("production-user");
		nowSpy.mockReturnValue(now + 5_000);
		await expect(
			reconnect.pollTadoReconnectFlow(flow.flowId, "production-user"),
		).resolves.toEqual({
			message:
				"TADO_HOME_ID must be configured before tado can reconnect in production.",
			status: "denied",
		});
		await expect(
			fs.readFile(path.join(dataDir, ".tado-token.json"), "utf8"),
		).rejects.toMatchObject({ code: "ENOENT" });
	});
});
