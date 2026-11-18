# Gurat — photo-first editorial brief

> Single source of truth for the Gurat redesign, reverse-engineered strictly
> from `docs/design/reference/` (8 PNGs). Transcribe-only: anything not
> visible in a named PNG is marked `unverified — confirm first`, never
> invented. Seeded baseline: `docs/design/audit/seeded/` (36 files).
> Gap analysis: `.impeccable/critique/`.

## 1. Direction & precedence

**Direction:** "Gurat — photo-first editorial direction" (haruka nakamura
editorial photography rhythm). Photography does the branding: full-bleed
features, numbered essay index, topic rows with photo previews. Quiet
monochrome shell; all chroma comes from photographs.

**Precedence (binding):** `docs/design/reference/` PNGs > this brief >
impeccable `shape` (brief-first) + `critique` (dual-agent evidence) >
taste-skill rules that apply (real photographs only, equal edges, quiet
hover/step micro-interactions, one system, copy/link discipline, keyboard +
head + perf gates). Conflicting taste defaults do NOT apply (one-section-
per-screen, shader/scene effects, tech-only moments, violet accents,
place/product palettes). When reference and any skill disagree, **reference
wins**. Rival patterns to avoid, never blend: Bodoni Moda display as brand
voice; indigo (`#2b3fa3`) link/accent/panel-navy dashboard chrome; `AUTO`
theme segmented control; pill-tag chips and card grids; decorative CSS
washes/discs/arcs standing in for photographs.

## 2. Design tokens

- **Type:** Newsreader serif (text-face even at large sizes) + IBM Plex Mono
  for everything meta (eyebrows, numbers, dates, labels, colophon).
  Colophon (About reference): "Set in Newsreader and IBM Plex Mono."
- **Wordmark:** lowercase `gurat` with hand-drawn underline stroke, everywhere
  (header, menu overlay, footer, admin sidebar, OG). Removes `余`/`余白`
  mismatches (`unverified — confirm first` whether the stroke is a glyph or
  SVG; trace the PNG).
- **Color:** light/dark monochrome — white/black/warm grays; photography
  carries all chroma. Hairlines, not panels. (`unverified — confirm first`:
  exact hex stops; read from reference PNGs, not from current tokens.)
- **Rhythm:** single editorial column; full-bleed photo features; hairline
  index rows; mono eyebrow `NO. 014 · FEATURED · SOFTWARE`; `01 / 07`
  figure numbering; `↩` footnote returns.
- **Kanji accents:** fixed map software/技術, film/映画, music/音楽,
  notes/覚書 — tag badges and topic rows only, never the wordmark.

## 3. Home (`Home — light@1x (1).png`)

```
┌ masthead: gurat | WRITING  ABOUT  MENU + ─────────────┐
│                                                        │
│  [ full-bleed sunset feature photo                   ]│
│  NO. 014 · FEATURED · SOFTWARE                         │
│  The quiet cost of a clever abstraction                │
│  On inheriting a shape without the argument… (italic)  │
│  READ THE ESSAY →            8 MIN →                   │
│                                                        │
│  随筆  ESSAYS AND NOTES · EN / ID                       │
│  [photo][photo]   NO. 013 / FILM · 11 MIN              │
│  [photo][photo][photo]  NO. 012 … / NO. 011 …          │
│  ALL WRITING →                                         │
│                                                        │
│  About preview: portrait + bio + MORE →                 │
│                                                        │
│  footer: gurat | TAGS RSS EN/ID LIGHT/DARK | © 2026    │
└────────────────────────────────────────────────────────┘
```

Element checklist: minimal masthead (no inline toggles — settings live in
the overlay); full-bleed featured photo; mono eyebrow; serif title + italic
subtitle; `READ THE ESSAY →` + `N MIN →`; numbered index (`随筆` heading,
`EN / ID` toggle, 2-up then 3-up photo rows with `NO. NNN / TAG · N MIN`);
`ALL WRITING →`; About preview with portrait + `MORE →`; footer row.

## 4. Post (`Post — dark@1x (1).png`)

