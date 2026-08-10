import { auth, clerkClient } from "@clerk/tanstack-react-start/server";
import { createServerFn } from "@tanstack/react-start";
import {
	getRequestHeader,
	setResponseHeader,
} from "@tanstack/react-start/server";
import { z } from "zod";
import {
	buildClearedTadoReconnectCookie,
	buildTadoReconnectCookie,
	createTadoReconnectActorId,
	readCookieValue,
	TADO_RECONNECT_COOKIE,
} from "./reconnect-session";
import { classifySampleFailure } from "./sample-failure";

export const getDashboardData = createServerFn({ method: "GET" }).handler(
	async () => {
		try {
			if (shouldRequireAuth()) await requireAuthorizedUser();
			const { getDashboardPayload } = await import("./server");
			return { data: await getDashboardPayload(), ok: true as const };
		} catch (error) {
			return {
				error: {
					message:
						error instanceof Error
							? error.message
							: "Could not load temperatures.",
					reason: classifySampleFailure(error),
				},
				ok: false as const,
			};
		}
	},
);

export const startTadoReconnect = createServerFn({ method: "POST" }).handler(
	async () => {
		const actor = await requireTadoReconnectActor(true);
		const { startTadoReconnectFlow } = await import("./server");
		return startTadoReconnectFlow(actor.id);
	},
);

export const pollTadoReconnect = createServerFn({ method: "POST" })
	.validator(z.object({ flowId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const actor = await requireTadoReconnectActor(false);
		const { pollTadoReconnectFlow } = await import("./server");
		const result = await pollTadoReconnectFlow(data.flowId, actor.id);
		if (actor.usesRecoveryCookie && result.status !== "pending") {
			clearTadoReconnectCookie();
		}
		return result;
	});

async function requireTadoReconnectActor(issueRecoveryCookie: boolean) {
	if (shouldRequireAuth()) {
		return { id: await requireAuthorizedUser(), usesRecoveryCookie: false };
	}

	if (!isDeployedEnvironment()) {
		return { id: "local-development", usesRecoveryCookie: false };
	}

	if (!process.env.TADO_HOME_ID?.trim()) {
		throw new Error(
			"TADO_HOME_ID must be configured before tado can reconnect in production without sign-in.",
		);
	}

	if (!issueRecoveryCookie) {
		const existingActorId = readCookieValue(
			getRequestHeader("cookie"),
			TADO_RECONNECT_COOKIE,
		);
		if (existingActorId) {
			return { id: existingActorId, usesRecoveryCookie: true };
		}
		throw new Error("Start a new tado reconnect flow.");
	}

	const actorId = createTadoReconnectActorId();
	setResponseHeader("Set-Cookie", buildTadoReconnectCookie(actorId));
	return { id: actorId, usesRecoveryCookie: true };
}

function isDeployedEnvironment() {
	return Boolean(
		process.env.NODE_ENV === "production" ||
			process.env.RAILWAY_ENVIRONMENT_ID ||
			process.env.RAILWAY_PROJECT_ID ||
			process.env.RAILWAY_SERVICE_ID,
	);
}

function clearTadoReconnectCookie() {
	setResponseHeader("Set-Cookie", buildClearedTadoReconnectCookie());
}

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

	return authState.userId;
}
