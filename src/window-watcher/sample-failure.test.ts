import { describe, expect, it } from "vitest";
import { classifySampleFailure } from "./sample-failure";

describe("classifySampleFailure", () => {
	it("separates rate limits and invalid tado authorization", () => {
		expect(
			classifySampleFailure(
				Object.assign(new Error("tado is rate limited."), {
					provider: "tado",
					status: 429,
				}),
			),
		).toBe("rate_limited");
		expect(
			classifySampleFailure(
				Object.assign(new Error("The refresh_token is invalid."), {
					details: { error: "invalid_grant" },
					provider: "tado authorization",
					status: 400,
				}),
			),
		).toBe("tado_auth_invalid");
	});

	it("keeps provider outages distinct from application errors", () => {
		expect(
			classifySampleFailure(
				Object.assign(new Error("tado failed with 503"), {
					provider: "tado",
					status: 503,
				}),
			),
		).toBe("provider_unavailable");
		expect(classifySampleFailure(new Error("Unexpected invariant"))).toBe(
			"internal_error",
		);
	});

	it("keeps unexpected provider 4xx responses fatal", () => {
		for (const status of [400, 404]) {
			expect(
				classifySampleFailure(
					Object.assign(new Error(`tado failed with ${status}`), {
						provider: "tado",
						status,
					}),
				),
			).toBe("internal_error");
		}
	});

	it("does not trust malformed provider metadata", () => {
		expect(
			classifySampleFailure(
				Object.assign(new Error("Malformed provider response"), {
					details: { error: 42 },
					provider: { name: "tado" },
					status: 503,
				}),
			),
		).toBe("internal_error");
	});
});
