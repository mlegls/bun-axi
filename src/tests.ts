// Bun test results from its JUnit report, plus what the report leaves out:
// errors raised while loading a file ("Unhandled error between tests").

export interface Failure { file: string; line: number; test: string; message: string; at?: string }
export interface TestResults {
	passed: number; failed: number; skipped: number; files: number; failures: Failure[];
	loadErrors: { file: string; message: string }[];
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
function decode(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
		e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : entities[e] ?? m);
}
function attrs(tag: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of tag.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = decode(m[2]);
	return out;
}

export function parseJunit(xml: string, console = ""): TestResults {
	const results: TestResults = { passed: 0, failed: 0, skipped: 0, files: 0, failures: [], loadErrors: [] };
	// Nested describe blocks are nested <testsuite>s; keep a stack of their names for test titles.
	const stack: string[] = [];
	const files = new Set<string>();
	const token = /<testsuite\b([^>]*)>|<\/testsuite>|<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
	for (const m of xml.matchAll(token)) {
		if (m[1] !== undefined) { const a = attrs(m[1]); stack.push(a.line ? a.name : ""); if (a.file) files.add(a.file); continue; }
		if (m[0] === "</testsuite>") { stack.pop(); continue; }
		const a = attrs(m[2]);
		const body = m[4] ?? "";
		if (/<skipped\b/.test(body)) { results.skipped++; continue; }
		const failure = /<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>|<(failure|error)\b([^>]*)\/>/.exec(body);
		if (!failure) { results.passed++; continue; }
		results.failed++;
		const fa = attrs(failure[2] ?? failure[5] ?? "");
		const text = decode(failure[3] ?? "");
		const at = new RegExp("at (?:.*\\()?(\\S*" + escape(a.file ?? "") + ":\\d+:\\d+)").exec(text)?.[1];
		results.failures.push({
			file: a.file ?? "", line: Number(a.line ?? 0),
			test: [...stack.filter(Boolean), a.name].join(" > "),
			message: fa.message || text.split("\n")[0] || fa.type || "failed",
			at: at?.replace(/^.*\//, ""),
		});
	}
	results.files = files.size;
	results.loadErrors = loadErrors(console);
	return results;
}

function escape(text: string): string { return text.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&"); }

/** Bun prints the file header, then the error block, for failures outside any test. */
export function loadErrors(console: string): { file: string; message: string }[] {
	const out: { file: string; message: string }[] = [];
	const lines = console.split("\n");
	let file = "";
	for (let i = 0; i < lines.length; i++) {
		const header = /^(\S.*\.(?:test|spec|_test|_spec)\.[cm]?[jt]sx?):$/.exec(lines[i]);
		if (header) { file = header[1]; continue; }
		if (/^# Unhandled error between tests/.test(lines[i])) {
			const block: string[] = [];
			for (i += 2; i < lines.length && !/^-{5,}$/.test(lines[i]); i++) block.push(lines[i]);
			const message = block.find(l => /^(error|\w*Error)\b/.test(l.trim())) ?? block.find(l => l.trim()) ?? "unhandled error";
			out.push({ file, message: message.trim().replace(/^error: /, "") });
		}
	}
	return out;
}

/** Summary lines of bun test's console reporter, for when tests run inside another script. */
export function consoleSummary(text: string): { pass: number; fail: number; skip: number; error: number } | undefined {
	const count = (word: string) => { const m = new RegExp("^\\s*(\\d+) " + word + "$", "m").exec(text); return m ? Number(m[1]) : 0; };
	if (!/^Ran \d+ tests? across \d+ files?/m.test(text)) return undefined;
	return { pass: count("pass"), fail: count("fail"), skip: count("skip"), error: count("errors?") };
}
