const minuteMs = 60 * 1000;

export function getNextExpectedCheckAt(nowMs: number, intervalMs: number) {
	if (!Number.isFinite(nowMs)) {
		throw new RangeError("The current time must be finite.");
	}
	if (!Number.isFinite(intervalMs) || intervalMs < minuteMs) {
		throw new RangeError("The sampling interval must be at least one minute.");
	}

	return Math.floor(nowMs / intervalMs) * intervalMs + intervalMs;
}

export function describeNextCheck(nowMs: number, nextExpectedAt: string) {
	const nextMs = new Date(nextExpectedAt).getTime();
	if (!Number.isFinite(nowMs) || !Number.isFinite(nextMs)) {
		return "Next check time unavailable";
	}

	const remainingMs = nextMs - nowMs;
	if (remainingMs <= 0) return "Room check due";
	if (remainingMs < minuteMs) return "Next room check in less than a minute";

	const minutes = Math.ceil(remainingMs / minuteMs);
	return `Next room check in ${minutes} min`;
}
