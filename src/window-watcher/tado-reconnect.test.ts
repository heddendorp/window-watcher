import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";

let dataDir: string;
let reconnect: typeof import("./server");
const originalDataDir = process.env.DATA_DIR;
const originalTadoHomeId = process.env.TADO_HOME_ID;

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "window-watcher-tado-"));
	process.env.DATA_DIR = dataDir;
	process.env.TADO_HOME_ID = "12345";
	reconnect = await import("./server");
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

afterAll(async () => {
	if (originalDataDir == null) delete process.env.DATA_DIR;
	else process.env.DATA_DIR = originalDataDir;
	if (originalTadoHomeId == null) delete process.env.TADO_HOME_ID;
	else process.env.TADO_HOME_ID = originalTadoHomeId;
	await fs.rm(dataDir, { force: true, recursive: true });
});

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		status,
	});
}

function mockDeviceAuthorization(overrides: Record<string, unknown> = {}) {
	return jsonResponse({
		device_code: "server-only-device-code",
		expires_in: 300,
		interval: 5,
		user_code: "ABCD12",
		verification_uri: "https://login.tado.com/oauth2/device",
		verification_uri_complete:
			"https://login.tado.com/oauth2/device?user_code=ABCD12",
		...overrides,
	});
}

describe("tado reconnect flow", () => {
	it("returns only public approval details and binds polling to the owner", async () => {
		const fetchMock = vi.fn().mockResolvedValue(mockDeviceAuthorization());
		vi.stubGlobal("fetch", fetchMock);

		const flow = await reconnect.startTadoReconnectFlow("allowed-user");

		expect(flow).toMatchObject({
			intervalSeconds: 5,
			userCode: "ABCD12",
			verificationUri: "https://login.tado.com/oauth2/device",
		});
		expect(flow).not.toHaveProperty("deviceCode");
		expect(flow).not.toHaveProperty("ownerId");

		fetchMock.mockClear();
		await expect(
			reconnect.pollTadoReconnectFlow(flow.flowId, "different-user"),
		).resolves.toEqual({
			message: "Start a new tado reconnect flow.",
			status: "expired",
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("persists approved tokens privately without returning them", async () => {
		const now = new Date("2026-08-10T07:00:00.000Z").getTime();
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(mockDeviceAuthorization())
			.mockResolvedValueOnce(
				jsonResponse({
					access_token: "private-access-token",
					expires_in: 600,
					refresh_token: "private-refresh-token",
					token_type: "Bearer",
				}),
			)
			.mockResolvedValueOnce(jsonResponse({ homes: [{ id: 12345 }] }));
		vi.stubGlobal("fetch", fetchMock);

		const flow = await reconnect.startTadoReconnectFlow("allowed-user-2");
		nowSpy.mockReturnValue(now + 5_000);
		const result = await reconnect.pollTadoReconnectFlow(
			flow.flowId,
			"allowed-user-2",
		);

		expect(result).toEqual({
			message: "tado is connected.",
			status: "connected",
		});
		expect(result).not.toHaveProperty("access_token");
		expect(result).not.toHaveProperty("refresh_token");

		const tokenPath = path.join(dataDir, ".tado-token.json");
		const [storedToken, tokenStat, files] = await Promise.all([
			fs.readFile(tokenPath, "utf8").then(JSON.parse),
			fs.stat(tokenPath),
			fs.readdir(dataDir),
		]);
		expect(storedToken).toMatchObject({
			access_token: "private-access-token",
			refresh_token: "private-refresh-token",
		});
		expect(tokenStat.mode & 0o777).toBe(0o600);
		expect(files).toEqual([".tado-token.json"]);

		const tokenRequest = fetchMock.mock.calls[1];
		expect(tokenRequest?.[0]).toBe("https://login.tado.com/oauth2/token");
		expect(String(tokenRequest?.[1]?.body)).toContain(
			"device_code=server-only-device-code",
		);
		expect(fetchMock.mock.calls[2]?.[0]).toBe("https://my.tado.com/api/v2/me");
	});

	it("does not replace the token for a different tado home", async () => {
		const now = new Date("2026-08-10T07:10:00.000Z").getTime();
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
		const tokenPath = path.join(dataDir, ".tado-token.json");
		const tokenBefore = await fs.readFile(tokenPath, "utf8").catch(() => null);
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(mockDeviceAuthorization())
			.mockResolvedValueOnce(
				jsonResponse({
					access_token: "wrong-home-access-token",
					expires_in: 600,
					refresh_token: "wrong-home-refresh-token",
					token_type: "Bearer",
				}),
			)
			.mockResolvedValueOnce(jsonResponse({ homes: [{ id: 99999 }] }));
		vi.stubGlobal("fetch", fetchMock);

		const flow = await reconnect.startTadoReconnectFlow("allowed-user-wrong");
		nowSpy.mockReturnValue(now + 5_000);
		await expect(
			reconnect.pollTadoReconnectFlow(flow.flowId, "allowed-user-wrong"),
		).resolves.toEqual({
			message:
				"The approved tado account does not have access to this Window Watcher home.",
			status: "denied",
		});

		expect(await fs.readFile(tokenPath, "utf8").catch(() => null)).toBe(
			tokenBefore,
		);
	});

	it("preserves the current token when home verification is unavailable", async () => {
		const now = new Date("2026-08-10T07:15:00.000Z").getTime();
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
		const tokenPath = path.join(dataDir, ".tado-token.json");
		const tokenBefore = await fs.readFile(tokenPath, "utf8").catch(() => null);
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(mockDeviceAuthorization())
			.mockResolvedValueOnce(
				jsonResponse({
					access_token: "unverified-access-token",
					expires_in: 600,
					refresh_token: "unverified-refresh-token",
				}),
			)
			.mockResolvedValueOnce(jsonResponse({}, 503));
		vi.stubGlobal("fetch", fetchMock);

		const flow = await reconnect.startTadoReconnectFlow("verification-outage");
		nowSpy.mockReturnValue(now + 5_000);
		await expect(
			reconnect.pollTadoReconnectFlow(flow.flowId, "verification-outage"),
		).rejects.toThrow("tado reconnect failed with 503");

		expect(await fs.readFile(tokenPath, "utf8").catch(() => null)).toBe(
			tokenBefore,
		);
		expect(
			(await fs.readdir(dataDir)).some((file) => file.endsWith(".tmp")),
		).toBe(false);
	});

	it("enforces the provider polling interval on the server", async () => {
		const now = new Date("2026-08-10T07:20:00.000Z").getTime();
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
		const fetchMock = vi.fn().mockResolvedValueOnce(mockDeviceAuthorization());
		vi.stubGlobal("fetch", fetchMock);

		const flow = await reconnect.startTadoReconnectFlow("rate-limited-user");
		fetchMock.mockClear();

		await expect(
			reconnect.pollTadoReconnectFlow(flow.flowId, "rate-limited-user"),
		).resolves.toMatchObject({ intervalSeconds: 5, status: "pending" });
		expect(fetchMock).not.toHaveBeenCalled();

		nowSpy.mockReturnValue(now + 5_000);
		fetchMock.mockResolvedValueOnce(
			jsonResponse({ error: "authorization_pending" }, 400),
		);
		await expect(
			reconnect.pollTadoReconnectFlow(flow.flowId, "rate-limited-user"),
		).resolves.toMatchObject({ intervalSeconds: 5, status: "pending" });
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await reconnect.pollTadoReconnectFlow(flow.flowId, "rate-limited-user");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("honors tado slow-down responses for later polls", async () => {
		const now = new Date("2026-08-10T07:30:00.000Z").getTime();
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(mockDeviceAuthorization())
			.mockResolvedValueOnce(jsonResponse({ error: "slow_down" }, 400));
		vi.stubGlobal("fetch", fetchMock);

		const flow = await reconnect.startTadoReconnectFlow("slow-down-user");
		nowSpy.mockReturnValue(now + 5_000);
		await expect(
			reconnect.pollTadoReconnectFlow(flow.flowId, "slow-down-user"),
		).resolves.toMatchObject({ intervalSeconds: 10, status: "pending" });

		nowSpy.mockReturnValue(now + 10_000);
		await reconnect.pollTadoReconnectFlow(flow.flowId, "slow-down-user");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("rejects provider-supplied approval links outside tado", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				mockDeviceAuthorization({
					verification_uri_complete:
						"https://example.com/oauth2/device?user_code=ABCD12",
				}),
			),
		);

		await expect(
			reconnect.startTadoReconnectFlow("allowed-user-3"),
		).rejects.toThrow("unexpected verification address");
	});
});
