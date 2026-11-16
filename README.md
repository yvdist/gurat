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
- `src/server/db/` — Drizzle schema, repositories (visibility rule lives here), admin stubs
- `src/i18n/` — `en.json`/`id.json` + `t`/`localizePath`/`detectLocaleFromPath` helpers
- `migrations/` — SQL applied by `wrangler d1 migrations apply`
- `scripts/seed.ts` — emits seed SQL, applied via `wrangler d1 execute --local`
- `tests/` — workerd integration tests (`db`, `i18n`) + Playwright smoke (`e2e/`)
- `docs/decisions/` — ADRs; `docs/phase-reports/` — per-phase acceptance evidence
