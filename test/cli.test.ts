import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN = new URL("../bin/bun-axi.ts", import.meta.url).pathname;
function project(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), "bun-axi-test-"));
	for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
	return dir;
}
async function axi(cwd: string, ...args: string[]) {
	const child = Bun.spawn(["bun", BIN, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	return { out: await new Response(child.stdout).text(), code: await child.exited };
}

test("test reports all passed with a definitive count", async () => {
	const dir = project({ "package.json": "{}", "ok.test.ts": 'import { test, expect } from "bun:test"; test("a", () => expect(1).toBe(1));\n' });
	const r = await axi(dir, "test");
	expect(r.code).toBe(0);
	expect(r.out).toMatch(/^tests: "?all 1 passed \(\d+(\.\d+)?m?s\) across 1 file"?$/m);
});

test("test failures exit 1 with location and a rerun hint", async () => {
	const dir = project({ "package.json": "{}", "bad.test.ts": 'import { test, expect } from "bun:test";\ntest("nope", () => expect(1).toBe(2));\n' });
	const r = await axi(dir, "test");
	expect(r.code).toBe(1);
	expect(r.out).toContain("bad.test.ts:2");
	expect(r.out).toContain("bun-axi test bad.test.ts -t");
});

test("unknown flags fail loud with the valid set, exit 2", async () => {
	const r = await axi(project({ "package.json": "{}" }), "test", "--bogus");
	expect(r.code).toBe(2);
	expect(r.out).toContain("--test-name-pattern");
});

test("run summarizes a passing script and rejects unknown scripts", async () => {
	const dir = project({ "package.json": JSON.stringify({ scripts: { hello: "echo hi" } }) });
	const ok = await axi(dir, "run", "hello");
	expect(ok.code).toBe(0);
	expect(ok.out).toContain("output: hi");
	const missing = await axi(dir, "run", "nope");
	expect(missing.code).toBe(2);
	expect(missing.out).toContain("Scripts here: hello");
});

test("home without package.json says so", async () => {
	const r = await axi(project({}));
	expect(r.out).toContain("project: \"none: no package.json");
});
