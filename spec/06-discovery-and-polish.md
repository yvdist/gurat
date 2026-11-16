# Phase 6 — Discovery and polish

**Goal:** make the writing easy to subscribe to, find and share: feeds, sitemap, structured metadata, share images, and reading-experience extras.

**Depends on:** Phase 2 and Phase 5 (Phase 3 for OG template and visual extras). **Read first:** `00-overview.md`.

## Out of scope
Comments, newsletter, social auto-posting, heavy analytics.

## Tasks

### 6.1 Feeds
- RSS 2.0 (or Atom — pick one and record why) per locale: `/feed.xml` (EN) and `/id/feed.xml` (ID). Latest 30 public posts, **full content HTML**, absolute URLs (including absolute image URLs), correct `language`, `lastBuildDate`, `guid` stable per post (permalink or UUID-based; never changes on edit).
- Proper XML escaping; CDATA only where safe. Support `ETag` / `Last-Modified` and conditional GET (304).
- `<link rel="alternate" type="application/rss+xml" hreflang="…">` in every page `<head>`.

### 6.2 Sitemap and robots
- `/sitemap.xml`: all public posts, tag pages and static pages for both locales with `lastmod`, and `xhtml:link` hreflang alternates for translated posts. Only content that satisfies the public visibility rule.
- `/robots.txt`: allow public, `Disallow: /admin`, reference the sitemap.

### 6.3 Metadata
- Canonical URLs, symmetric `hreflang` (+ `x-default`), Open Graph and Twitter card tags, JSON-LD `BlogPosting` (`inLanguage`, `datePublished`, `dateModified`, `author`, `image`).
- Favicon set and web app manifest (assets from the design spec).

### 6.4 Share images (OG)
- Ship a static `og-default` image as the fallback.
- Per-post OG image is **generated at publish/save time in the admin (client-side canvas, using the template and fonts from the design spec)** and uploaded to the media bucket as `og/<postId>.png` (add a nullable `og_image_key` column via migration). The public page references it with absolute URL and correct dimensions (1200×630).
- **Do not generate OG images per request on the Worker** (WASM/rasterization is too heavy for free-tier CPU). If the owner later wants server-side generation, write an ADR with measured CPU cost first.
- Regenerate on title/cover change; allow manual "regenerate" in the editor.

### 6.5 Reading experience (design-dependent; implement only what the design spec includes)
- Table of contents from `toc_json`; heading anchor links; previous/next post; related posts by shared tags; "other language" notice on translated posts.
- New content nodes (e.g. footnotes/sidenotes, pullquote) go through schema → renderer → Tiptap parity → XSS tests (see Phase 3 rules).
- Optional reading progress indicator if (and only if) specified, within the JS budget.

### 6.6 Optional stretch: search
D1 FTS5 virtual table kept in sync on save (title, excerpt, plain text), `/search?q=` server-rendered, rate-conscious (limit query length, results ≤ 20). Verify FTS5 support in D1 before starting. Skip if it threatens the schedule.

### 6.7 Optional: privacy-friendly analytics
Cloudflare Web Analytics beacon (cookie-less) behind a config flag; if enabled, update the CSP in Phase 7 accordingly. Off by default.

## Tests
- Feed and sitemap parse as valid XML; only public posts appear; draft/future/unpublished never leak; conditional GET returns 304.
- hreflang symmetry test across all translated pairs.
- JSON-LD validates against expected shape; OG tags present on post pages with absolute URLs.
- Playwright: OG image upload happens on publish and the URL resolves.

## Acceptance criteria
- [ ] Both feeds validate (W3C Feed Validator or equivalent) and render correctly in a real reader.
- [ ] Sitemap contains only public content with correct alternates; `robots.txt` correct.
- [ ] Shared links show the right title/description/OG image on at least two platforms (manual check).
- [ ] No per-request heavy compute was introduced; public JS budget unchanged.
- [ ] `docs/phase-reports/06.md` written.
