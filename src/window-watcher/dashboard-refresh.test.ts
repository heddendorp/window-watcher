import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createDashboardWakeHandler,
	DashboardRequestTimeoutError,
	runWithAbortTimeout,
} from "./dashboard-refresh";

afterEach(() => {
	vi.useRealTimers();
});

describe("dashboard request timeout", () => {
	it("aborts a request that never settles", async () => {
		vi.useFakeTimers();
		let requestSignal: AbortSignal | undefined;
		const request = runWithAbortTimeout(
			async (signal) => {
				requestSignal = signal;
				return await new Promise<never>(() => undefined);
			},
			{ timeoutMs: 30_000 },
		);
		const rejection = expect(request).rejects.toBeInstanceOf(
			DashboardRequestTimeoutError,
		);

		await vi.advanceTimersByTimeAsync(30_000);

		await rejection;
		expect(requestSignal?.aborted).toBe(true);
	});

	it("forwards query cancellation to the request", async () => {
		const parent = new AbortController();
		let requestSignal: AbortSignal | undefined;
		const request = runWithAbortTimeout(
			async (signal) => {
				requestSignal = signal;
				return await new Promise<never>(() => undefined);
			},
			{ signal: parent.signal, timeoutMs: 30_000 },
		);
		const rejection = expect(request).rejects.toThrow("query replaced");

		parent.abort(new Error("query replaced"));

		await rejection;
		expect(requestSignal?.aborted).toBe(true);
	});

	it("does not start a request for an already-cancelled query", async () => {
		const parent = new AbortController();
		parent.abort(new Error("page left"));
		const requestTask = vi.fn(async () => "unreachable");

		const request = runWithAbortTimeout(requestTask, {
			signal: parent.signal,
			timeoutMs: 30_000,
		});

		await expect(request).rejects.toThrow("page left");
		expect(requestTask).not.toHaveBeenCalled();
	});
});

describe("dashboard wake refresh", () => {
	it("refreshes once when a visible, online page emits overlapping wake events", () => {
		let currentTime = 5_000;
		const refresh = vi.fn();
		const handleWake = createDashboardWakeHandler({
			isOnline: () => true,
			isVisible: () => true,
			now: () => currentTime,
			refresh,
		});

		expect(handleWake()).toBe(true);
		expect(handleWake()).toBe(false);
		currentTime += 1_000;
		expect(handleWake()).toBe(true);
		expect(refresh).toHaveBeenCalledTimes(2);
	});

	it("waits until the page is visible and online", () => {
		let isOnline = false;
		let isVisible = false;
		const refresh = vi.fn();
		const handleWake = createDashboardWakeHandler({
			isOnline: () => isOnline,
			isVisible: () => isVisible,
			refresh,
		});

		expect(handleWake()).toBe(false);
		isVisible = true;
		expect(handleWake()).toBe(false);
		isOnline = true;
		expect(handleWake()).toBe(true);
		expect(refresh).toHaveBeenCalledOnce();
	});
});
