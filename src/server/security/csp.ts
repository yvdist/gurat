// Content-Security-Policy builders (spec 07 §7.1). Pure functions — no env
// access here; the caller resolves the media origin and passes it in.
// Any edit to the inline scripts in `src/layouts/Base.astro` changes the
// rendered bytes and therefore the hashes below: the e2e CSP-violation
// listener (`tests/e2e/hardening.spec.ts`) fails closed on drift.

// Rendered `<script type="module">` bytes in `Base.astro`, hashed with
// `sha256` over the exact served content (verified stable across rebuilds):
// [0] theme no-flash (head), [1] theme/locale/copy interactions (body).
const PUBLIC_SCRIPT_HASHES = [
	"sha256-dSwg7v9xTCFke3R+41nP4qD5rE6ZATNcPk7sz5ezGzo=",
	"sha256-dAHpaqBtPUz0woM0pVlnViqkNcCTLEALJYVOiG/qU2w=",
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

// Admin: no inline scripts (`Admin.astro` is script-free; island chunks are
// same-origin). `script-src 'self'` only — if the built island ever emits an
// inline bootstrap, the e2e listener fails closed: add that exact hash,
// never `'unsafe-inline'`.
export function adminCsp(): string {
	return base("'self'", "'self'");
}
