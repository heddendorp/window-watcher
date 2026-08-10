import { createFileRoute } from "@tanstack/react-router";
import { recordCoolingStatusSample } from "../../window-watcher/server";

export const Route = createFileRoute("/api/sample")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const expectedToken = process.env.SAMPLE_TRIGGER_TOKEN;
				const authorization = request.headers.get("authorization") || "";
				const providedToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];

				if (!expectedToken || providedToken !== expectedToken) {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}

				const outcome = await recordCoolingStatusSample("cron");
				if (outcome.kind === "unavailable") {
					const statusCode = outcome.reason === "internal_error" ? 500 : 503;
					return Response.json(
						{
							ok: false,
							skipped: true,
							reason: outcome.reason,
							lastFreshAt: outcome.status?.lastFreshAt,
						},
						{ status: statusCode },
					);
				}
				const { status } = outcome;

				return Response.json({
					ok: true,
					skipped: false,
					checkedAt: status.checkedAt,
					outsideC: status.outside.temperatureC ?? null,
					roomCount: status.rooms.length,
				});
			},
		},
	},
});
