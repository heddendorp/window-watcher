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
	serverModule.startBackgroundSampler?.();
}

await startSampler();
await import("../.output/server/index.mjs");
