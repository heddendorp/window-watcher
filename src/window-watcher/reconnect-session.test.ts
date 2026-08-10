import { describe, expect, it } from "vitest";
import {
	buildClearedTadoReconnectCookie,
	buildTadoReconnectCookie,
	createTadoReconnectActorId,
	readCookieValue,
	TADO_RECONNECT_COOKIE,
} from "./reconnect-session";

describe("tado reconnect session", () => {
	it("creates an opaque 256-bit actor id", () => {
		const actorId = createTadoReconnectActorId(new Uint8Array(32).fill(0xab));
		expect(actorId).toBe("ab".repeat(32));
		expect(() => createTadoReconnectActorId(new Uint8Array(15))).toThrow(
			"at least 128 bits",
		);
	});

	it("issues and clears a host-only hardened cookie", () => {
		const issued = buildTadoReconnectCookie("opaque-actor");
		expect(issued).toContain(
			`${TADO_RECONNECT_COOKIE}=opaque-actor; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=600`,
		);
		expect(issued).not.toContain("Domain=");
		expect(buildClearedTadoReconnectCookie()).toContain("Max-Age=0");
	});

	it("reads only the named cookie", () => {
		const header = `other=value; ${TADO_RECONNECT_COOKIE}=expected-actor`;
		expect(readCookieValue(header, TADO_RECONNECT_COOKIE)).toBe(
			"expected-actor",
		);
		expect(readCookieValue(header, "missing-cookie")).toBeNull();
	});
});
