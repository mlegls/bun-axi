---
name: bun-axi
description: Use in Bun projects to run tests or package.json scripts and read their results as counts, failures and diagnostics, or to look up dependencies and npm packages.
---

Use `bunx bun-axi` (or `bun-axi` when installed) instead of piping `bun test` / `bun run` output through tail or grep. Full output is always kept in the log path it prints.

- `bun-axi`: project scripts, workspaces, lockfile
- `bun-axi test [paths] [-t pattern]`: counts, failure locations and messages, files that failed to load
- `bun-axi run <script>`: result, tsc/oxlint/eslint diagnostics by file, nested test counts
- `bun-axi outdated`, `bun-axi why <package>`: dependency state
- `bun-axi view|versions|deps <package>`, `bun-axi search <words>`: npm registry

Each command takes `--help`.
