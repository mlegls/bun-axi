# bun-axi

Bun for agents, following the [AXI](https://axi.md) principles: test and script results as counts, failures and diagnostics instead of raw logs, plus dependency and registry lookups, all in compact [TOON](https://toonformat.dev/) output.

Agents running `bun test` or `bun run check` usually pipe the output through `tail` or `grep` to find what failed, and a tail can cut off the first failure. bun-axi runs the same commands, keeps the full output in a log file, and prints what the next step needs:

```
$ bun-axi test
tests: "2 failed, 1 passed, 1 skipped, 1 file failed to load (8ms) across 2 files"
failures[2]{at,test,message}:
  "a.test.ts:4:39",math > fails,"expect(received).toBe(expected) Expected: 3 Received: 2"
  "a.test.ts:7:46",throws,boom
loadErrors[1]{file,message}:
  b.test.ts,Cannot find module './missing' from '/tmp/p/b.test.ts'
log: /tmp/bun-axi/p-1ad579f4/test.log
help[1]: "Run `bun-axi test a.test.ts -t \"fails\"` to rerun the first failure"

$ bun-axi run typecheck
script: typecheck
command: tsc --noEmit -p .
result: failed (exit 2) in 337ms
diagnostics: "2 errors, 0 warnings in 1 files"
files[1]{file,errors,warnings}:
  a.ts,2,0
first[2]{at,rule,message}:
  "a.ts:1:7",TS2322,Type 'string' is not assignable to type 'number'.
  "a.ts:2:19",TS7006,Parameter 'y' implicitly has an 'any' type.
output: 4 lines
log: /tmp/bun-axi/p-1ad579f4/run-typecheck.log
```

## Install

```sh
bun add -g bun-axi
```

Requires Bun ≥ 1.2.

## Commands

| Command | What it does |
| --- | --- |
| `bun-axi` | project name, lockfile, workspaces, scripts |
| `bun-axi test [paths] [-t pattern] [--bail] [--full]` | runs `bun test`; counts, each failure's location and message, files that failed to load |
| `bun-axi run <script> [--cwd dir] [--full] [-- args]` | runs a package.json script; tsc/oxlint/eslint diagnostics grouped by file, nested bun test counts, or a tail preview |
| `bun-axi outdated [--filter ws]` | dependencies behind latest, flagging major gaps |
| `bun-axi why <package>` | installed versions and what requires each |
| `bun-axi view <package>[@version]` | registry summary: version, license, dependency counts, weekly downloads |
| `bun-axi versions <package> [--limit n] [--all]` | release history, newest first; untagged prereleases hidden unless `--all` |
| `bun-axi deps <package>[@version]` | declared, peer and optional dependencies of a release |
| `bun-axi search <words>` | registry search |

Every command takes `--help`. Unknown flags are rejected with the valid set (exit 2); failed tests and scripts exit 1.

## Agent integration

Either one is enough:

- **Session hook** (ambient context): `bun-axi setup hooks` installs a SessionStart hook for Claude Code, Codex and OpenCode that shows the project's home view. `--check` reports status, `--uninstall` removes it, `--project` scopes it to the current repository.
- **Skill** (on demand): `npx skills add mlegls/bun-axi --skill bun-axi`.

## Development

```sh
bun install
bun test test
bunx tsc --noEmit
```
