import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runAxiCli, AxiError, installSessionStartHooks, sessionStartHookStatus, uninstallSessionStartHooks } from "axi-sdk-js";
import { VERSION } from "./version.ts";
import { parseFlags, usage } from "./flags.ts";
import { capture, logDir, oneLine, preview, seconds, shortPath } from "./proc.ts";
import { consoleSummary, parseJunit } from "./tests.ts";
import { diagnostics, summarize } from "./diagnostics.ts";
import * as packages from "./packages.ts";

const DESCRIPTION = "Bun for agents: test and script results as counts and failures, dependency lookups";

const HELP: Record<string, string> = {
	test: [
		"usage: bun-axi test [paths...] [flags]",
		"Runs bun test and reports counts, each failure's location and message, and load errors.",
		"flags:",
		"  -t, --test-name-pattern <regex>  only tests whose name matches",
		"  --bail                           stop after the first failure",
		"  --timeout <ms>                   per-test timeout",
		"  -u, --update-snapshots           rewrite snapshots",
		"  --full                           complete failure messages instead of one-line previews",
		"examples:",
		"  bun-axi test",
		"  bun-axi test src/parser.test.ts -t \"handles empty input\"",
	].join("\n"),
	run: [
		"usage: bun-axi run <script> [--cwd <dir>] [--full] [-- script args]",
		"Runs a package.json script and reports its result: tsc/oxlint/eslint diagnostics grouped by file,",
		"bun test counts, or a tail preview of the output. The full output is always saved to a log file.",
		"examples:",
		"  bun-axi run check",
		"  bun-axi run typecheck --cwd packages/web",
		"  bun-axi run build -- --minify",
	].join("\n"),
	outdated: "usage: bun-axi outdated [--filter <workspace>]...\nDependencies behind their latest version, flagging major gaps.\nexample: bun-axi outdated --filter web",
	why: "usage: bun-axi why <package>\nInstalled versions of a package and what requires each.\nexample: bun-axi why typescript",
	view: "usage: bun-axi view <package>[@version|@tag]\nRegistry summary: version, license, dependency counts, weekly downloads, repository.\nexamples:\n  bun-axi view zod\n  bun-axi view react@canary",
	versions: "usage: bun-axi versions <package> [--limit <n>] [--all]\nPublished versions, newest first, with dist-tags and deprecations (default limit 15).\nUntagged prereleases are hidden unless --all.\nexample: bun-axi versions typescript --limit 5",
	deps: "usage: bun-axi deps <package>[@version]\nDeclared dependencies, peer and optional dependencies of one release.\nexample: bun-axi deps hono",
	search: "usage: bun-axi search <words...> [--limit <n>]\nRegistry search (default limit 10).\nexample: bun-axi search toon format",
	setup: "usage: bun-axi setup hooks [--check] [--uninstall] [--project]\nInstall a SessionStart hook for Claude Code, Codex and OpenCode that shows this project's bun-axi home view.",
};

const TOP_LEVEL_HELP = [
	"usage: bun-axi [command] [args] [flags]",
	"commands:",
	"  (none)    project scripts, workspaces and lockfile",
	"  test      run tests: counts, failures, load errors",
	"  run       run a package.json script: diagnostics or output preview",
	"  outdated  dependencies behind latest",
	"  why       why a package is installed",
	"  view      registry summary of a package",
	"  versions  published versions of a package",
	"  deps      dependencies of a package release",
	"  search    search the registry",
	"  setup     session hooks",
	"Run `bun-axi <command> --help` for flags and examples.",
].join("\n");

function manifest(cwd: string): any | undefined {
	const path = join(cwd, "package.json");
	if (!existsSync(path)) return undefined;
	try { return JSON.parse(readFileSync(path, "utf8")); }
	catch (error) { throw new AxiError("package.json is not valid JSON: " + (error as Error).message, "INVALID_MANIFEST"); }
}

