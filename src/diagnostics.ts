// Compiler and linter diagnostics recognized in arbitrary script output.

export interface Diagnostic { file: string; line: number; col: number; severity: "error" | "warning"; rule: string; message: string }

const TSC = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/;
const TSC_PRETTY = /^(.+?):(\d+):(\d+) - (error|warning) (TS\d+): (.*)$/;
// eslint/oxlint unix and compact formats: "file:line:col: [error] message [rule]"
const UNIX = /^([^\s:][^:]*\.[\w]+):(\d+):(\d+):\s+(?:(error|warning)\s+)?(.*?)(?:\s+\[([\w/@-]+(?:\([\w-]+\))?)\])?$/;
// oxlint/biome "pretty": a severity line, then a ╭─[file:line:col] frame a few lines later.
const PRETTY_HEAD = /^\s*([×x!⚠])\s+([\w/@-]+(?:\([\w/-]+\))?):?\s*(.*)$/;
const PRETTY_FRAME = /╭─\[(.+?):(\d+):(\d+)\]/;

export function diagnostics(output: string): Diagnostic[] {
	const out: Diagnostic[] = [];
	const lines = output.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const tsc = TSC.exec(line) ?? TSC_PRETTY.exec(line);
		if (tsc) { out.push({ file: tsc[1], line: +tsc[2], col: +tsc[3], severity: tsc[4] as "error", rule: tsc[5], message: tsc[6] }); continue; }
		const head = PRETTY_HEAD.exec(line);
		if (head) {
			for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
				const frame = PRETTY_FRAME.exec(lines[j]);
				if (!frame) continue;
				out.push({ file: frame[1], line: +frame[2], col: +frame[3], severity: head[1] === "!" || head[1] === "⚠" ? "warning" : "error", rule: head[2], message: head[3] });
				break;
			}
			continue;
		}
		const unix = UNIX.exec(line);
		if (unix && !/^https?$/.test(unix[1])) {
			let [, file, l, c, severity, message, rule] = unix;
			const inline = /^(?:(error|warning)\s+)?([\w/@-]+\([\w/-]+\)):\s*(.*)$/.exec(message);
			if (inline) { severity = inline[1] ?? severity; rule = inline[2]; message = inline[3]; }
			if (!severity && !rule) continue;
			out.push({ file, line: +l, col: +c, severity: severity === "warning" ? "warning" : "error", rule: rule ?? "", message });
		}
	}
	return out;
}

export function summarize(list: Diagnostic[], limit: number) {
	const byFile = new Map<string, { errors: number; warnings: number }>();
	for (const d of list) {
		const f = byFile.get(d.file) ?? { errors: 0, warnings: 0 };
		d.severity === "error" ? f.errors++ : f.warnings++;
		byFile.set(d.file, f);
	}
	const errors = list.filter(d => d.severity === "error").length;
	return {
		diagnostics: errors + " errors, " + (list.length - errors) + " warnings in " + byFile.size + " files",
		files: [...byFile].sort((a, b) => b[1].errors - a[1].errors || b[1].warnings - a[1].warnings).slice(0, 20).map(([file, c]) => ({ file, ...c })),
		first: list.slice(0, limit).map(d => ({ at: d.file + ":" + d.line + ":" + d.col, rule: d.rule, message: d.message })),
	};
}
