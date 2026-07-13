import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function startSampler() {
	const ssrDir = path.join(process.cwd(), ".output", "server", "_ssr");
	const entries = await fs.readdir(ssrDir);
	const serverChunk = entries.find(
		(entry) => entry.startsWith("server-") && entry.endsWith(".mjs"),
	);

	if (!serverChunk) {
		throw new Error("Could not find built Window Watcher server chunk.");
	}

	const moduleUrl = pathToFileURL(path.join(ssrDir, serverChunk)).href;
	const serverModule = await import(moduleUrl);
	const samplerModule = serverModule.server_exports || serverModule;
	if (typeof samplerModule.startBackgroundSampler === "function") {
		samplerModule.startBackgroundSampler();
		return;
	}

	if (typeof samplerModule.getDashboardPayload === "function") {
		void samplerModule.getDashboardPayload().catch((error) => {
			console.error(`[window-watcher:startup] ${error.message}`);
		});
		return;
	}

	throw new Error("Could not find Window Watcher sampler entrypoint.");
}

function shouldStartBackgroundSampler() {
	if (process.env.BACKGROUND_SAMPLER === "true") {
		return true;
	}

	if (process.env.BACKGROUND_SAMPLER === "false") {
		return false;
	}

	return !process.env.RAILWAY_ENVIRONMENT_ID && !process.env.RAILWAY_ENVIRONMENT;
}

if (shouldStartBackgroundSampler()) {
	await startSampler();
}
await import("../.output/server/index.mjs");
