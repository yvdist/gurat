// One-shot prod media seed: 10 aesthetic photos from picsum.photos (fixed
// seeds, distinct from local fixtures) → 480/960/1600 WebP variants
// (quality 82, same as the browser pipeline) → R2 `gurat-media` +
// D1 remote `media` rows. Mirrors `uploadMediaService` row shape
// (uuid id, `media/<id>/` prefix, variantsJson, dominant color).
// Run: `pnpm exec tsx scripts/seed-remote-media.ts`
// Requires: wrangler login (remote R2 + D1). Reruns insert NEW rows
// (uuid ids) — run once; delete rows manually if repeated.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	mkdtempSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SEEDS = [
	["gurat-prod-01", "Morning desk with notebook and coffee"],
	["gurat-prod-02", "Fog over quiet hills at dawn"],
	["gurat-prod-03", "Library shelves in warm light"],
	["gurat-prod-04", "Rain on a window, city blurred"],
	["gurat-prod-05", "Empty road through fields"],
	["gurat-prod-06", "Hands holding a paperback book"],
	["gurat-prod-07", "Old typewriter on wooden table"],
	["gurat-prod-08", "Sea horizon under soft clouds"],
	["gurat-prod-09", "Plant leaves against sunlight"],
	["gurat-prod-10", "Night street with single lamp"],
] as const;
const SOURCE_W = 1600;
const SOURCE_H = 1000;
const WIDTHS = [480, 960, 1600];
const QUALITY = 82;

interface SharpInstance {
	resize(w: number, h: number, opts?: Record<string, unknown>): SharpInstance;
	webp(opts?: Record<string, unknown>): SharpInstance;
	raw(): SharpInstance;
	toBuffer(): Promise<Uint8Array>;
	toBuffer(
		opts: Record<string, unknown>,
	): Promise<{ data: Uint8Array; info: Record<string, unknown> }>;
}

type SharpLib = (
	input: Uint8Array | Buffer | { create: Record<string, unknown> },
) => SharpInstance;

function loadSharp(): SharpLib {
	const require = createRequire(`${process.cwd()}/package.json`);
	for (const spec of [
		"sharp",
		"@img/sharp-win32-x64",
		"@img/sharp-linux-x64",
	]) {
		try {
			return require(spec) as SharpLib;
		} catch {
			// next candidate
		}
	}
	throw new Error("sharp not resolvable from pnpm store");
}

// `wrangler` invoked as node directly: `pnpm exec` is a .CMD shim on Windows
// (needs a shell), and shells mangle comma args like the cache-control value.
// Resolve the real entry through the pnpm store layout (pinned 4.156.1).
function wranglerJs(): string {
	const store = join(process.cwd(), "node_modules", ".pnpm");
	for (const entry of readdirSync(store)) {
		if (!entry.startsWith("wrangler@")) continue;
		const cand = join(
			store,
			entry,
			"node_modules",
			"wrangler",
			"bin",
			"wrangler.js",
		);
		try {
			statSync(cand);
			return cand;
		} catch {
			// next candidate
		}
	}
	throw new Error("wrangler.js not found under node_modules/.pnpm");
}
const WRANGLER_JS = wranglerJs();
function wrangler(args: string[], inherit = false): void {
	execFileSync(process.execPath, [WRANGLER_JS, ...args], {
		stdio: inherit ? "inherit" : "pipe",
	});
}

async function sleep(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

async function fetchWithRetry(
	url: string,
	attempts = 3,
): Promise<Uint8Array | null> {
	let last: unknown = null;
	for (let i = 0; i < attempts; i++) {
		try {
			const res = await fetch(url);
			if (res.ok) return new Uint8Array(await res.arrayBuffer());
			last = new Error(`HTTP ${res.status}`);
		} catch (err) {
			last = err;
		}
		await sleep(1000 * (i + 1));
	}
	console.error(`download failed (${String(last)}), skipping`);
	return null;
}

async function dominantColor(
	sharp: SharpLib,
	source: Uint8Array,
): Promise<string> {
	const { data } = await sharp(source)
		.resize(8, 8, { fit: "fill" })
		.raw()
		.toBuffer({ resolveWithObject: true });
	let r = 0;
	let g = 0;
	let b = 0;
	const n = data.length / 3;
	for (let i = 0; i < data.length; i += 3) {
		r += data[i] ?? 0;
		g += data[i + 1] ?? 0;
		b += data[i + 2] ?? 0;
	}
	const hex = (v: number) =>
		Math.round(v / n)
			.toString(16)
			.padStart(2, "0");
	return `#${hex(r)}${hex(g)}${hex(b)}`;
}

const sharp = loadSharp();
const now = Date.now();
const tmpDir = mkdtempSync(join(tmpdir(), "gurat-media-seed-"));

for (const [seed, alt] of SEEDS) {
	const url = `https://picsum.photos/seed/${seed}/${SOURCE_W}/${SOURCE_H}`;
	console.log(`${seed}: downloading ${url}`);
	const source = await fetchWithRetry(url);
	if (source === null) continue;
	const dominant = await dominantColor(sharp, source);
	const id = randomUUID();
	const variants: { w: number; key: string; bytes: number; mime: string }[] =
		[];
	for (const w of WIDTHS) {
		const h = Math.round((w * SOURCE_H) / SOURCE_W);
		const variant = (await sharp(source)
			.resize(w, h)
			.webp({ quality: QUALITY })
			.toBuffer()) as Uint8Array;
		const key = `media/${id}/${w}.webp`;
		const tmpFile = join(tmpDir, `${id}-${w}.webp`);
		writeFileSync(tmpFile, Buffer.from(variant));
		wrangler([
			"r2",
			"object",
			"put",
			`gurat-media/${key}`,
			"--file",
			tmpFile,
			"--content-type",
			"image/webp",
			"--cache-control",
			"public, max-age=31536000, immutable",
		]);
		variants.push({ w, key, bytes: variant.length, mime: "image/webp" });
	}
	const totalBytes = variants.reduce((n, v) => n + v.bytes, 0);
	const esc = (s: string): string => `'${s.replaceAll("'", "''")}'`;
	const sql =
		`INSERT INTO media (id, r2_key_prefix, mime, width, height, bytes, alt_default, dominant_color, variants_json, created_at) VALUES (` +
		[
			esc(id),
			esc(`media/${id}/`),
			esc("image/webp"),
			SOURCE_W,
			SOURCE_H,
			totalBytes,
			esc(alt),
			esc(dominant),
			esc(JSON.stringify(variants)),
			now,
		].join(",") +
		`);`;
	wrangler(
		["d1", "execute", "gurat", "--remote", "--command", sql, "--json"],
		true,
	);
	console.log(`${seed}: stored as ${id} (${dominant})`);
}
console.log(
	"done — verify: SELECT COUNT(*) FROM media via wrangler d1 execute --remote",
);
rmSync(tmpDir, { recursive: true, force: true });
