# Rebuild notes — round 1 (critique pass)

Date: 2026-11-18. Captures: `docs/design/audit/seeded/` (40 files, incl. 4
overlay states added this round). References: `docs/design/reference/` (8 PNGs)
- `docs/design/brief.md` (binding on any conflict).

## Method

No `impeccable` launcher in this environment (`pnpm exec impeccable` →
"Command not found"), so round 1 is a manual side-by-side against the brief's
wireframes + sampled reference hexes (stdlib PNG decode: light bg `#ffffff`,
title ink `#0e0e0e`, dark bg `#0a0a0a`, dark ink `#ececec`, hairline `#242424`,
muted `#949494`/`#5c5c5c`). `npx impeccable detect src/` likewise unavailable —
recorded below as unverified, not as passed.

## Home vs Home reference — MATCH with 2 fixes applied

- Full-bleed sunset feature, mono eyebrow `NO. 001 · FEATURED · SOFTWARE`,
  serif title link, italic excerpt, `READ THE ESSAY →` + `7 MIN →` row ✓
- Numbered index `随筆 ESSAYS AND NOTES · EN / ID`, 2-up then 3-up photo rhythm,
  `NO. NNN / TAG · N MIN` meta + serif titles, `ALL WRITING →` ✓
- About preview with portrait + `MORE →`; footer
  `gurat TAGS RSS EN/ID LIGHT/DARK © 2026` ✓
- FIXED (1): feature text was a 2-column grid (excerpt right of title);
  restacked to single column per the wireframe (title → excerpt → action row).
- FIXED (2): `EN` toggle link inside the index heading failed axe
  `link-in-text-block` on dark (ink `#ececec` vs muted text ≈ 2.4:1, no
  underline); the `aria-current` link now keeps a persistent underline.
- DIVERGENCE (documented, not a bug): post numbers are computed badges
  (`NO. 001…`) rather than the reference's `NO. 014`-style corpus numbers.
  Kept computed badges per plan.

## Post vs Post reference — MATCH with 1 fix applied

- Centered serif title + byline, sticky `CONTENTS`, 3-col grid ≥1280px with
  right sidenotes, five figure treatments + numbering, italic pullquote,
  footnotes with working `↩` (each resolves to its inline `fnref-N`), closing
  pills + `COPY LINK / RSS / EMAIL` + 3 thumbnail cards ✓
- FIXED: hero cover was missing (seed sets no `cover_media_id`, page only
  used the explicit cover) — now falls back to the first body figure via
  `listingCoverId`, same rule as all other listing surfaces. Verified in code;
  visual re-check pending in the rerun captures.
- Gray/olive solid rectangles in the round-0 capture are screenshot-timing
  artifacts (lazy images mid-load), NOT broken fixtures: all 14 fixtures ×
  3 variants serve 200 on the dev backend (`/media/<id>/1600.webp` verified
  for the exact IDs in the capture). No placeholder boxes were substituted.

## Archive / Tags / About vs references — MATCH

- Archive: display H1 + `{N} ESSAYS · 2025 — 2026`, category pills filter
  client-side (empty years hide), locale pills as plain links, year groups
  with counts, rows `NO. NNN · serif title · TAG · DATE · MIN`, CSS-only
  hover cover preview (nothing on `hover:none`) ✓
- Tags: kanji-prefixed mono counts over Newsreader names + 3-thumb strips;
  zero-visible rows hidden ✓
- About: portrait + bio + `WRITING IN / ELSEWHERE / WRITE TO ME / FOLLOW` +
  verbatim Colophon; stacks text-first on narrow ✓
- Menu overlay: near-black always, 01–04 numerals, EN/ID, LIGHT/DARK,
  `LATEST · NO. 001` block, footer line; Esc closes, focus trapped + returned ✓

## Budgets / CSP / gates (this round)

- `budgets.spec.ts` green (e.g. `/`: html 16519 + css 21536, js 2369 ≤ 3 KB,
  0 same-origin `script[src]`); hover previews CSS-only, images lazy except
  hero covers ✓
- CSP re-pinned to 3 hashes (head no-flash unchanged; body theme/menu/copy;
  archive filter pills): `dSwg… / kYp0… / jXKU…`; `security.csp.test.ts`
  expects exactly 3 ✓

## Round 2 (verification + fixes)

- Post hero now uses first-figure fallback (code); feature text stacked;
  index-heading current-locale link persistently underlined (axe
  `link-in-text-block` on dark).
- Flake analysis (all reproduce green on clean rerun; failures rotate across
  runs and never repeat the same test twice): (a) parallel-run file-lock on
  screenshot writes (`UNKNOWN, open ...png`), (b) orphaned `astro dev`
  servers from overlapping runs serving stale ports, (c) dev-server
  saturation under full-parallel load (title/document races). Mitigation:
  final gate runs with `--workers=2`, no overlapping servers.
- Reading-theme assertion hardened deterministically: pins
  `main .feature-eyebrow` (the plan's proof point) instead of
  `getByText(...).first()` (which could resolve the overlay's hidden
  `LATEST · NO. 001` copy or race under load).
- `pnpm check` green (astro 0/0, biome clean, vitest 134/134).
- `impeccable detect src/`: UNVERIFIED (launcher missing in this env).

## Round 2 acceptance — GREEN

- `pnpm check` EXIT 0 (astro 0 errors, biome clean, vitest 134/134).
- Chromium: 66/66 preview-backed suites + 40/40 seeded-audit (incl. 4 overlay
  states) in split runs — 106/106, zero retries needed in the final runs.
  (Full-parallel single runs flake under shared `.wrangler/state` SQLite
  contention; split runs are the honest gate on this box.)
- Post hero cover present (first-figure fallback verified in captures);
  feature text stacked; axe 20/20 incl. dark (link-in-text-block fixed).
- Remaining unverified only: `impeccable detect src/` + `impeccable
  critique/audit/polish` (launcher missing in this environment).
