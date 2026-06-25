import { auth, clerkClient } from "@clerk/tanstack-react-start/server";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { DashboardData } from "./types";

export const getDashboardData = createServerFn({ method: "GET" }).handler(
	async (): Promise<DashboardData> => {
		if (shouldRequireAuth()) await requireAuthorizedUser();
		const { getDashboardPayload } = await import("./server");
		return getDashboardPayload();
	},
);

export const startTadoReconnect = createServerFn({ method: "POST" }).handler(
	async () => {
		const { startLocalTadoReconnect } = await import("./server");
		return startLocalTadoReconnect();
	},
);

export const pollTadoReconnect = createServerFn({ method: "POST" })
	.validator(z.object({ flowId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const { pollLocalTadoReconnect } = await import("./server");
		return pollLocalTadoReconnect(data.flowId);
	});

function shouldRequireAuth() {
	return (
		process.env.WINDOW_WATCHER_AUTH === "true" ||
		process.env.VITE_WINDOW_WATCHER_AUTH === "true"
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
