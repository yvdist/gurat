# 00 — Overview

> Personal writing site. Read this file first, then only the phase file you are working on.
> Specs are written in English for the agent. The site itself is bilingual (EN / ID).

- **Project name:** `PROJECT_NAME` (placeholder; candidates: yohaku, zuihitsu, oboegaki). Keep it in one config constant (`src/config/site.ts`).
- **Hostname:** a subdomain of `yvdist.com` (`SITE_URL` in config). Owner's portfolio is a separate project and is not touched.
- **Owner:** single author, single admin user.

## 1. What we are building

A personal writing site where the owner writes and publishes essays through **their own admin and editor** (no static Markdown/JSON files as the content source). Public pages must be fast, nearly JavaScript-free and visually crafted. Visual design is **not** specified here; it is delivered later and implemented in Phase 3.

### Goals
- Write → publish from a browser, content stored in a database.
- Public reading experience: fast, accessible, typographically excellent, bilingual (EN default, ID under `/id`).
- Runs entirely on Cloudflare **free tier**; no VPS; ongoing cost ≈ 0.
- A craft project: clean architecture, tests, readable code, documented decisions.

### Non-goals (do not build)
Comments, newsletters, user accounts for readers, multi-author, revision history/collaboration, a plugin system, redirects manager, paid/analytics-heavy features.

## 2. Locked decisions

Do not change these silently. If a decision proves wrong, write `docs/decisions/NNN-title.md` (context, options, choice, consequences), flag it in your phase report, and continue only if the owner agrees.

| Concern | Decision | Notes |
|---|---|---|
| Framework | **Astro** (latest stable at scaffold time), SSR | `@astrojs/cloudflare` adapter |
| Hosting | **Cloudflare Workers with Static Assets** | NOT Cloudflare Pages (Cloudflare recommends Workers for new projects) |
| Database | **Cloudflare D1** (SQLite) | Drizzle ORM + migrations |
| Media | **Cloudflare R2** | Public bucket on a custom domain for derived images |
| Admin UI | Astro pages + **Svelte island** for the editor | Tiptap core mounted directly, no wrapper dependency |
| Content format | **ProseMirror/Tiptap JSON** (source) + server-rendered **HTML** (output) | Rendered once at save time, not per request |
| Admin auth | **Cloudflare Access** in front of `/admin*` **plus** JWT verification inside the Worker | Defense in depth |
| i18n | `en` unprefixed (default), `id` under `/id` | Mirrors the owner's portfolio |
| Package manager / runtime | pnpm, Node LTS (`.nvmrc`) | |
| Styling (Phases 1–2) | Plain CSS with custom properties | Tailwind yes/no is decided in Phase 3 |
| Tests | Vitest (unit/integration), Playwright (e2e/a11y/visual) | |
| IDs / time | `crypto.randomUUID()` text IDs; timestamps as UTC epoch **milliseconds** (INTEGER) | Display timezone configurable, default `Asia/Jakarta` |

## 3. Phases

| # | File | Outcome | Depends on |
|---|---|---|---|
| 1 | `01-foundation-and-data.md` | Scaffold, Workers config, D1 schema, migrations, seed, repositories, i18n core, CI | — |
| 2 | `02-public-reading.md` | Content schema + renderer, public routes served from D1, semantic neutral markup | 1 |
| 3 | `03-design-implementation.md` | **Blocked until the owner delivers the design spec.** Implements the visual design | 2 + design spec |
| 4 | `04-admin-and-editor.md` | Secured admin, Tiptap editor, draft/publish flow | 2 (3 recommended before final admin polish) |
| 5 | `05-media.md` | Upload pipeline, R2, responsive images, media picker | 4 |
| 6 | `06-discovery-and-polish.md` | RSS, sitemap, SEO, OG images, reading UX extras | 2, 5 |
| 7 | `07-hardening-and-ops.md` | CSP, optional caching, backups, perf/a11y gates, DNS + launch | all |

Phases 4 and 3 may run in either order after Phase 2. Do not start a phase before the previous required phase's acceptance criteria pass.

## 4. Proposed repository layout

