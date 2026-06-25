import { clerkMiddleware } from "@clerk/tanstack-react-start/server";
import { createCsrfMiddleware, createStart } from "@tanstack/react-start";

const csrfMiddleware = createCsrfMiddleware({
	filter: (ctx) => ctx.handlerType === "serverFn",
});

function shouldRegisterClerkMiddleware() {
	if (!process.env.CLERK_SECRET_KEY) return false;

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
	requestMiddleware: [
		csrfMiddleware,
		...(shouldRegisterClerkMiddleware() ? [clerkMiddleware()] : []),
	],
}));
