import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const builtAt = new Date().toISOString();

function readGitCommit() {
	try {
		return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return undefined;
	}
}

const version =
	process.env.RAILWAY_GIT_COMMIT_SHA ||
	process.env.GITHUB_SHA ||
	readGitCommit() ||
	builtAt;

const versionFile = join(root, "public", "app-version.json");
mkdirSync(dirname(versionFile), { recursive: true });
writeFileSync(
	versionFile,
	`${JSON.stringify({ builtAt, version }, null, 2)}\n`,
	"utf8",
);
