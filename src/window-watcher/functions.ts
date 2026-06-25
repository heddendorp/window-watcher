import { createServerFn } from "@tanstack/react-start";
import type { DashboardData } from "./types";

export const getDashboardData = createServerFn({ method: "GET" }).handler(
	async (): Promise<DashboardData> => {
		const { getDashboardPayload } = await import("./server");
		return getDashboardPayload();
	},
);