```
┌ masthead: gurat | WRITING  ABOUT  MENU + ─────────────┐
│   centered serif title (2 lines)                       │
│   OCT 2026 · 8 MIN READ · BACA DALAM BAHASA INDONESIA →│
│  [ full-viewport cover photo                          ]│
│  CONTENTS (sticky) │ body 68ch, drop cap │ sidenote →  │
│  offset figure 03 / 07 (side caption)                  │
│  pair 2-up │ triptych 3-up │ italic pullquote          │
│  wide full-bleed │ footnotes 1. 2. + ↩                 │
│  author card + COPY LINK / RSS / EMAIL                 │
│  [prev thumb][related thumb][next thumb]               │
└────────────────────────────────────────────────────────┘
```

Checklist: centered title + byline + translation link; full-viewport cover
(the ONLY hero — no second panel); sticky `CONTENTS` TOC; right sidenote
column ≥1280px, inline fold below; all five treatments + `NN / NN`
numbering; italic pullquotes (no color rule); numbered footnotes + `↩`;
author card; share row; 3-col Previous/Related/Next thumbnails.

## 5. Archive (`Writing — archive@1x.png`)

`Writing` display title; `8 ESSAYS · 2025 — 2026`; filter bar
`all / software / film / music / notes` + `EN / ID / ALL`; year groups
(`2026`, `2025`); rows `NO. 014 · title · 12 NOV` with **hover cover
preview** (`HOVER PREVIEW · COVER` hint). Behavior: filters narrow rows
client-side; hover reveals cover thumbnail; empty year groups hidden.

## 6. Tags (`Tags@1x.png`)

`Tags` + `BROWSE BY TOPIC`; typographic topic rows:
`技術 · 6 ESSAYS / Software` + **3 photo thumbnails each**; same for
Film (`映画 · 4`), Music (`音楽 · 3`), Notes (`覚書 · 1`). Counts from
`visibilityFilter`; each row links the tag page; rows with zero visible
posts hidden (clean-empty rule §10).

## 7. About (`About@1x.png`)

Window-light portrait left; right column: `ABOUT` eyebrow + bio placeholder
(`unverified — confirm first`: owner writes 2–3 sentences); `WRITING IN /
English and Indonesian`; `ELSEWHERE / [portfolio] [github]`; `WRITE TO ME /
[your@email]`; `FOLLOW / rss`; Colophon line (Newsreader + Plex Mono, Astro
on Cloudflare, custom editor). Placeholders in brackets are owner content,
not lorem — ship with real copy or hide the row.

## 8. Menu overlay (`Menu — overlay@1x.png`)

Dark fullscreen: `gurat` + `CLOSE ×`; `01 Writing / 02 Tags / 03 About /
04 RSS` oversized serif numerals; `EN / ID` + `LIGHT / DARK` rows;
`LATEST · NO. 014` photo preview + title right; footer
`© 2026 / GURAT — ESSAYS AND NOTES`. Header collapses to
`gurat / WRITING / ABOUT / MENU +` — all settings deferred here.

## 9. Admin & editor specs

### Dashboard (`Admin — dashboard@1x.png`)

```
┌ sidebar │ WEDNESDAY, 18 NOV 2026    [search posts] [+ NEW POST] ┐
│ GURAT_  │ Dashboard                                            │
│ DASHBOARD│ DRAFTS 3 │ SCHEDULED 1 │ PUBLISHED 14 │ MISSING TR 5 │
│ POSTS    │ CONTINUE WRITING: thumb + title + DRAFT·EN·WORDS·SAVED│
│ TAGS     │ POSTS … ALL POSTS →                                  │
│ MEDIA    │ thumb rows: title | EN ⇄ ID | ●/○/◐ status | date  │
│ SETTINGS │ NEEDS ATTENTION │ FREE-TIER USAGE │ RECENT UPLOADS  │
│ VIEW SITE│                                                      │
└────────────────────────────────────────────────────────────────┘
```

