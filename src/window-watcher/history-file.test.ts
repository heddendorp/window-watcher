import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLastNonEmptyLines } from "./history-file";

const temporaryDirectories: Array<string> = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			fs.rm(directory, {
				force: true,
				recursive: true,
			}),
		),
	);
});

describe("readLastNonEmptyLines", () => {
	it("reads complete UTF-8 lines from the end without including a partial chunk", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ww-history-"));
		temporaryDirectories.push(directory);
		const filePath = path.join(directory, "history.jsonl");
		await fs.writeFile(
			filePath,
			["first", "München", "third", "fourth", ""].join("\n"),
		);

		await expect(readLastNonEmptyLines(filePath, 2, 5)).resolves.toEqual([
			"third",
			"fourth",
		]);
	});

	it("handles a final line without a trailing newline", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ww-history-"));
		temporaryDirectories.push(directory);
		const filePath = path.join(directory, "history.jsonl");
		await fs.writeFile(filePath, "one\ntwo\nthree");

		await expect(readLastNonEmptyLines(filePath, 2, 4)).resolves.toEqual([
			"two",
			"three",
		]);
	});

	it("rejects invalid limits", async () => {
		await expect(readLastNonEmptyLines("unused", 0)).rejects.toThrow(
			RangeError,
		);
	});
});
