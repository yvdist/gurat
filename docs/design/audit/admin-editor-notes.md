# Admin + editor rebuild — audit notes

Side-by-side evidence vs `docs/design/reference/` (`Admin — dashboard@1x.png`,
`Editor — writing-first@1x.png`), per plan Step 5. Report only — no new scope.

## Verification (2026-11-19, seeded local)

- `pnpm exec astro check` — 0 errors.
- `pnpm exec vitest run` — 135/135 passed (incl. `security.csp.test.ts` 7/7).
- `pnpm exec biome check .` — clean.
- `pnpm exec playwright test --project=admin` — 5/5 passed
  (create→autosave→preview→publish→200→unpublish→404, two-tab 409, og image,
  hardened CSP variant, media EXIF→responsive + CLS≈0).
- Budget/axe/chromium suites: unchanged surfaces, not re-run here (no public
  markup touched except shared wordmark reuse).

## Reference fidelity

| Reference element                                                                                     | Shipped | Notes                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| Sidebar `gurat` + underline stroke, DASHBOARD/POSTS/TAGS/MEDIA/SETTINGS, VIEW SITE ↗, email, SIGN OUT | yes     | Shared `Wordmark.astro`; email wraps (`overflow-wrap: anywhere`), sidebar scrolls (`overflow-y: auto`) |
| Date line + `Dashboard` H1 + search + `[+ NEW POST]`                                                  | yes     | Live weekday date, GET to `/admin/posts?q=`                                                            |
| Metric strip DRAFTS/SCHEDULED/PUBLISHED/MISSING TR                                                    | yes     | `countAdminMetrics`; null-group + singleton = missing                                                  |
| CONTINUE WRITING card (cover, DRAFT·EN·WORDS·SAVED AGO, OPEN EDITOR →)                                | yes     | Hidden when no draft                                                                                   |
| Recent rows (thumb 56px, EN ⇄ ID / EN ✕ ID, ●/○/◐, date) + ALL POSTS →                                | yes     | Shared `AdminPostRow.astro`, reused by `/admin/posts`                                                  |
| NEEDS ATTENTION (missing=1 / nocover=1 links)                                                         | yes     | Hidden when both zero                                                                                  |
| FREE-TIER USAGE meters + sample caption                                                               | yes     | Static samples, no Cloudflare API (by design)                                                          |
| RECENT UPLOADS 2×2                                                                                    | yes     | Hidden when empty                                                                                      |
| Editor top bar (← ALL POSTS, ticking status, PREVIEW, black PUBLISH + checklist)                      | yes     | Checklist: title/slug/body required, cover/translation warnings                                        |
| WYSIWYG canvas, cover banner, H1 + italic subtitle                                                    | yes     | `article.css` shared with public renderer                                                              |
| Bubble menu (B I link H2 “ ”), figure switcher INLINE/WIDE/FULL/PAIR, inline caption                  | yes     | Custom Svelte positioning, no new deps                                                                 |
| Slash menu (inline/full/pair image, divider, sidenote; ↑↓/Enter/Esc)                                  | yes     | Custom keydown combobox, same insert commands                                                          |
| Bottom bar (WORDS·MIN READ, F FOCUS, / INSERT, ⌘P PREVIEW)                                            | yes     | `Ctrl+P` on Win/Linux                                                                                  |
| DETAILS slide-over (language, slug, excerpt, tags chips, now/schedule, SEO, OG, translation, danger)  | yes     | Overlay right on ≤900px; legacy compat selects hidden off-screen                                       |
| PREVIEW (68ch/desktop, 390px/mobile) matching `/admin/preview/[id]`                                   | yes     | `renderDoc` client-side                                                                                |

## Deviations / known issues

1. **OFFSET + TRIPTYCH absent from the figure switcher** (brief: `unverified —
   confirm first`). Insertable via slash/paste, render correctly; switcher
   offers INLINE/WIDE/FULL/PAIR only. Recorded, not narrowed.
2. **Seed posts carry no `coverMediaId`** — dashboard/list thumbs render empty
   boxes on seeded data. UI handles null covers; real data unaffected.
3. **Admin CSP is `script-src 'self'` + 3 pinned Astro dev hashes in DEV only**
   (`adminCsp(isDev)`); production stays hash-free. Re-verify hashes after any
   Astro upgrade or project move (toolbar payload embeds the project path).
4. **`admin.spec.ts`/`media.spec.ts` updated for the new UI**: publish/unpublish
   stay on the edit page (no redirect); DETAILS opened before meta fills; image
   insert via slash menu; media cleanup re-enters the edit page after the CLS
   pass. Old redirect expectations removed deliberately.
5. **`package.json#db:seed:local`** now removes `.seed.sql` via `node -e
   rmSync` (Windows-safe; was bare `rm -f`).
6. **Round 2 not run**: single verification pass; no impeccable
   `critique`/`audit`/`polish` loop executed. Leftovers above are recorded,
   not silently narrowed.