Sidebar: `GURAT_` mark, DASHBOARD/POSTS/TAGS/MEDIA/SETTINGS,
`VIEW SITE ↗`, `[YOUR@EMAIL]`, `SIGN OUT`. Date line is the current day
(`unverified — confirm first`: static date vs live clock). 4-metric strip
counts live queries. Thumbnail rows carry translation badges
(`EN ⇄ ID` both, `EN ✕ ID` missing — `●/○/◐` dots in plan from illegible
pixels: `unverified — confirm first`). Utility panels hide when empty (§10).

### Posts/tags/media

Filter bars + chip badges + drag-and-drop upload + grid + inline alt editor
(`unverified — confirm first`: transcribe from implementation phase against
the dashboard PNG language; no reference beyond dashboard-level density).

### Writing-first editor (`Editor — writing-first@1x.png`)

Distraction-free WYSIWYG canvas at article measure. Top bar: `← ALL POSTS` +
autosave (`● DRAFT · SAVED 2 MIN AGO`) + `PREVIEW` + `PUBLISH`. Cover
uploader with `CHANGE COVER`. H1 + italic subtitle. Bubble menu on
selection: `B I link H2 " "`. Figure width switcher above selected image:
`INLINE / WIDE / FULL / PAIR` (`unverified — confirm first`: whether
TRIPTYCH/OFFSET appear here or only via slash menu). `/` slash menu:
`Image · inline / full-bleed / pair`, `Divider · gurat line`, …
Bottom bar: `1,240 WORDS · 6 MIN READ / F FOCUS / / INSERT / ⌘P PREVIEW`.
Slide-over `DETAILS` panel: LANGUAGE `en/id` pills + translation status
(`Indonesian version: not created · create translation`), SLUG, EXCERPT
textarea, TAGS chips (`software ×`, `abstractions ×`, `+ add`), PUBLISH
`now/schedule`, SEO DESCRIPTION (`uses the excerpt · edit`).

## 10. Behavior matrix

Clean-empty rule: **hide empty sections, never render "No posts yet" boxes.**
Applies to home Latest/Topics/Archive/About-preview, archive groups, tags
rows, and admin utility panels alike.

| Posts | Home                                                                                               | Archive                                             | Tags                                            | About                                   | Admin                                                        |
| ----- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------- | --------------------------------------- | ------------------------------------------------------------ |
| 0     | Masthead + feature slot hidden; index/topics/archive/About-preview hidden; footer only             | Title + filters hidden; nothing listed              | Title only, zero rows                           | Bio + sections as written (static page) | Metrics `0`; CONTINUE WRITING hidden; NEEDS ATTENTION hidden |
| 1     | Feature = the post; index single row; topics single badge; archive single row                      | Single group, single row, no year split             | Single row + 3 thumbs (same cover)              | As written                              | Metrics live; list single row                                |
| 3     | Feature + 2 index rows; topics per present tags                                                    | Groups as dated; filters live                       | Rows per present tags only                      | As written                              | Full panels                                                  |
| 20    | Feature + paginated index (`ALL WRITING →`); topics top-4 by count; archive 5 latest + year groups | Year groups + pagination; hover previews throughout | All four rows + thumbs; overflow hidden per row | As written                              | Paginated lists                                              |

Draft/scheduled posts never appear on public surfaces (`visibilityFilter`);
admin lists them with status badges. Missing-translation metric counts
groups without the counterpart locale.

## 11. Skill applicability + override clause

Applicable: impeccable `shape` (brief-first; Read mode = public surfaces,
Operate mode = admin/editor; refinement preserves identity) and `critique`
(dual-agent evidence, heuristic scoring). Taste-skill rules that apply: real
photographs only, equal edges, quiet hover/step micro-interactions, one
system, copy/link discipline, keyboard + head + perf gates. Conflicting
taste defaults do NOT apply: one-section-per-screen, shader/scene effects,
tech-only moments, violet accents, place/product palettes.

**Override:** in any conflict between the skills and this brief or the
reference PNGs, `docs/design/reference/` + `docs/design/brief.md` override
both skills. Rival patterns (§1) are never blended in.
