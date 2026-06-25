import { spawn } from "node:child_process";
import http from "node:http";
import { watch } from "node:fs";

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const APP_PORT = Number(process.env.WINDOW_WATCHER_APP_PORT || PUBLIC_PORT + 1);
const WATCH_PATHS = [
	"src",
	"scripts",
	"vite.config.ts",
	"package.json",
	"pnpm-lock.yaml",
	"tsconfig.json",
	"biome.json",
];
const RELOAD_SNIPPET = `
<script>
(() => {
  const events = new EventSource("/__window_watcher_dev/events");
  events.addEventListener("reload", () => window.location.reload());
})();
</script>`;

let appProcess;
let building = false;
let queued = false;
const reloadClients = new Set();

function log(message) {
	console.log(`[window-watcher-dev] ${message}`);
}

function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: "inherit",
			...options,
		});
		child.on("exit", (code, signal) => {
			if (code === 0) resolve();
			else reject(new Error(`${command} ${args.join(" ")} failed: ${code ?? signal}`));
		});
	});
}

function stopApp() {
	if (!appProcess || appProcess.killed) return Promise.resolve();

	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			appProcess.kill("SIGKILL");
			resolve();
		}, 5_000);

		appProcess.once("exit", () => {
			clearTimeout(timeout);
			resolve();
		});
		appProcess.kill("SIGTERM");
	});
}

function startApp() {
	appProcess = spawn(process.execPath, ["scripts/start-railway.mjs"], {
		env: {
			...process.env,
			NODE_ENV: "development",
			PORT: String(APP_PORT),
		},
		stdio: "inherit",
	});

	appProcess.on("exit", (code, signal) => {
		if (code != null && code !== 0) {
			log(`app process exited with code ${code}`);
		} else if (signal) {
			log(`app process exited by ${signal}`);
		}
	});
}

function notifyReload() {
	for (const response of reloadClients) {
		response.write("event: reload\ndata: now\n\n");
	}
}

async function rebuild(reason) {
	if (building) {
		queued = true;
		return;
	}

	building = true;
	try {
		log(`rebuilding${reason ? ` after ${reason}` : ""}`);
		await run("pnpm", ["run", "build"], {
			env: { ...process.env, NODE_ENV: "production" },
		});
		await stopApp();
		startApp();
		notifyReload();
		log(`ready at http://localhost:${PUBLIC_PORT}`);
	} catch (error) {
		console.error(error);
	} finally {
		building = false;
		if (queued) {
			queued = false;
			void rebuild("queued changes");
		}
	}
}

function proxyRequest(request, response) {
	if (request.url === "/__window_watcher_dev/events") {
		response.writeHead(200, {
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"Content-Type": "text/event-stream",
		});
		response.write("event: ready\ndata: connected\n\n");
		reloadClients.add(response);
		request.on("close", () => reloadClients.delete(response));
		return;
	}

	const proxy = http.request(
		{
			hostname: "127.0.0.1",
			port: APP_PORT,
			method: request.method,
			path: request.url,
			headers: request.headers,
		},
		(upstream) => {
			const chunks = [];
			upstream.on("data", (chunk) => chunks.push(chunk));
			upstream.on("end", () => {
				const body = Buffer.concat(chunks);
				const contentType = upstream.headers["content-type"] || "";

				if (contentType.includes("text/html")) {
					const html = body.toString("utf8").replace("</body>", `${RELOAD_SNIPPET}</body>`);
					const headers = { ...upstream.headers };
					delete headers["content-length"];
					response.writeHead(upstream.statusCode || 200, headers);
					response.end(html);
					return;
				}

				response.writeHead(upstream.statusCode || 200, upstream.headers);
				response.end(body);
			});
		},
	);

	proxy.on("error", () => {
		response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
		response.end("Window Watcher is rebuilding. Refresh in a moment.");
	});
	request.pipe(proxy);
}

function watchForChanges() {
	let timer;
	const schedule = (path) => {
		clearTimeout(timer);
		timer = setTimeout(() => void rebuild(path || "file change"), 350);
	};

	for (const path of WATCH_PATHS) {
		try {
			watch(path, { recursive: true }, (_event, filename) => {
				const changed = filename ? `${path}/${filename}` : path;
				if (changed.includes(".output") || changed.includes("node_modules")) return;
				schedule(changed);
			});
		} catch {
			watch(path, () => schedule(path));
		}
	}
}

process.on("SIGINT", async () => {
	await stopApp();
	process.exit(0);
});
process.on("SIGTERM", async () => {
	await stopApp();
	process.exit(0);
});

http.createServer(proxyRequest).listen(PUBLIC_PORT, "127.0.0.1", () => {
	log(`proxy listening at http://localhost:${PUBLIC_PORT}`);
});

watchForChanges();
await rebuild("startup");
