import { AxiError } from "axi-sdk-js";
import { capture } from "./proc.ts";

const REGISTRY = process.env.NPM_CONFIG_REGISTRY?.replace(/\/$/, "") ?? "https://registry.npmjs.org";

async function json(url: string): Promise<any> {
	let response: Response;
	try { response = await fetch(url, { headers: { accept: "application/json" } }); }
	catch (error) { throw new AxiError("registry unreachable: " + (error instanceof Error ? error.message : String(error)), "NETWORK_ERROR"); }
	if (response.status === 404) return undefined;
	if (!response.ok) throw new AxiError("registry returned HTTP " + response.status + " for " + url, "REGISTRY_ERROR");
	return response.json();
}

/** "name", "@scope/name", "name@1.2.3", "@scope/name@^1". */
export function splitSpec(spec: string): { name: string; version?: string } {
	const at = spec.lastIndexOf("@");
	return at > 0 ? { name: spec.slice(0, at), version: spec.slice(at + 1) } : { name: spec };
}

async function packument(name: string) {
	const doc = await json(REGISTRY + "/" + name.replace("/", "%2F"));
	if (!doc) throw new AxiError("package " + name + " not found on the registry", "NOT_FOUND", ["Check the spelling, or search: `bun-axi search <words>`"]);
	return doc;
}

function pick(doc: any, version?: string): any {
	const v = version ? doc["dist-tags"]?.[version] ?? version : doc["dist-tags"]?.latest;
	const manifest = doc.versions?.[v];
	if (!manifest) throw new AxiError("version " + version + " of " + doc.name + " not found", "NOT_FOUND", ["Run `bun-axi versions " + doc.name + "` to list published versions"]);
	return manifest;
}

export async function view(spec: string) {
	const { name, version } = splitSpec(spec);
	const [doc, downloads] = await Promise.all([packument(name), json("https://api.npmjs.org/downloads/point/last-week/" + name).catch(() => undefined)]);
	const m = pick(doc, version);
	const repo = typeof m.repository === "string" ? m.repository : m.repository?.url;
	return {
		package: {
			name: m.name, version: m.version, latest: doc["dist-tags"]?.latest,
			description: m.description ?? "",
			license: typeof m.license === "string" ? m.license : m.license?.type ?? "none",
			published: doc.time?.[m.version]?.slice(0, 10),
			dependencies: Object.keys(m.dependencies ?? {}).length,
			peerDependencies: Object.keys(m.peerDependencies ?? {}).length,
			weeklyDownloads: downloads?.downloads ?? "unknown",
			types: m.types || m.typings ? "bundled" : "none bundled",
			repository: repo?.replace(/^git\+/, "").replace(/\.git$/, ""),
		},
		help: ["Run `bun-axi deps " + m.name + "` for its dependencies", "Run `bun-axi versions " + m.name + "` for release history"],
	};
}

export async function versions(name: string, limit: number, prereleases = false) {
	const doc = await packument(name);
	const tags = new Map<string, string[]>();
	for (const [tag, v] of Object.entries(doc["dist-tags"] ?? {})) tags.set(v as string, [...(tags.get(v as string) ?? []), tag]);
	const all = Object.keys(doc.versions ?? {}).map(v => ({ version: v, published: doc.time?.[v]?.slice(0, 10) ?? "", tags: (tags.get(v) ?? []).join(" "), deprecated: doc.versions[v].deprecated ? "yes" : "" }))
		.sort((a, b) => b.published.localeCompare(a.published));
	const hidden = prereleases ? 0 : all.filter(v => v.version.includes("-") && !v.tags).length;
	const shown = prereleases ? all : all.filter(v => !v.version.includes("-") || v.tags);
	return {
		count: Math.min(limit, shown.length) + " of " + shown.length + (hidden ? " (" + hidden + " untagged prereleases hidden; --all shows them)" : " total"),
		versions: shown.slice(0, limit),
		...(shown.length > limit ? { help: ["Run `bun-axi versions " + name + " --limit " + shown.length + (prereleases ? " --all" : "") + "` for all"] } : {}),
	};
}

