import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseJunit, consoleSummary } from "../src/tests.ts";
import { diagnostics } from "../src/diagnostics.ts";

const fixture = (name: string) => readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");

test("junit failures carry describe path, location and first message line; load errors come from the console", () => {
	const r = parseJunit(fixture("junit.xml"), fixture("console.txt"));
	expect({ passed: r.passed, failed: r.failed, skipped: r.skipped, files: r.files }).toEqual({ passed: 1, failed: 2, skipped: 1, files: 1 });
	expect(r.failures.map(f => [f.at, f.test])).toEqual([["a.test.ts:4:39", "math > fails"], ["a.test.ts:7:46", "throws"]]);
	expect(r.failures[0].message).toContain("Expected: 3");
	expect(r.loadErrors).toEqual([{ file: "b.test.ts", message: "Cannot find module './missing' from '/private/tmp/bjt/b.test.ts'" }]);
});

test("console summary counts bun test runs nested in other scripts", () => {
	expect(consoleSummary(fixture("console.txt"))).toEqual({ pass: 1, fail: 3, skip: 1, error: 1 });
	expect(consoleSummary("no tests here")).toBeUndefined();
});

test("diagnostics from tsc, oxlint unix and oxlint pretty output", () => {
	const at = (text: string) => diagnostics(text).map(d => [d.file + ":" + d.line + ":" + d.col, d.severity, d.rule]);
	expect(at(fixture("tsc.txt"))).toEqual([["a.ts:1:7", "error", "TS2322"], ["src/b.ts:4:2", "error", "TS7006"]]);
	expect(at(fixture("oxlint-unix.txt"))).toEqual([["a.ts:1:7", "warning", "eslint(no-unused-vars)"], ["src/plumbing.ts:437:1", "error", "eslint(complexity)"]]);
	expect(at(fixture("oxlint-pretty.txt"))).toEqual([["a.ts:3:5", "warning", "eslint(no-unused-vars)"], ["b.ts:9:1", "error", "eslint(no-debugger)"]]);
	expect(diagnostics("see https://example.com:443:1 for details\nplain log line")).toEqual([]);
});
