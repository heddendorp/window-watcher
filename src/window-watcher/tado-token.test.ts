import { describe, expect, it } from "vitest";
import { buildStoredTadoToken } from "./tado-token";

describe("buildStoredTadoToken", () => {
	it("preserves the current refresh token when rotation omits a replacement", () => {
		expect(
			buildStoredTadoToken(
				{ access_token: "new-access", expires_in: 600 },
				"current-refresh",
				1_000,
			),
		).toEqual({
			access_token: "new-access",
			expires_at: 541_000,
			refresh_token: "current-refresh",
			token_type: "Bearer",
		});
	});

	it("rejects incomplete authorization responses", () => {
		expect(() => buildStoredTadoToken({ refresh_token: "refresh" })).toThrow(
			"incomplete token response",
		);
		expect(() => buildStoredTadoToken({ access_token: "access" })).toThrow(
			"incomplete token response",
		);
	});
});
