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
	"sha256-kYp0tNaRAr0Yzje5Vr4q+iHQYhJOGNra4PMDuOTy2q8=",
	"sha256-jXKUlkI8wuQbKndzQZBsccnIUWOmK/kmNuERq53aXEc=",
] as const;

// Astro 7.4.4 dev-only inline scripts (dev-toolbar settings, `astro:only`
// hydration helper, island loader). Pinned hashes, DEV ONLY — production
// stays hash-free. Re-verify via the dev console after any Astro upgrade or
// project move (the toolbar payload embeds the project path). Never
// `'unsafe-inline'`.
const ADMIN_DEV_SCRIPT_HASHES = [
	"sha256-+8GaM4dmbWZ33N3gOIea1elDa9mixiJP7H2KgqAfQgo=",
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
		"default-src 'self'",
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

// Admin: production is `script-src 'self'` only — no hashes, no
// `'unsafe-inline'` (`Admin.astro` is script-free; island chunks are
// same-origin). In DEV (`import.meta.env.DEV`) the pinned Astro-internal
// hashes above are allowed so `client:only` islands can hydrate under
// `astro dev`; the e2e hardening proof asserts this split (no `sha256-` on
// prod, exactly these three on dev).
export function adminCsp(isDev = false): string {
	const scripts = isDev
		? ["'self'", ...ADMIN_DEV_SCRIPT_HASHES.map((h) => `'${h}'`)].join(" ")
		: "'self'";
	return base("'self'", scripts);
}
