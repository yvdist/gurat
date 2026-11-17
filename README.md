# Gurat

Personal bilingual (EN/ID) writing site. Astro SSR on Cloudflare Workers +
Static Assets, D1 via Drizzle, R2 for media (Phase 5).

## Prereqs

- pnpm 12.14.0 (`corepack` or standalone), Node 26 (see `.nvmrc`)
- `wrangler` login only for remote D1 / dry-run deploy (`wrangler login`);
  local dev, migrate, and seed need no account

## Setup

```sh
pnpm install
cp .dev.vars.example .dev.vars   # local-only vars, never commit .dev.vars
pnpm db:migrate:local            # apply migrations to local D1 (re-run = no-op)
pnpm db:seed:local               # idempotent seed (6 posts, 4 tags)
pnpm dev                         # workerd runtime + local D1 (dev/prod parity)
```

## Commands

| Command                  | What                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`               | `astro dev` on workerd with local D1                                                                               |
| `pnpm build`             | production build (`./dist`)                                                                                        |
| `pnpm preview`           | serve the production build locally                                                                                 |
| `pnpm check`             | `astro check` + `biome check .` + `vitest run`                                                                     |
| `pnpm test`              | vitest, real local D1 via `@cloudflare/vitest-plugin`                                                              |
| `pnpm e2e`               | Playwright reading journey on `preview` (needs seed + rerender first)                                              |
| `pnpm db:generate`       | regenerate SQL from `src/server/db/schema.ts`                                                                      |
| `pnpm db:migrate:local`  | apply to local D1                                                                                                  |
| `pnpm db:migrate:remote` | apply to remote D1 (needs login)                                                                                   |
| `pnpm db:seed:local`     | regenerate + apply seed SQL to local D1                                                                            |
| `pnpm db:rerender`       | re-render `content_html`/`toc_json`/`reading_minutes` from `content_json` (idempotent; run after renderer changes) |

## Structure

- `src/config/site.ts` — name, URL, locales, timezone (single constant)
- `src/lib/env.ts` — ONLY reader of the adapter env API (`cloudflare:workers`)
- `src/server/db/` — Drizzle schema, repositories (visibility rule lives here), admin write path
- `src/i18n/` — `en.json`/`id.json` + `t`/`localizePath`/`detectLocaleFromPath` helpers
- `migrations/` — SQL applied by `wrangler d1 migrations apply`
- `scripts/seed.ts` — emits seed SQL, applied via `wrangler d1 execute --local`
- `tests/` — workerd integration tests (`db`, `i18n`) + Playwright smoke (`e2e/`)
- `docs/decisions/` — ADRs; `docs/phase-reports/` — per-phase acceptance evidence

## Admin access (Cloudflare Access)

`/admin*` (pages and `/admin/api/*`) is protected by a Cloudflare Access
application **and** by in-Worker JWT verification (defense in depth: the
Worker rejects unauthenticated requests on any hostname, including
`workers.dev` and preview URLs).

Setup (owner, in the Cloudflare dashboard):

1. Zero Trust → Access → Applications → Add: self-hosted, domain = the site
   host, path = `/admin*`.
2. Policy: allow the owner's email(s).
3. Copy the **Application Audience (AUD) Tag** (Additional settings).
4. Worker vars (dashboard → Workers → Settings → Variables; never commit):
   `ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com`,
   `ACCESS_AUD=<AUD tag>`, `ADMIN_EMAILS=you@example.com`.
5. Sign out: `https://<team>.cloudflareaccess.com/cdn-cgi/access/logout`.

Local dev: copy `.dev.vars.example` to `.dev.vars` and set
`ADMIN_DEV_BYPASS=1` (works only with `astro dev`, never in production
builds — asserted by `tests/auth.test.ts`).

## Media (R2)

Owner uploads images from the editor; the browser pre-generates 480/960/1600px
WebP variants (never upscale, EXIF-free) and the Worker stores them in public
R2 at `media/<id>/<width>.webp` (immutable, `Cache-Control: public,
max-age=31536000, immutable`). Public HTML points at `MEDIA_BASE_URL` — no
Worker invocation per image.

Setup (owner, once):

1. `wrangler r2 bucket create gurat-media` (binding `MEDIA` already declared
   in `wrangler.jsonc`).
2. R2 → bucket → Settings → Custom Domains → connect `media.<domain>`
   (public access; disables Worker-free direct serving otherwise).
3. Worker vars (dashboard, never commit): `MEDIA_BASE_URL=https://media.<domain>`.
   Local dev keeps `MEDIA_BASE_URL=` empty (same-origin `/media/...` served by
   the dev-only route).
4. No CORS setup needed: uploads POST to same-origin `/admin/api/media`;
   images are served off-origin.

Per-env `MEDIA_BASE_URL`:

| Env   | Value                    | Served by               |
| ----- | ------------------------ | ----------------------- |
| local | empty (same-origin)      | dev-only Worker route   |
| prod  | `https://media.<domain>` | public R2 custom domain |

`pnpm media:orphans` lists media rows unreferenced for > 7 days (no writes).
After variant or `MEDIA_BASE_URL` changes, run `pnpm db:rerender`.

## Deploy & backup

Full owner runbook: [`DEPLOYMENTS.md`](DEPLOYMENTS.md) (Bahasa Indonesia —
DNS order, Access, migrate-then-deploy, post-deploy curl checks, launch
checklists) and [`docs/runbook.md`](docs/runbook.md) (English — weekly
backup, tested restore steps, rollback).

Short version: `pnpm db:migrate:remote` first (additive only), then GitHub
Actions → `deploy` → Run workflow (`workflow_dispatch`, runs
`wrangler deploy`). Rollback: `wrangler versions list` →
`wrangler rollback <version-id>` (never roll back a migration). Weekly D1
exports go to the private `gurat-backups` R2 bucket
(`.github/workflows/backup.yml`); local restore proof: 9 posts / 4 tags /
10 media rows round-tripped 2026-11-17.
