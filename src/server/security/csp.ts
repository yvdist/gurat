// Content-Security-Policy builders (spec 07 §7.1). Pure functions — no env
// access here; the caller resolves the media origin and passes it in.
// Any edit to the inline scripts in `src/layouts/Base.astro` changes the
// rendered bytes and therefore the hashes below: the e2e CSP-violation
// listener (`tests/e2e/hardening.spec.ts`) fails closed on drift.

// Rendered `<script type="module">` bytes, hashed with `sha256` over the
// exact served content (verified stable across rebuilds):
// [0] theme no-flash (head), [1] theme/menu/copy interactions (body),
// [2] archive filter pills (writing index pages only — harmless to allow
// globally; hash-only scripts, never 'unsafe-inline').
const PUBLIC_SCRIPT_HASHES = [
	"sha256-dSwg7v9xTCFke3R+41nP4qD5rE6ZATNcPk7sz5ezGzo=",
	"sha256-kYp0tNaRAr0Yzje5Vr4q+iHQYhOGNra4PMDuOTy2q8=",
	"sha256-jXKUlkI8wuQbKndzQZBsccnIUWOmK/kmNuERq53aXEc=",
] as const;

// Astro 7.4.4 dev-only inline scripts (dev-toolbar settings, `astro:only`
// hydration helper, island loader). Pinned hashes, DEV ONLY — production
// stays hash-free. Re-verify via the dev console after any Astro upgrade or
// project move (the toolbar payload embeds the project path). Never
// `'unsafe-inline'`.
const ADMIN_DEV_SCRIPT_HASHES = [
	"sha256-+8GaM4dmbWZ33N3gOIea1mixiJP7H2KgqAfQgo=",
	"sha256-Y8t0ntteBwH+PqGKUyjWW3CAk+BNJKSoQc0xZ68FjhM=",
	"sha256-At4sXbunobuxXv56+YxR7rwL4c3n8ubyPDiI7CIowSo=",
] as const;

// `style-src 'unsafe-inline'` is decided, not open: `CoverImg.astro`
// `style={style}` and `render.ts` `style="background-color:…"` (hex
// validated by `DOMINANT_RE`) cannot be hashed; style cannot execute
// script. Scripts stay hash-only, never `'unsafe-inline'`.
const STYLE_SRC = "style-src 'self' 'unsafe-inline'";

// `MEDIA_BASE_URL` → CSP origin, or `null` (local dev: `'self'` only).
// Never throws: a bad var must degrade images, never the response.
export function mediaOriginFrom(raw: string | null | undefined): string | null {
	if (raw === null || raw === undefined || raw === "") return null;
	try {
		return new URL(raw).origin;
	} catch {
		return null;
	}
}

function base(imgSrc: string, scriptSrc: string): string {
	return [
		`default-src 'self'`,
		`img-src ${imgSrc}`,
		STYLE_SRC,
		`script-src ${scriptSrc}`,
		"frame-ancestors 'none'",
		"base-uri 'none'",
		"form-action 'self'",
	].join("; ");
}

// Public pages: two hashed inline scripts + same-origin bundles. The
// JSON-LD block (`type="application/ld+json"`) is a non-executable data
// block — `script-src` does not apply, so it needs no hash.
export function publicCsp(mediaOrigin: string | null): string {
	const img = mediaOrigin === null ? "'self'" : `'self' ${mediaOrigin}`;
	const scripts = ["'self'", ...PUBLIC_SCRIPT_HASHES.map((h) => `'${h}'`)].join(
		" ",
	);
	return base(img, scripts);
}

// Admin: `script-src 'self'` plus per-response hashes of the inline scripts
// Astro emits for `client:only` islands (hydration runtime + island loader).
// Those bytes embed hashed chunk URLs, so they change every build — pinned
// hashes can't cover them. Hashing the exact served bytes is as tight as
// pinning (only our own render output is allowed), without
// `'unsafe-inline'`. Pages without islands hash to nothing (today's header).
// In DEV the pinned Astro-internal hashes are additionally allowed.
export function extractInlineScripts(html: string): string[] {
	const bodies: string[] = [];
	// Skip external scripts (`src=`) and non-executable data blocks
	// (`type="application/ld+json"` — `script-src` doesn't apply to them).
	const re =
		/<script(?![^>]*\bsrc\s*=)(?![^>]*type\s*=\s*["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script\s*>/gi;
	for (;;) {
		const match = re.exec(html);
		if (match === null) break;
		const body = match[1] ?? "";
		if (body.trim().length === 0) continue;
		bodies.push(body);
	}
	return bodies;
}

/** `sha256-<base64>` of an exact script body, via WebCrypto (async). */
export async function hashScriptBody(body: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(body),
	);
	let bin = "";
	for (const byte of new Uint8Array(digest)) bin += String.fromCharCode(byte);
	return `sha256-${btoa(bin)}`;
}

const ADMIN_DEV_HASHES = ADMIN_DEV_SCRIPT_HASHES.map((h) => `'${h}'`);

/** Admin CSP with caller-supplied per-response script hashes appended. */
export function adminCsp(isDev = false, extraHashes: string[] = []): string {
	const scripts = ["'self'", ...extraHashes.map((h) => `'${h}'`)];
	if (isDev) scripts.push(...ADMIN_DEV_HASHES);
	return base("'self'", scripts.join(" "));
}
