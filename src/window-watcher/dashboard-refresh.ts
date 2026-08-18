export class DashboardRequestTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(
			`The dashboard request did not finish within ${Math.round(timeoutMs / 1000)} seconds.`,
		);
		this.name = "DashboardRequestTimeoutError";
	}
}

export async function runWithAbortTimeout<T>(
	request: (signal: AbortSignal) => Promise<T>,
	options: { signal?: AbortSignal; timeoutMs: number },
) {
	const controller = new AbortController();
	const abortFromParent = () => controller.abort(options.signal?.reason);
	if (options.signal?.aborted) {
		abortFromParent();
	} else {
		options.signal?.addEventListener("abort", abortFromParent, { once: true });
	}

	const timeout = globalThis.setTimeout(() => {
		controller.abort(new DashboardRequestTimeoutError(options.timeoutMs));
	}, options.timeoutMs);
	const getAbortReason = () =>
		controller.signal.reason ??
		new DashboardRequestTimeoutError(options.timeoutMs);
	if (controller.signal.aborted) {
		globalThis.clearTimeout(timeout);
		options.signal?.removeEventListener("abort", abortFromParent);
		throw getAbortReason();
	}
	const aborted = new Promise<never>((_, reject) => {
		controller.signal.addEventListener(
			"abort",
			() => reject(getAbortReason()),
			{ once: true },
		);
	});

	try {
		return await Promise.race([request(controller.signal), aborted]);
	} finally {
		globalThis.clearTimeout(timeout);
		options.signal?.removeEventListener("abort", abortFromParent);
	}
}

export function createDashboardWakeHandler(options: {
	isOnline: () => boolean;
	isVisible: () => boolean;
	minimumIntervalMs?: number;
	now?: () => number;
	refresh: () => void;
}) {
	const minimumIntervalMs = options.minimumIntervalMs ?? 1_000;
	const now = options.now ?? Date.now;
	let lastRefreshAt = Number.NEGATIVE_INFINITY;

	return () => {
		if (!options.isVisible() || !options.isOnline()) return false;

		const currentTime = now();
		if (currentTime - lastRefreshAt < minimumIntervalMs) return false;

		lastRefreshAt = currentTime;
		options.refresh();
		return true;
	};
}
