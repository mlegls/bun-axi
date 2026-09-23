#!/usr/bin/env bun
import { tryFastPath } from "axi-sdk-js/fast-path";
import { VERSION } from "../src/version.ts";

if (!tryFastPath(process.argv.slice(2), { version: VERSION })) {
	const { main } = await import("../src/cli.ts");
	await main(process.argv.slice(2));
}
