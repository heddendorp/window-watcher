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

				const status = await recordCoolingStatusSample("cron");
				if (!status) {
					return Response.json({
						ok: true,
						skipped: true,
						reason: "rate_limited",
					});
				}

				return Response.json({
					ok: true,
					skipped: false,
					checkedAt: status.checkedAt,
					outsideC: status.outside.temperatureC,
					roomCount: status.rooms.length,
				});
			},
		},
	},
});
