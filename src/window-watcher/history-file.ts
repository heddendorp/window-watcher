import fs from "node:fs/promises";

const DEFAULT_TAIL_CHUNK_BYTES = 1024 * 1024;

export async function readLastNonEmptyLines(
	filePath: string,
	limit: number,
	chunkBytes = DEFAULT_TAIL_CHUNK_BYTES,
) {
	if (!Number.isSafeInteger(limit) || limit <= 0) {
		throw new RangeError("History line limit must be a positive integer.");
	}
	if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
		throw new RangeError("History chunk size must be a positive integer.");
	}

	const file = await fs.open(filePath, "r");
	try {
		const { size } = await file.stat();
		let position = size;
		let newlineCount = 0;
		const chunks: Array<Buffer> = [];

		while (position > 0 && newlineCount <= limit) {
			const bytesToRead = Math.min(chunkBytes, position);
			position -= bytesToRead;
			const buffer = Buffer.allocUnsafe(bytesToRead);
			const { bytesRead } = await file.read(buffer, 0, bytesToRead, position);
			const chunk = buffer.subarray(0, bytesRead);
			chunks.unshift(chunk);

			for (const byte of chunk) {
				if (byte === 10) newlineCount += 1;
			}
		}

		return Buffer.concat(chunks)
			.toString("utf8")
			.split("\n")
			.filter(Boolean)
			.slice(-limit);
	} finally {
		await file.close();
	}
}
