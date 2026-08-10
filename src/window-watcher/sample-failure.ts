export type SampleFailureReason =
	| "rate_limited"
	| "tado_auth_invalid"
	| "provider_unavailable"
	| "internal_error";

type SampleFailureMetadata = {
	details?: { error?: unknown };
	provider?: unknown;
	sampleFailureReason?: unknown;
	status?: unknown;
};

const sampleFailureReasons = new Set<SampleFailureReason>([
	"rate_limited",
	"tado_auth_invalid",
	"provider_unavailable",
	"internal_error",
]);

export function createSampleFailure(
	message: string,
	reason: SampleFailureReason,
	provider?: string,
) {
	return Object.assign(new Error(message), {
		provider,
		sampleFailureReason: reason,
	});
}

export function classifySampleFailure(error: unknown): SampleFailureReason {
	if (!(error instanceof Error)) return "internal_error";

	const typedError = error as Error & SampleFailureMetadata;
	if (
		typeof typedError.sampleFailureReason === "string" &&
		sampleFailureReasons.has(
			typedError.sampleFailureReason as SampleFailureReason,
		)
	) {
		return typedError.sampleFailureReason as SampleFailureReason;
	}

	const message = error.message.toLowerCase();
	const provider =
		typeof typedError.provider === "string"
			? typedError.provider.toLowerCase()
			: "";
	const providerError =
		typeof typedError.details?.error === "string"
			? typedError.details.error.toLowerCase()
			: "";
	const status =
		typeof typedError.status === "number" ? typedError.status : undefined;

	if (status === 429) {
		return "rate_limited";
	}

	if (
		provider.includes("tado") &&
		(providerError === "invalid_grant" ||
			providerError === "access_denied" ||
			message.includes("refresh_token") ||
			message.includes("tado is not connected") ||
			status === 401 ||
			status === 403)
	) {
		return "tado_auth_invalid";
	}

	if (provider && (status == null || status === 408 || status >= 500)) {
		return "provider_unavailable";
	}
	return "internal_error";
}
