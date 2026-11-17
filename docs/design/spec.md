# Design spec — Phase 3 (transcribed from owner PNGs)

Owner-supplied mockups in `docs/ui-ux/`: Home light 1280×2500, Post dark
1280×3318, Admin dashboard 1280×1150. Admin dashboard PNG is Phase 4 input,
not built here. This file is the Phase 3 spec §expected-inputs artifact the
owner approved via PNG; record any owner correction here, never in code
comments.

## A1. Tokens

Light: `--bg #ffffff`, `--surface #f7f8fa` (admin only, Phase 4),
`--ink #101419`, `--muted #5c6672`, `--line #eceef0`, `--indigo #2b3fa3`,
`--panel-navy #1f2b3f`, `--wash-blue #d3dcea`, `--wash-sage #c7d9d5`,
`--wash-lilac #dcd8ea`, `--card-plum #34305a`, `--avatar-ring #807c9b`.
Dark: `--bg #0b0e13`, `--panel #070a0f`, `--raised #1a2130`,
`--ink #e9ecf1`, `--muted #97a0ae`, `--line #232b36`,
`--indigo-bright #8494ee` (owner-accepted correction 2026-11-17: mock
`#5b6fd6` is 4.31:1 on `--bg`, fails AA small-text; `#8494ee` is 6.86:1;
decorative indigo unchanged; see `decisions.md` §3). Radius small (4–6 px pills/cards), hairline 1 px
borders, motion 120/200 ms ease-out hover only. Type: display "Bodoni Moda"
400–600, H1 `clamp(2.75rem, 1.5rem + 5vw, 4.5rem)` tight leading, serif body
"Newsreader" 1.0625 rem/1.75, mono "IBM Plex Mono" 0.75 rem uppercase tracking
0.08em for eyebrows/meta/nav. Measure 68ch article, 1090 px page.

## A2. Global

Header: logo (indigo rounded square with 余 + serif wordmark from `SITE.name`),
right mono nav + `en/id` segmented switch + theme segmented switch. Footer:
hairline, mono `© {year} {name}`, center serif 余白, right `rss` text. Focus:
2 px indigo outline offset 2. Selection: wash-blue tint. Reduced motion:
existing kill-switch covers new transitions.

## A3. Home (light)

Hero 2-col (1.1fr/0.9fr): eyebrow mono indigo (`随筆 · {tag}`), serif H1
3 lines, lede muted, two mono links (`read the latest →`, `subscribe via rss`
as text until Phase 6); right hero figure: wash top + pale circle + navy
bottom, mono caption, serif featured title. Latest: H2 + right
`all writing →`; 3 cards (16/10 figure, mono `No. {n} · {tag} · {min} min`,
serif title, 2-line excerpt). Topics: H2 + right `browse by tag`; 4 cols
(indigo kanji, serif name, mono desc `Architecture, craft, AI`-style per tag —
fixed map for seed slugs). Archive: H2 + year right; rows (mono indigo No.,
serif title, mono `21 aug · 7 min`); right About card (avatar,
`About the writer`, bio, `read more →`). Empty states keep Phase 2 copy.

## A4. Post (dark mock; identical structure light)

Breadcrumb mono, two pills, serif H1, italic serif lede, mono meta
(`12 nov 2026 · updated 14 nov · 8 min read` — `updated {date}` shows only
when `updatedAt` differs from `publishedAt`; date via existing
`formatPostDate`) + right translation link. Hero panel (raised, indigo
semicircle arc, `aria-hidden`) + mono caption when a cover figure exists.
Body grid ≥1280 px: 200 px TOC (`contents` + numbered mono links from
`toc_json`) / 68ch article / 220 px sidenotes; <1280 px sidenotes collapse
inline. Article: drop cap on first paragraph, serif H2/H3, pullquote (italic
serif + left indigo rule), bullets, code (raised panel, uncolored mono),
footnotes section, `hr` hairlines. Byline box (avatar, `Written by {name}`,
`[save link]` text until Phase 6, right `copy link` + `rss`). Prev/next cards
(figure, mono `← previous · No. {n}`, serif titles). One `h1`,
`time[datetime]`, canonical/hreflang unchanged.

## A5. Archive/tag/about/404

Same header/footer; archive groups by year (existing helper) in Archive-row
style; tag pages identical with tag title; about = About-card full width +
bio; 404 = centered serif title + muted body + home link.

## A6. Imagery (pre-Phase 5)

No R2: all figures/covers/avatars are CSS two-tone panels + pale circle
(`aria-hidden`), navy/plum/sage/lilac rotation by post index. `figure` nodes
render caption below; `layout` wide breaks the text column (existing
classes). Real `<img>` only from Phase 5.
