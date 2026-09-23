import { parseArgs } from "node:util";
import { AxiError } from "axi-sdk-js";

export type FlagSpec = Record<string, { type: "string" | "boolean"; short?: string; multiple?: boolean }>;

/** Strict per-command flags: an unknown or malformed flag is a usage error listing the valid ones. */
export function parseFlags<S extends FlagSpec>(command: string, args: string[], spec: S) {
	try {
		return parseArgs({ args, options: spec, allowPositionals: true, strict: true });
	} catch (error) {
		const valid = Object.entries(spec).map(([name, f]) => "--" + name + (f.short ? "/-" + f.short : "") + (f.type === "string" ? " <value>" : "")).join(", ");
		const message = error instanceof Error ? error.message.split("\n")[0].replace(/\. To specify a positional.*$/, "") : String(error);
		throw new AxiError(message, "VALIDATION_ERROR", [
			"Valid flags for `" + command + "`: " + (valid || "(none)") + " (--help always allowed)",
			"Run `bun-axi " + command + " --help` for usage",
		]);
	}
}

export function usage(message: string, ...suggestions: string[]): never {
	throw new AxiError(message, "VALIDATION_ERROR", suggestions);
}

/** A --limit style flag: absent means the default, anything but a positive integer is a usage error. */
export function count(command: string, flag: string, value: string | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	const n = Number(value);
	if (!Number.isInteger(n) || n < 1) usage("--" + flag + " must be a positive integer, got " + JSON.stringify(value), "Run `bun-axi " + command + " --" + flag + " " + fallback + "`");
	return n;
}