```
/
├─ src/
│  ├─ config/site.ts            # name, URL, locales, timezone
│  ├─ i18n/                     # en.json, id.json, helpers
│  ├─ lib/content/              # schema.ts, render.ts (pure, no DOM)
│  ├─ lib/env.ts                # typed access to bindings/secrets (isolates adapter API)
│  ├─ server/db/                # drizzle schema, repositories
│  ├─ server/auth/              # Access JWT verification
│  ├─ components/               # Astro components (public + admin)
│  ├─ islands/                  # Svelte islands (editor, media picker)
│  ├─ layouts/
│  ├─ pages/                    # routes (+ pages/id/* or i18n routing)
│  ├─ styles/                   # tokens.css, base.css, article.css
│  └─ middleware.ts
├─ migrations/                  # SQL migrations
├─ scripts/                     # seed, rerender, backup helpers
├─ tests/                       # unit, integration, e2e
├─ docs/decisions/              # ADRs
├─ wrangler.jsonc
└─ README.md
```

## 5. Cross-cutting conventions

- **TypeScript strict.** No `any` without a comment. Validate all external input with `zod`.
- **Verify, don't recall.** Cloudflare and Astro APIs change quickly. Before using any API (bindings access, adapter config, Access, R2 public buckets, Images), read the *current official documentation*. Pin exact dependency versions; prefer releases at least two weeks old; never use `latest` in `package.json`.
- **SQL:** prepared statements with bound parameters only. No string interpolation.
- **Security:** escape by construction; no `set:html` with unsanitized input; admin never reachable without a verified identity.
- **Accessibility:** semantic HTML, visible focus, AA contrast, `prefers-reduced-motion`, correct `lang` on every page.
- **Performance budget (public pages):** 0 KB JS by default (≤ 3 KB total allowed for theme/transition helpers), no layout shift, fonts self-hosted.
- **Cloudflare free-tier realities** (verify current numbers): ~100k Worker requests/day, small per-request CPU time (reported as 10–30 ms), D1 free quotas (5M rows read/day, 100k written/day, 5 GB). Keep per-request work tiny; never put heavy work (WASM image rendering, big parsers) on the request path.
- **Commits:** small, conventional commits. One logical change each.
- **Docs:** update `README.md` and relevant ADRs as you go.

## 6. Environment and bindings

| Name | Type | Used in | Notes |
|---|---|---|---|
| `DB` | D1 binding | all | |
| `MEDIA` | R2 binding | Phase 5 | derived images bucket |
| `MEDIA_BASE_URL` | var | Phase 5 | public base URL, e.g. `https://media.<domain>` |
| `SITE_URL` | var | all | canonical absolute URL |
| `ACCESS_TEAM_DOMAIN` | var | Phase 4 | `<team>.cloudflareaccess.com` |
| `ACCESS_AUD` | var/secret | Phase 4 | Access application AUD tag |
| `ADMIN_EMAILS` | var | Phase 4 | comma-separated allowlist |
| `CF_API_TOKEN`, `CF_ZONE_ID` | secrets | Phase 7 (only if cache purge adopted) | least privilege |

Local secrets go in `.dev.vars` (gitignored). Provide `.dev.vars.example`.

## 7. Working agreement for the agent

1. Read `00-overview.md` and the current phase file only.
2. Plan briefly, then implement in small steps. Run `pnpm check` often.
3. Do not invent visual design. Until Phase 3, UI is neutral, semantic and token-driven.
4. If a spec statement conflicts with reality (API changed, limit differs), stop, document it in an ADR, propose the smallest change, and continue.
5. At the end of each phase produce `docs/phase-reports/NN.md`: what was done, deviations, open issues, how acceptance criteria were verified (commands + results).
6. Never commit secrets, real credentials, or the owner's private content.

## 8. Open questions (defaults apply until answered)

- Project name and final subdomain → use placeholders.
- Is a tag system wanted at launch? → **yes**, minimal.
- Analytics → **off** by default (optional Cloudflare Web Analytics in Phase 6).
- Does the DNS zone for `yvdist.com` already live on Cloudflare? → assume **no**; see Phase 7 checklist.
