# Phase 5 — Media

**Goal:** the owner can add images to posts from the editor. Images are stored in R2 as optimized, EXIF-free variants, served directly from Cloudflare's edge with no Worker invocation, and rendered as responsive, layout-stable `<img>` elements.

**Depends on:** Phase 4. **Read first:** `00-overview.md`.

## Out of scope

Video/audio, SVG uploads, GIF, image editing/cropping UI, external image URLs, AI features.

## Design decisions (record as an ADR, verify against current Cloudflare docs)

1. **Pre-generate variants at upload time, in the browser.** The admin decodes the image, produces width variants (default 480 / 960 / 1600 px; never upscale) as WebP (quality ≈ 82), and uploads the variants plus metadata. Re-encoding through canvas strips EXIF/GPS and keeps the cost predictable. Alternative if this proves inadequate: Cloudflare Images transformations (note the free monthly transformation quota) — decide via ADR, do not switch silently.
2. **Originals are not stored** by default (`KEEP_ORIGINALS=false`). If enabled, originals go to a **separate private bucket**, never the public one.
3. **Serve from an R2 public bucket on a custom domain** (`MEDIA_BASE_URL`, e.g. `https://media.<domain>`), not through a Worker, because every Worker-served image would count against the free daily request quota. Object keys are immutable (`media/<id>/<width>.webp`), cached with `Cache-Control: public, max-age=31536000, immutable`.
4. Only derived variants live in the public bucket.

## Tasks

### 5.1 Upload pipeline

- `POST /admin/api/media` (multipart: variant files + JSON metadata). Server-side validation:
  - Allowed source types: JPEG, PNG, WebP (AVIF optional). **Reject SVG and everything else.**
  - Sniff magic bytes of every uploaded part; do not trust the declared MIME or extension.
  - Limits: source ≤ 12 MB, each variant ≤ 3 MB, max 8 variants, dimension sanity checks (reject absurd sizes).
  - Verify variant widths match metadata and the aspect ratio is consistent across variants.
- Write to R2 under `media/<id>/<width>.webp`; insert the `media` row (`width`, `height`, `bytes`, `dominant_color`, `variants_json`, `alt_default`). If any step fails, clean up partially written objects.
- Client computes `dominant_color` (cheap downscale average) for use as a placeholder background.

### 5.2 Media library (`/admin/media`)

Grid of thumbnails, upload dropzone (drag/drop and paste), edit default alt text, show where a media item is used (via `post_media`), delete. **Deletion is blocked while referenced** (`ON DELETE RESTRICT` + friendly message). A script `pnpm media:orphans` lists media unreferenced for > 7 days.

### 5.3 Editor integration

- Image insertion via picker, drag/drop and paste. **Alt text is required** before insertion; an explicit "decorative" checkbox sets `alt=""`.
- `figure` node attrs: `mediaId`, `alt`, `caption`, `layout: inline | wide | full` (the actual visual treatment of layouts comes from Phase 3).
- Cover image selector in the metadata panel (`cover_media_id`).
- Keep `post_media` in sync on every save.

### 5.4 Rendering

- The renderer receives the media map (Phase 2 `ctx.media`) and emits a `<figure>` with `<img>` using `srcset`, a sensible `sizes` per layout, intrinsic `width` and `height` attributes (prevents layout shift), `loading="lazy"`, `decoding="async"`, and the dominant color as an inline placeholder background. Optional `<figcaption>`.
- The cover/first image above the fold uses `fetchpriority="high"` and no lazy loading.
- Because HTML is rendered at save time, run `pnpm db:rerender` when variants or `MEDIA_BASE_URL` change.

### 5.5 Config and docs

- Bucket creation, public access/custom domain setup, and CORS (only if needed for the upload flow) documented in README.
- `MEDIA_BASE_URL` configured per environment; local dev serves media from the local R2 emulation behind a dev-only route.

### 5.6 Tests

- Magic-byte rejection (e.g. an `.exe` renamed to `.jpg`, an SVG, a polyglot), size/dimension limits, partial-failure cleanup.
- EXIF: a fixture JPEG with GPS data produces variants with **no** EXIF (verify with `exiftool` or a library in the test).
- Renderer: figure output snapshot (srcset, width/height, alt escaping, caption escaping, layouts).
- Referential integrity: deleting referenced media is refused; unreferenced deletion removes DB row and R2 objects.
- Playwright: upload → insert → publish → public page shows responsive image with zero layout shift.

## Acceptance criteria

- [ ] A 6000 px JPEG with GPS EXIF uploads; resulting variants exist, contain no EXIF, never exceed source width, and the post renders with `srcset` and explicit dimensions.
- [ ] SVG and disguised non-images are rejected.
- [ ] Public images are served from `MEDIA_BASE_URL` with immutable cache headers and **no Worker invocation**.
- [ ] Referenced media cannot be deleted; orphan report works.
- [ ] CLS ≈ 0 on a post with several images (Lighthouse).
- [ ] `docs/phase-reports/05.md` written.
