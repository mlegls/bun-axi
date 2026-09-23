import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { basename, join } from "node:path";

export interface Captured { code: number; output: string; log: string; ms: number }

/** Per-project scratch directory for full logs, stable across runs so paths stay predictable. */
export function logDir(cwd: string): string {
	const dir = join(tmpdir(), "bun-axi", basename(cwd) + "-" + createHash("sha1").update(cwd).digest("hex").slice(0, 8));
	mkdirSync(dir, { recursive: true });
	return dir;
}

export function shortPath(path: string): string {
	const home = homedir();
	return path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
}

/** Runs a command to completion with stdout and stderr interleaved in arrival order. */
export async function capture(cmd: string[], cwd: string, name: string): Promise<Captured> {
	const started = Date.now();
	const child = Bun.spawn(cmd, {
		cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe",
		env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
	});
	const decoder = new TextDecoder();
	let output = "";
	const drain = async (stream: ReadableStream<Uint8Array>) => {
		for await (const chunk of stream) output += decoder.decode(chunk, { stream: true });
	};
	await Promise.all([drain(child.stdout), drain(child.stderr)]);
	const code = await child.exited;
	const log = join(logDir(cwd), name + ".log");
	writeFileSync(log, output);
	return { code, output, log, ms: Date.now() - started };
}

export function seconds(ms: number): string {
	return ms < 1000 ? ms + "ms" : (ms / 1000).toFixed(1) + "s";
}

/** Head-truncated preview with the total size, per AXI content truncation. */
export function preview(text: string, limit: number, fromEnd = false): string {
	const t = text.trim();
	if (t.length <= limit) return t;
	return fromEnd
		? "... (" + t.length + " chars total; showing the last " + limit + ")\n" + t.slice(-limit)
		: t.slice(0, limit) + "\n... (truncated, " + t.length + " chars total)";
}

export function oneLine(text: string, limit = 240): string {
	const t = text.replace(/\s+/g, " ").trim();
	return t.length <= limit ? t : t.slice(0, limit - 1) + "…";
}
