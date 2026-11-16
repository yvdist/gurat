# Phase 3 — Design implementation

> **STATUS: BLOCKED.** Do not start until the owner provides the design spec in `docs/design/`. Until then, the UI stays neutral (Phase 2). This file defines the contract so the design can be implemented faithfully, not invented.

**Depends on:** Phase 2 and the design spec. **Read first:** `00-overview.md`.

## Expected inputs (from the owner)
- Design tokens: color (light + dark), type scale, spacing scale, measure, radii, elevation, motion durations/easings.
- Fonts (files + licenses) and the intended fallback stack; any Japanese/decorative label treatment.
- Layouts for: home, archive, post, tag pages, about, 404, language switcher, theme toggle, footer/header.
- Article typography details: headings, lists, blockquote, code, figures (`inline|wide|full`), links, selection, focus states.
- Motion spec: page/view transitions, hover/focus states, reduced-motion behavior.
- Imagery rules: cover usage, aspect ratios, captions, placeholder style.
- OG image template and favicon set (consumed in Phase 6).
- Any new content nodes the design needs (e.g. sidenote, pullquote, callout, drop cap) — these require **schema + renderer + Tiptap parity** changes (coordinate with Phases 2 and 4).

## Rules for the agent
1. Do not invent or "improve" the design. If something is ambiguous or missing, ask the owner; record the answer in `docs/design/decisions.md`.
2. All colors, sizes, spacing and motion values live in `tokens.css`. Components consume tokens only — no magic numbers.
3. Self-host fonts; subset them; `font-display: swap`; preload only the critical text face; avoid layout shift (size-adjust/fallback metrics). Heavy CJK fonts must not ship whole — follow the design spec's subsetting guidance.
4. Dark mode: respect `prefers-color-scheme` and offer a manual override persisted client-side; **no flash of wrong theme** (tiny inline script allowed, covered by the Phase 7 CSP via hash). Total public JS budget stays ≤ 3 KB.
5. View Transitions (if specified): progressive enhancement only; fully disabled under `prefers-reduced-motion`.
6. Decide Tailwind vs plain CSS here, based on the design spec; record an ADR. Do not mix paradigms.
7. Syntax highlighting (if specified): perform at **save time** (renderer output stored in `content_html`), never per request; verify CPU/WASM impact and record an ADR. After any renderer change run `pnpm db:rerender`.

## Tasks
1. Implement tokens, base styles and `article.css` exactly per spec.
2. Build layout components and the pages listed above.
3. Implement language switcher and theme toggle (accessible, keyboard operable).
4. Implement any new content nodes with tests (schema, renderer, XSS cases).
5. Add Playwright **visual baselines**: home, post, archive, tag, 404 at 360 / 768 / 1280 px, light and dark; commit snapshots.
6. Verify states: empty archive, very long titles, missing cover, no translation available, 0 tags, ID vs EN text lengths, RTL not required.

## Acceptance criteria
- [ ] Visual baselines match the design spec; owner signs off on screenshots.
- [ ] Contrast meets WCAG AA in both themes; focus indicators visible everywhere; reduced motion honored.
- [ ] Lighthouse mobile Performance ≥ 95 on home and post; CLS ≈ 0; public JS ≤ 3 KB.
- [ ] No hard-coded design values outside `tokens.css`.
- [ ] `docs/phase-reports/03.md` written.
