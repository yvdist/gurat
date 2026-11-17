import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Lists media rows unreferenced for > 7 days (spec 05 §5.2). Read-only: no
// writes, exit 0 always. Same pinned-wrangler dump pattern as rerender.ts.
const require = createRequire(import.meta.url);
const wranglerBin = join(
	dirname(require.resolve("wrangler/package.json")),
	"bin",
	"wrangler.js",
);

function runWrangler(args: string[]): string {
	const out = execFileSync(process.execPath, [wranglerBin, ...args], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		stdio: "pipe",
	});
	return (out as string | undefined) ?? "";
}

interface MediaRow {
	id: string;
	bytes: number;
	created_at: number;
}

interface LinkRow {
	media_id: string;
}

function dump<T>(command: string): T[] {
	const out = runWrangler([
		"d1",
		"execute",
		"gurat",
		"--local",
		"--json",
		"--command",
		command,
	]);
	const parsed: unknown = JSON.parse(out);
	const batches = (Array.isArray(parsed) ? parsed : [parsed]) as (
		| { results?: T[] }
		| { results: T[] }[]
	)[];
	const rows: T[] = [];
	for (const batch of batches) {
		const results = Array.isArray(batch)
			? (batch[0] as { results?: T[] } | undefined)?.results
			: (batch as { results?: T[] }).results;
		if (results !== undefined) rows.push(...results);
	}
	return rows;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const cutoff = Date.now() - 7 * DAY_MS;

const items = dump<MediaRow>("SELECT id, bytes, created_at FROM media");
const links = dump<LinkRow>("SELECT media_id FROM post_media");
const referenced = new Set(links.map((l) => l.media_id));

let orphans = 0;
for (const item of items) {
	if (referenced.has(item.id) || item.created_at >= cutoff) continue;
	orphans += 1;
	const ageDays = Math.floor((Date.now() - item.created_at) / DAY_MS);
	console.log(`${item.id} ageDays=${ageDays} bytes=${item.bytes}`);
}

console.log(`ORPHANS ${orphans}`);