function home() {
	const cwd = process.cwd();
	const pkg = manifest(cwd);
	if (!pkg) return { project: "none: no package.json in " + shortPath(cwd), help: ["Run `bun-axi view <package>` or `bun-axi search <words>` for registry lookups"] };
	const scripts = Object.entries(pkg.scripts ?? {}).map(([name, command]) => ({ name, command: oneLine(String(command), 70) }));
	const lockfile = ["bun.lock", "bun.lockb", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"].find(f => existsSync(join(cwd, f))) ?? "none";
	const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages ?? [];
	const count = (r?: object) => Object.keys(r ?? {}).length;
	return {
		project: {
			name: pkg.name ?? "(unnamed)",
			bun: Bun.version,
			lockfile,
			dependencies: count(pkg.dependencies) + " prod, " + count(pkg.devDependencies) + " dev",
			...(workspaces.length ? { workspaces: workspaces.join(" ") } : {}),
		},
		scripts: scripts.length ? scripts : "0 scripts in package.json",
		help: [
			"Run `bun-axi test` for test results",
			...(scripts.length ? ["Run `bun-axi run <script>` to run one with a summarized result"] : []),
			"Run `bun-axi outdated` for dependencies behind latest",
		],
	};
}

async function test(args: string[]) {
	const { values, positionals } = parseFlags("test", args, {
		"test-name-pattern": { type: "string", short: "t" }, bail: { type: "boolean" }, timeout: { type: "string" },
		"update-snapshots": { type: "boolean", short: "u" }, full: { type: "boolean" },
	});
	const cwd = process.cwd();
	const junit = join(logDir(cwd), "test-junit.xml");
	rmSync(junit, { force: true });
	const cmd = ["bun", "test", "--reporter=junit", "--reporter-outfile=" + junit];
	if (values["test-name-pattern"]) cmd.push("-t", values["test-name-pattern"]);
	if (values.bail) cmd.push("--bail");
	if (values.timeout) cmd.push("--timeout", values.timeout);
	if (values["update-snapshots"]) cmd.push("--update-snapshots");
	const run = await capture([...cmd, ...positionals], cwd, "test");
	const time = seconds(run.ms);
	if (/No tests found/i.test(run.output)) {
		return { tests: "0 found" + (positionals.length || values["test-name-pattern"] ? " matching the given paths/pattern" : " (bun looks for *.test.*, *_test.*, *.spec.*, *_spec.*)"), log: shortPath(run.log) };
	}
	if (!existsSync(junit)) {
		return { tests: "bun test exited " + run.code + " without a report", output: preview(run.output, 1500, true), log: shortPath(run.log) };
	}
	const r = parseJunit(readFileSync(junit, "utf8"), run.output);
	const files = r.files + r.loadErrors.filter(e => e.file).length;
	const across = " (" + time + ") across " + plural(files, "file");
	if (!r.failed && !r.loadErrors.length && run.code === 0) {
		return { tests: "all " + r.passed + " passed" + (r.skipped ? ", " + r.skipped + " skipped" : "") + across };
	}
	const limit = values.full ? Infinity : 240;
	const out: Record<string, unknown> = {
		tests: [r.failed && r.failed + " failed", r.passed + " passed", r.skipped && r.skipped + " skipped", r.loadErrors.length && plural(r.loadErrors.length, "file") + " failed to load"].filter(Boolean).join(", ") + across,
	};
	if (r.failures.length) out.failures = r.failures.slice(0, 30).map(f => ({ at: f.at ?? f.file + ":" + f.line, test: f.test, message: values.full ? f.message.trim() : oneLine(f.message, limit) }));
	if (r.loadErrors.length) out.loadErrors = r.loadErrors.map(e => ({ file: e.file, message: oneLine(e.message, limit) }));
	if (!r.failed && !r.loadErrors.length) out.output = preview(run.output, 1500, true);
	out.log = shortPath(run.log);
	const first = r.failures[0];
	out.help = [
		...(first ? ["Run `bun-axi test " + first.file + " -t " + JSON.stringify(escapeRegex(first.test.split(" > ").pop()!)) + "` to rerun the first failure"] : []),
		...(r.failures.length > 30 ? ["Showing 30 of " + r.failures.length + " failures; the log has all of them"] : []),
		...(!values.full && r.failures.some(f => f.message.length > limit) ? ["Run with --full for complete failure messages"] : []),
	];
	if (!(out.help as string[]).length) delete out.help;
	process.exitCode = 1;
	return out;
}
function escapeRegex(text: string): string { return text.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&"); }
function plural(n: number, word: string): string { return n + " " + word + (n === 1 ? "" : "s"); }

async function run(args: string[]) {
	const { values, positionals } = parseFlags("run", args, { cwd: { type: "string" }, full: { type: "boolean" } });
	const [script, ...rest] = positionals;
	const cwd = values.cwd ?? process.cwd();
	const pkg = manifest(cwd);
	if (!pkg) usage("no package.json in " + shortPath(cwd), "Pass --cwd <dir> for a workspace package");
	if (!script) usage("run needs a script name", "Scripts here: " + (Object.keys(pkg.scripts ?? {}).join(", ") || "none"));
	if (!pkg.scripts?.[script]) usage("no script " + JSON.stringify(script) + " in " + shortPath(join(cwd, "package.json")), "Scripts here: " + (Object.keys(pkg.scripts ?? {}).join(", ") || "none"));
	const result = await capture(["bun", "run", script, ...rest], cwd, "run-" + script.replace(/[^\w.-]/g, "_"));
	// bun run echoes each script command as "$ cmd" on stderr; the log keeps them, previews don't.
	const shown = result.output.split("\n").filter(line => !line.startsWith("$ ")).join("\n");
	const out: Record<string, unknown> = {
		script, command: oneLine(pkg.scripts[script], 160),
		result: (result.code === 0 ? "ok" : "failed (exit " + result.code + ")") + " in " + seconds(result.ms),
	};
	const found = diagnostics(result.output);
	if (found.length) Object.assign(out, summarize(found, values.full ? found.length : 15));
	const tests = consoleSummary(result.output);
	if (tests) out.tests = tests.pass + " passed, " + tests.fail + " failed, " + tests.skip + " skipped" + (tests.error ? ", " + tests.error + " errors" : "");
	const lines = shown.trim() ? shown.trimEnd().split("\n").length : 0;
	if (values.full) out.output = result.output.trim() || "(no output)";
	else if (result.code !== 0 && !found.length) out.output = preview(shown, 1500, true) || "(no output)";
	else out.output = shown.trim().length <= 400 ? shown.trim() || "(no output)" : plural(lines, "line");
	out.log = shortPath(result.log);
	if (result.code !== 0) {
		out.help = [
			...(tests?.fail || tests?.error ? ["Run `bun-axi test` for each failing test"] : []),
			...(found.length > 15 && !values.full ? ["Run `bun-axi run " + script + " --full` for every diagnostic"] : []),
		];
		if (!(out.help as string[]).length) delete out.help;
		process.exitCode = 1;
	}
	return out;
}

async function setup(args: string[]) {
	const { values, positionals } = parseFlags("setup", args, { check: { type: "boolean" }, uninstall: { type: "boolean" }, project: { type: "boolean" } });
	if (positionals[0] !== "hooks") usage("unknown setup target " + JSON.stringify(positionals[0] ?? ""), "Run `bun-axi setup hooks`");
	const scope = values.project ? { scope: "project" as const, projectDir: process.cwd() } : {};
	if (values.check) return { hooks: sessionStartHookStatus({ marker: "bun-axi", ...scope }) as any };
	if (values.uninstall) { uninstallSessionStartHooks({ marker: "bun-axi", ...scope }); return { hooks: "removed bun-axi SessionStart hooks" }; }
	installSessionStartHooks({ marker: "bun-axi", binaryNames: ["bun-axi"], ...scope });
	return { hooks: "installed bun-axi SessionStart hooks (no-op when already current)", help: ["Run `bun-axi setup hooks --check` to verify"] };
}

function needs(command: string, args: string[]): string {
	if (!args[0]) usage(command + " needs a package name", "Run `bun-axi " + command + " --help`");
	return args[0];
}

export async function main(argv: string[]) {
	await runAxiCli({
		description: DESCRIPTION,
		version: VERSION,
		argv,
		topLevelHelp: TOP_LEVEL_HELP,
		getCommandHelp: command => HELP[command],
		home,
		commands: {
			test,
			run,
			setup,
			outdated: async args => { const { values } = parseFlags("outdated", args, { filter: { type: "string", multiple: true } }); return packages.outdated(process.cwd(), (values.filter ?? []).flatMap(f => ["--filter", f])); },
			why: async args => { const { positionals } = parseFlags("why", args, {}); return packages.why(process.cwd(), needs("why", positionals)); },
			view: async args => { const { positionals } = parseFlags("view", args, {}); return packages.view(needs("view", positionals)); },
			versions: async args => { const { values, positionals } = parseFlags("versions", args, { limit: { type: "string" }, all: { type: "boolean" } }); return packages.versions(needs("versions", positionals), Number(values.limit ?? 15), values.all); },
			deps: async args => { const { positionals } = parseFlags("deps", args, {}); return packages.deps(needs("deps", positionals)); },
			search: async args => { const { values, positionals } = parseFlags("search", args, { limit: { type: "string" } }); if (!positionals.length) usage("search needs words", "Run `bun-axi search <words...>`"); return packages.search(positionals.join(" "), Number(values.limit ?? 10)); },
		},
	});
}
