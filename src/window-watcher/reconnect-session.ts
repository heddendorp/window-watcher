export const TADO_RECONNECT_COOKIE = "__Host-window-watcher-tado-reconnect";

export function createTadoReconnectActorId(
	randomBytes = crypto.getRandomValues(new Uint8Array(32)),
) {
	if (randomBytes.byteLength < 16) {
		throw new Error("A reconnect actor needs at least 128 bits of randomness.");
	}
	return Array.from(randomBytes, (value) => {
		return value.toString(16).padStart(2, "0");
	}).join("");
}

export function readCookieValue(
	cookieHeader: string | undefined,
	name: string,
) {
	if (!cookieHeader) return null;

	for (const cookie of cookieHeader.split(/;\s*/)) {
		const separator = cookie.indexOf("=");
		if (separator === -1) continue;
		if (cookie.slice(0, separator) === name) {
			return cookie.slice(separator + 1);
		}
	}
	return null;
}

export function buildTadoReconnectCookie(actorId: string) {
	return `${TADO_RECONNECT_COOKIE}=${actorId}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=600`;
}

export function buildClearedTadoReconnectCookie() {
	return `${TADO_RECONNECT_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
