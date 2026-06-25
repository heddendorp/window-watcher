import { clerkMiddleware } from "@clerk/tanstack-react-start/server";
import { createStart } from "@tanstack/react-start";

function shouldRegisterClerkMiddleware() {
	if (
		process.env.RAILWAY_ENVIRONMENT_ID ||
		process.env.RAILWAY_PROJECT_ID ||
		process.env.RAILWAY_SERVICE_ID
	) {
		return true;
	}

	return process.env.WINDOW_WATCHER_AUTH === "true";
}

export const startInstance = createStart(() => ({
	requestMiddleware: shouldRegisterClerkMiddleware() ? [clerkMiddleware()] : [],
}));
