import { describe, expect, it } from "vitest";
import { describeNextCheck, getNextExpectedCheckAt } from "./sampling-schedule";

describe("getNextExpectedCheckAt", () => {
	it("aligns a ten-minute production check to the next wall-clock boundary", () => {
		const now = new Date("2026-08-05T08:34:16.000Z").getTime();
		expect(
			new Date(getNextExpectedCheckAt(now, 10 * 60 * 1000)).toISOString(),
		).toBe("2026-08-05T08:40:00.000Z");
	});

	it("moves an exact boundary to the following check", () => {
		const now = new Date("2026-08-05T08:40:00.000Z").getTime();
		expect(
			new Date(getNextExpectedCheckAt(now, 10 * 60 * 1000)).toISOString(),
		).toBe("2026-08-05T08:50:00.000Z");
	});

	it("leaves a missed boundary due until a successful check advances it", () => {
		const lastSuccessfulCheck = new Date("2026-08-05T08:30:02.000Z").getTime();
		const nextExpectedAt = new Date(
			getNextExpectedCheckAt(lastSuccessfulCheck, 10 * 60 * 1000),
		).toISOString();
		const currentTime = new Date("2026-08-05T08:45:00.000Z").getTime();

		expect(describeNextCheck(currentTime, nextExpectedAt)).toBe(
			"Room check due",
		);
	});

	it("rejects invalid intervals", () => {
		expect(() => getNextExpectedCheckAt(Date.now(), 0)).toThrow(RangeError);
	});
});

describe("describeNextCheck", () => {
	const now = new Date("2026-08-05T08:34:16.000Z").getTime();

	it("rounds an upcoming check up to a useful minute countdown", () => {
		expect(describeNextCheck(now, "2026-08-05T08:40:00.000Z")).toBe(
			"Next room check in 6 min",
		);
	});

	it("makes an imminent check explicit", () => {
		expect(describeNextCheck(now, "2026-08-05T08:35:00.000Z")).toBe(
			"Next room check in less than a minute",
		);
	});

	it("reports a passed check as due", () => {
		expect(describeNextCheck(now, "2026-08-05T08:30:00.000Z")).toBe(
			"Room check due",
		);
	});
});
