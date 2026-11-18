// Photo fixtures for the seeded editorial baseline (plan Step 3).
// Downloads 14 deterministic photos from picsum.photos (fixed seeds), derives
// 480/960/1600 WebP variants (quality 0.82) via sharp, and uploads each
// through the LOCAL admin media API (`POST /admin/api/media`) with the dev
// bypass — the same contract as the browser pipeline (`fileToVariants` +
// `uploadMediaService`): multipart `meta` JSON + `<w>.webp` parts, `Origin`
// matching local SITE_URL. Writes `scripts/.seed-media-map.json`
// (`seed → mediaId`, gitignored) for the Step 4 seed rewrite.
//
// Fallback (plan contingency): any download failing twice is replaced by a
// warm-gray gradient fixture of identical dimensions, logged to stdout.
// NEVER violet, NEVER empty ground.
//
// Usage: `pnpm exec tsx scripts/seed-photo-media.ts`
// Requires: local dev server (`pnpm dev`, default :4321) with
// `ADMIN_DEV_BYPASS=1` + `ADMIN_EMAILS` in `.dev.vars` (local-only,
// gitignored). Nothing touches production (no `--remote`, no dashboard vars).

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const SEEDS = Array.from(
	{ length: 14 },
	(_, i) => `gurat-${String(i + 1).padStart(2, "0")}`,
);
const SOURCE_W = 1600;
const SOURCE_H = 1000;
const WIDTHS = [480, 960, 1600];
const QUALITY = 82; // sharp 1–100 scale (= 0.82 in the browser `fileToVariants` contract)
const PORTS = [4321, 4322];

// sharp is a transitive dep (via wrangler/vite tooling), not a direct one —
// resolve from the pnpm store layout at runtime so no package.json change is
// needed for this seed-only script.
function loadSharp(): SharpLib {
	try {
		return createRequire(import.meta.url)("sharp");
	} catch {
		// fall through to pnpm-store scan
	}
	const { readdirSync, existsSync } = require("node:fs");
	const store = new URL("../node_modules/.pnpm/", import.meta.url);
	for (const entry of readdirSync(store)) {
		if (!entry.startsWith("sharp@")) continue;
		const candidate = new URL(`${entry}/node_modules/sharp/`, store);
		try {
			if (existsSync(candidate))
				return createRequire(import.meta.url)(candidate.href);
		} catch {
			// keep scanning
		}
	}
	throw new Error(
		"sharp not found (expected as transitive dep under node_modules/.pnpm/sharp@*)",
	);
}

interface SharpInstance {
	resize(w: number, h: number, opts?: Record<string, unknown>): SharpInstance;
	jpeg(opts?: Record<string, unknown>): SharpInstance;
	webp(opts?: Record<string, unknown>): SharpInstance;
	raw(): SharpInstance;
	toBuffer(): Promise<Buffer>;
	toBuffer(
		opts: Record<string, unknown>,
	): Promise<{ data: Buffer; info: Record<string, unknown> }>;
}

type SharpLib = (
	input: Uint8Array | Buffer | { create: Record<string, unknown> },
) => SharpInstance;

async function fetchWithRetry(
	url: string,
	attempts = 3,
): Promise<Uint8Array | null> {
	let last: unknown = null;
	for (let i = 0; i < attempts; i++) {
		try {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return new Uint8Array(await res.arrayBuffer());
		} catch (err) {
			last = err;
		}
	}
	console.log(
		`  download failed after ${attempts} tries (${String(last).slice(0, 100)}); using gradient fallback`,
	);
	return null;
}

// Warm-gray vertical gradient (identical dimensions), encoded via sharp.
async function gradientFallback(
	sharp: SharpLib,
): Promise<{ bytes: Uint8Array; mime: string }> {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SOURCE_W}" height="${SOURCE_H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfc8bb"/><stop offset="1" stop-color="#8f887b"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
	const bytes = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
	return { bytes: new Uint8Array(bytes), mime: "image/jpeg" };
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

async function serverBase(): Promise<string> {
	for (const port of PORTS) {
		for (const host of ["localhost", "127.0.0.1"]) {
			try {
				const res = await fetch(`http://${host}:${port}/`);
				if (res.status < 500) return `http://${host}:${port}`;
			} catch {
				// try next host/port
			}
		}
	}
	throw new Error(
		`no local dev server on ports ${PORTS.join("/")} — run \`pnpm dev\` first`,
	);
}

const sharp = loadSharp();
const base = await serverBase();
console.log(`local server: ${base}`);
const siteUrl = base.replace("127.0.0.1", "localhost");

const map: Record<string, string> = {};
for (const seed of SEEDS) {
	const url = `https://picsum.photos/seed/${seed}/${SOURCE_W}/${SOURCE_H}`;
	console.log(`${seed}: downloading ${url}`);
	let source = await fetchWithRetry(url);
	let sourceMime = "image/jpeg";
	let fallback = false;
	if (source === null) {
		({ bytes: source, mime: sourceMime } = await gradientFallback(sharp));
		fallback = true;
	}
	const dominant = await dominantColor(sharp, source);
	const form = new FormData();
	form.set(
		"meta",
		JSON.stringify({
			sourceWidth: SOURCE_W,
			sourceHeight: SOURCE_H,
			sourceBytes: source.length,
			sourceMime,
			altDefault: `Seed photo ${seed}`,
			dominantColor: dominant,
		}),
	);
	for (const w of WIDTHS) {
		const h = Math.round((w * SOURCE_H) / SOURCE_W);
		const variant = await sharp(source)
			.resize(w, h)
			.webp({ quality: QUALITY })
			.toBuffer();
		form.append(
			`${w}.webp`,
			new File([new Uint8Array(variant)], `${w}.webp`, { type: "image/webp" }),
		);
	}
	const res = await fetch(`${base}/admin/api/media`, {
		method: "POST",
		headers: { Origin: siteUrl },
		body: form,
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(
			`${seed}: upload failed HTTP ${res.status} ${body.slice(0, 200)}`,
		);
	}
	const json = (await res.json()) as { media?: { id?: string } };
	const id = json.media?.id;
	if (typeof id !== "string" || id === "")
		throw new Error(`${seed}: upload returned no media id`);
	map[seed] = id;
	console.log(
		`${seed}: uploaded as ${id} (dominant ${dominant})${fallback ? " [GRADIENT FALLBACK]" : ""}`,
	);
}

const outPath = new URL("./.seed-media-map.json", import.meta.url);
writeFileSync(outPath, `${JSON.stringify(map, null, 2)}\n`);
console.log(`wrote ${outPath.pathname} (${Object.keys(map).length} entries)`);
