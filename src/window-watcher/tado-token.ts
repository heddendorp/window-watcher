export type TadoTokenResponse = {
	access_token?: string;
	refresh_token?: string;
	expires_at?: number;
	expires_in?: number;
	token_type?: string;
};

export function buildStoredTadoToken(
	token: TadoTokenResponse,
	fallbackRefreshToken?: string,
	now = Date.now(),
) {
	const accessToken = token.access_token?.trim();
	const refreshToken =
		token.refresh_token?.trim() || fallbackRefreshToken?.trim();
	if (!accessToken || !refreshToken) {
		throw new Error("tado returned an incomplete token response.");
	}

	return {
		access_token: accessToken,
		refresh_token: refreshToken,
		expires_at: now + Math.max(0, Number(token.expires_in || 0) - 60) * 1000,
		token_type: token.token_type || "Bearer",
	};
}
