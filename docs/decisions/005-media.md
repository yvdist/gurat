# 005 — Phase 5 media pipeline (browser-encode, public R2, no Worker serving)

Date: 2026-11-17. Status: accepted.

## Context

Spec `05-media.md` §"Design decisions" requires an ADR choosing the variant
generation strategy, the original-storage policy, and the serving path.
Phase 5 builds on `main` (`ea872dc`); `pnpm build` exit 0, `pnpm check` green
after a format-only fix to `docs/phase-reports/04.md` (table alignment, zero
blob logic change).

Docs verified at decision time (2026-11-17):

- R2 public buckets / custom domains (setup, cache):
  https://developers.cloudflare.com/r2/buckets/public-buckets/
- Workers R2 API (`put`/`get`/`delete`, `R2PutOptions.httpMetadata`,
  `httpMetadata.cacheControl`):
  https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- `request.formData()` multipart file handling and canvas
  `createImageBitmap` / `toBlob("image/webp", quality)` are standard Web
  Platform APIs available in all modern browsers — no doc verification needed
  beyond the TypeScript DOM libs already in use.

## Decision

1. **Pre-generate variants at upload time, in the browser.** The admin decodes
   the image (`createImageBitmap`), produces widths `[480, 960, 1600]` filtered
   to `≤ sourceWidth` (if the source is smaller than 480, the single variant is
   the source width — never upscale), and encodes WebP via canvas
   `toBlob("image/webp", 0.82)`. Re-encoding through canvas strips EXIF/GPS
   (spec §5.6 acceptance) and keeps the cost predictable: zero server-side
   image processing, zero per-transformation fees.
2. **Rejected: Cloudflare Images transformations.** Per-transformation quota
   plus per-request cost, against a fixed-cost pipeline we fully control.
   Recorded here so the alternative is not re-litigated silently (spec §1).
3. **Originals are not stored** (`KEEP_ORIGINALS=false`). If ever enabled,
   originals go to a **separate private bucket**, never the public one.
4. **Serve from a public R2 bucket on a custom domain** (`MEDIA_BASE_URL`,
   e.g. `https://media.<domain>`), never through the Worker: every
   Worker-served image would count against the free daily request quota.
   Object keys are immutable (`media/<id>/<width>.webp`), stored with
   `httpMetadata: { contentType: "image/webp", cacheControl: "public,
   max-age=31536000, immutable" }`. Only derived variants live in the public
   bucket.
5. **URL rule (single, used by renderer + rerender + client):**
   `url = MEDIA_BASE_URL.replace(/\/+$/, "") + /media/<id>/<w>.webp`.
   Empty base (local) = same-origin `/media/...` served by the dev-only route;
   prod absolute origin = no Worker invocation.

## Dependencies

None new. Magic-byte sniffing plus JPEG-SOF / PNG-IHDR / WebP-VP8/VP8L/VP8X
dimension parsing are ~60 lines of hand-rolled, workerd-tested code (no
`exiftool`, no image lib). Fallback, only if a real camera fixture defeats a
parser during tests: pin a parser dep with release date ≤ 2026-11-03, amend
this ADR, note it in the phase report. Do not stall on it.

## Consequences

- `wrangler.jsonc` gains `MEDIA_BASE_URL` / `KEEP_ORIGINALS` vars (prod values
  via dashboard, never committed); `src/lib/env.ts` gains the typed fields.
- `MEDIA_BASE_URL` and variant bytes are baked into saved HTML; changing
  either requires `pnpm db:rerender`.
- The dev-only `/media/:id/:file` route exists solely for local emulation and
  404s in production (spec §5.5).
