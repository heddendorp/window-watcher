import { createMiddleware, createStart } from "@tanstack/react-start";

const REALM = "Window Watcher";

function unauthorized() {
	return new Response("Authentication required", {
		status: 401,
		headers: {
			"WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
		},
	});
}

function authNotConfigured() {
	return new Response(
		"APP_PASSWORD is required before exposing Window Watcher",
		{
			status: 503,
			headers: {
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff",
			},
		},
	);
}

function timingSafeEqualString(left: string, right: string) {
	const encoder = new TextEncoder();
	const leftBytes = encoder.encode(left);
	const rightBytes = encoder.encode(right);
	const length = Math.max(leftBytes.length, rightBytes.length, 1);
	const paddedLeft = new Uint8Array(length);
	const paddedRight = new Uint8Array(length);
	paddedLeft.set(leftBytes.slice(0, length));
	paddedRight.set(rightBytes.slice(0, length));

	let diff = leftBytes.length ^ rightBytes.length;
	for (let index = 0; index < length; index += 1) {
		diff |= paddedLeft[index] ^ paddedRight[index];
	}
	return diff === 0;
}

function parseBasicAuth(header: string | null) {
	if (!header?.startsWith("Basic ")) return null;

	try {
		const decoded = atob(header.slice("Basic ".length));
		const separator = decoded.indexOf(":");
		if (separator === -1) return null;
		return {
			username: decoded.slice(0, separator),
			password: decoded.slice(separator + 1),
		};
	} catch {
		return null;
	}
}

const basicAuthMiddleware = createMiddleware().server(
	async ({ next, request }) => {
		const expectedPassword = process.env.APP_PASSWORD;
		const expectedUsername = process.env.APP_USERNAME || "window";
		const isRailway =
			process.env.RAILWAY_ENVIRONMENT_ID ||
			process.env.RAILWAY_PROJECT_ID ||
			process.env.RAILWAY_SERVICE_ID;

		if (!expectedPassword) {
			if (isRailway) return authNotConfigured();
			return next();
		}

		const credentials = parseBasicAuth(request.headers.get("authorization"));
		const valid =
			credentials != null &&
			timingSafeEqualString(credentials.username, expectedUsername) &&
			timingSafeEqualString(credentials.password, expectedPassword);

		if (!valid) return unauthorized();

		return next();
	},
);

export const startInstance = createStart(() => ({
	requestMiddleware: [basicAuthMiddleware],
}));