export async function deps(spec: string) {
	const { name, version } = splitSpec(spec);
	const m = pick(await packument(name), version);
	const rows = (kind: string, record?: Record<string, string>) => Object.entries(record ?? {}).map(([dep, range]) => ({ dep, range, kind }));
	const list = [...rows("prod", m.dependencies), ...rows("peer", m.peerDependencies), ...rows("optional", m.optionalDependencies)];
	return list.length
		? { package: m.name + "@" + m.version, count: list.length, dependencies: list }
		: { package: m.name + "@" + m.version, dependencies: "0 dependencies" };
}

export async function search(words: string, limit: number) {
	const doc = await json(REGISTRY + "/-/v1/search?size=" + limit + "&text=" + encodeURIComponent(words));
	const objects: any[] = doc?.objects ?? [];
	if (!objects.length) return { packages: "0 packages match " + JSON.stringify(words) };
	return {
		count: objects.length + " of " + doc.total + " matches",
		packages: objects.map(o => ({ name: o.package.name, version: o.package.version, description: (o.package.description ?? "").slice(0, 100), weeklyDownloads: o.downloads?.weekly ?? "" })),
		help: ["Run `bun-axi view <name>` for details"],
	};
}

/** bun outdated prints a box table; rows are "| name [(dev)] | current | update | latest |". */
export async function outdated(cwd: string, filters: string[]) {
	const run = await capture(["bun", "outdated", ...filters], cwd, "outdated");
	if (run.code !== 0) throw new AxiError("bun outdated failed: " + run.output.trim().split("\n").pop(), "COMMAND_FAILED", ["Full output: " + run.log]);
	const rows = [...run.output.matchAll(/^\|[ \t]*(\S+)(?: \((dev|peer|optional)\))?[ \t]*\|[ \t]*(\S+)[ \t]*\|[ \t]*(\S+)[ \t]*\|[ \t]*(\S+)[ \t]*\|(?:[ \t]*(\S+)[ \t]*\|)?$/gm)]
		.filter(m => m[1] !== "Package" && !m[1].startsWith("-"))
		.map(m => ({ package: m[1], kind: m[2] ?? "prod", current: m[3], update: m[4], latest: m[5], major: major(m[5]) > major(m[3]) ? "yes" : "", ...(m[6] ? { workspace: m[6] } : {}) }));
	if (!rows.length) return { outdated: "0 packages outdated: everything matches its latest version" };
	return {
		count: rows.length + " outdated (" + rows.filter(r => r.major).length + " behind a major)",
		outdated: rows,
		help: ["Run `bun update <package>` to take the in-range update", "Run `bun-axi view <package>` before a major upgrade"],
	};
}
function major(v: string): number { return Number(/^\D*(\d+)/.exec(v)?.[1] ?? 0); }

/** bun why: a version header, then dependency chains that lead to it. */
export async function why(cwd: string, name: string) {
	const run = await capture(["bun", "why", name], cwd, "why");
	const installed: { version: string; requiredBy: string }[] = [];
	for (const block of run.output.split(/\n(?=\S+@\S+\s*$)/m)) {
		const [head, ...rest] = block.split("\n");
		const v = /^(\S+)@(\S+)\s*$/.exec(head.trim());
		if (!v) continue;
		const direct = rest.filter(l => /^\s{0,3}[├└]─/.test(l)).map(l => l.replace(/^[\s├└│─]+/, "").trim());
		installed.push({ version: v[2], requiredBy: direct.join("; ") });
	}
	if (!installed.length) {
		if (/not found|no packages|0 packages/i.test(run.output) || run.code !== 0) return { package: name, installed: "0 installed versions: " + name + " is not in this project's dependency tree" };
		throw new AxiError("could not read bun why output", "PARSE_ERROR", ["Full output: " + run.log]);
	}
	return { package: name, installed };
}
