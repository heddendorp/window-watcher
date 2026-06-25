import { auth, clerkClient } from "@clerk/tanstack-react-start/server";
import { createServerFn } from "@tanstack/react-start";
import type { DashboardData } from "./types";

export const getDashboardData = createServerFn({ method: "GET" }).handler(
	async (): Promise<DashboardData> => {
		if (shouldRequireAuth()) await requireAuthorizedUser();
		const { getDashboardPayload } = await import("./server");
		return getDashboardPayload();
	},
);

function shouldRequireAuth() {
	if (isRailwayRuntime()) return true;
	return process.env.WINDOW_WATCHER_AUTH === "true";
}

function isRailwayRuntime() {
	return Boolean(
		process.env.RAILWAY_ENVIRONMENT_ID ||
			process.env.RAILWAY_PROJECT_ID ||
			process.env.RAILWAY_SERVICE_ID,
	);
}

async function requireAuthorizedUser() {
	const allowedEmail = process.env.AUTHORIZED_EMAIL?.trim().toLowerCase();
	if (!allowedEmail) {
		throw new Error(
			"AUTHORIZED_EMAIL must be set before Window Watcher can expose temperature data.",
		);
	}

	if (!process.env.CLERK_SECRET_KEY) {
		throw new Error(
			"CLERK_SECRET_KEY must be set before Window Watcher can expose temperature data.",
		);
	}

	const authState = await auth();
	if (!authState.isAuthenticated) {
		throw new Error("Sign in with Google to view Window Watcher.");
	}

	const user = await clerkClient().users.getUser(authState.userId);
	const googleEmails = user.externalAccounts
		.filter(
			(account) =>
				account.provider === "google" &&
				account.verification?.status === "verified",
		)
		.map((account) => account.emailAddress.trim().toLowerCase());

	if (!googleEmails.includes(allowedEmail)) {
		throw new Error(
			"This Google account is not allowed to view Window Watcher.",
		);
	}
}
