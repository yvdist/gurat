import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Locale } from "../src/config/site";
import { renderDoc } from "../src/lib/content/render";
import { validateDoc } from "../src/lib/content/schema";

// Re-renders every post's derived HTML from `content_json`. Needed whenever
// the renderer or the allowlist changes. Pure transform in this process
// (tsx, no DB driver): dumps rows via `wrangler d1 execute --json`, runs
// validateDoc + renderDoc with an empty media map (seed carries no figures),
// then applies UPDATEs through `wrangler d1 execute --file`.
//
// Updates content_html, toc_json, and reading_minutes only — excerpt/seo_*
// and timestamps are never touched — so re-running on unchanged
// content_json is a byte-identical no-op.

// The pinned local wrangler CLI, spawned via node directly so the script
// never depends on PATH (bare `wrangler` is not resolvable from child
// processes on all platforms).
const require = createRequire(import.meta.url);
const wranglerBin = join(
	dirname(require.resolve("wrangler/package.json")),
	"bin",
	"wrangler.js",
);

function runWrangler(args: string[], inheritStdout: boolean): string {
	const out = execFileSync(process.execPath, [wranglerBin, ...args], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		stdio: inheritStdout ? "inherit" : "pipe",
	});
	return (out as string | undefined) ?? "";
}

interface DumpRow {
	id: string;
	locale: string;
	content_json: string;
}

interface ExecuteJsonResult {
	results?: DumpRow[];
}

function quote(s: string): string {
	return `'${s.replaceAll("'", "''")}'`;
}

function isLocale(value: string): value is Locale {
	return value === "en" || value === "id";
}

function dumpRows(): DumpRow[] {
	const out = runWrangler(
		[
			"d1",
			"execute",
			"gurat",
			"--local",
			"--json",
			"--command",
			"SELECT id, locale, content_json FROM posts",
		],
		false,
	);
	const parsed: unknown = JSON.parse(out);
	const batches = (Array.isArray(parsed) ? parsed : [parsed]) as (
		| ExecuteJsonResult
		| { results: DumpRow[] }[]
	)[];
	const rows: DumpRow[] = [];
	for (const batch of batches) {
		const results = Array.isArray(batch)
			? (batch[0] as ExecuteJsonResult | undefined)?.results
			: (batch as ExecuteJsonResult).results;
		if (results !== undefined) rows.push(...results);
	}
	return rows;
}

function renderRow(row: DumpRow): {
	html: string;
	toc: string;
	minutes: number;
} {
	const locale: Locale = isLocale(row.locale) ? row.locale : "en";
	const doc = validateDoc(JSON.parse(row.content_json));
	const rendered = renderDoc(doc, { locale, media: new Map() });
	return {
		html: rendered.html,
		toc: JSON.stringify(rendered.toc),
		minutes: rendered.readingMinutes,
	};
}

const rows = dumpRows();
const updates = rows.map((row) => {
	const { html, toc, minutes } = renderRow(row);
	return `UPDATE posts SET content_html = ${quote(html)}, toc_json = ${quote(toc)}, reading_minutes = ${minutes} WHERE id = ${quote(row.id)};`;
});

const dir = mkdtempSync(join(tmpdir(), "gurat-rerender-"));
const file = join(dir, "rerender.sql");
try {
	writeFileSync(file, `${updates.join("\n")}\n`, "utf8");
	runWrangler(["d1", "execute", "gurat", "--local", "--file", file], true);
} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log(`rerendered ${updates.length} posts`);
