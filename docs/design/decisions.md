# Design decisions — Phase 3 audit (owner-approved)

## 1. Scope: audit, not rebuild

Branch `phase-3` (8 commits, clean tree) was audited area-by-area against
`spec.md` §A1–A6. Every area matched; no unrecorded deviations found. Only
change made: the `post.updated` element (spec §A4 shows `updated 14 nov` but
states no rule — see §4 below). Branch then merged to `main`.

## 2. Topics strings: keep branch values

Spec §A3 names the pattern (`Architecture, craft, AI`-style) but gives no
exact strings per tag. Kept branch implementation EXACTLY:

- Kanji map: `essays→随筆 notes→技術 tech→映画 journal→音楽`; other slugs
  render mono slug only.
- Card mono line is the post-count number (`{tag.postCount}`), not a
  description string.

## 3. Accepted corrections (mirrored in `spec.md` §A1)

- **Dark indigo `#5b6fd6` → `#8494ee`.** Mock value measures 4.31:1 on
  `--bg #0b0e13` (fails AA 4.5 for small mono text); lifted value is 6.86:1.
  Decorative indigo in artwork unchanged. Light indigo `#2b3fa3` unchanged
  (8.96:1).
- **Dual font preload.** Plan said display face only; branch preloads both
  `bodoni-moda-latin-400-normal.woff2` and
  `newsreader-latin-400-normal.woff2`. Justified: body-face swap reflows the
  first article paragraphs (measured CLS 0.178 on post before the fix, ≤0.05
  after). Same origin `/_astro/`, no new CSP host.

## 4. Updated-date rule (spec §A4 gap, owner delegated)

Spec §A4 meta shows `updated 14 nov` but never states when it appears. Rule:
render `· updated {date}` inside the left mono meta cluster IFF
`post.updatedAt !== post.publishedAt` (same-day edits stay silent; both are
UTC epoch ms). Date via existing `formatPostDate(updatedAt, locale)`. New
keys `post.updated`: EN `"updated {date}"`, ID `"diperbarui {date}"`
(owner-correctable placeholders). Archive rows keep `21 aug · 7 min` with no
updated element.
