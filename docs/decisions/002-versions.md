# 002 — Phase 1 pinned versions + doc-verified API corrections

Date: 2026-11-16. Status: accepted.

## Context

Spec 00 §5 requires verifying current docs before use and pinning exact
versions (releases ≥ 2 weeks old, never `latest`). Scaffold day: 2026-11-16,
so the cutoff is 2026-11-01. Spec 00 §1 plans Astro SSR on Workers + Static
Assets with local D1.

## Verified (official docs read at scaffold time)

- Astro Cloudflare adapter (`@astrojs/cloudflare`):
  https://docs.astro.build/en/guides/integrations-guide/cloudflare/
- Deploy to Cloudflare (Workers + Static Assets):
  https://docs.astro.build/en/guides/deploy/cloudflare/
- Workers Static Assets + `assets` wrangler fields:
  https://developers.cloudflare.com/workers/static-assets/
- Wrangler configuration reference (`d1_databases`, `r2_buckets`, `assets`):
  https://developers.cloudflare.com/workers/wrangler/configuration/
- D1 local development (`wrangler dev`, `--local`, `preview_database_id`):
  https://developers.cloudflare.com/d1/best-practices/local-development/
- D1 migrations (`migrations_dir`, `migrations_pattern` for Drizzle layout):
  https://developers.cloudflare.com/d1/reference/migrations/
- Workers Vitest integration (`@cloudflare/vitest-plugin`, `cloudflareTest({ wrangler })`):
  https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/
- Astro sessions disable (`session: false`):
  https://docs.astro.build/en/guides/sessions/#disabling-sessions

## Corrections to plan guesses (follow the docs)

1. **Env access.** Plan guessed `APIContext['locals']` / `getPlatformProxy`.
   Current adapter documents `import { env } from "cloudflare:workers"` only.
   `src/lib/env.ts` is the sole reader; nothing else imports `cloudflare:*`.
2. **Test package.** Plan guessed `@cloudflare/vitest-pool-workers`. The real
   package is `@cloudflare/vitest-plugin` (config `cloudflareTest({ wrangler:
   { configPath } })`, `import { env } from "cloudflare:workers"` in tests,
   needs Vitest ≥ 4.1).
3. **Assets routing.** Plan guessed `not_found_handling: 'single-page-app'`.
   That value is SPA-only; SSR content sites use default worker-fallback
   routing. `wrangler.jsonc` sets `assets: { directory: "./dist", binding:
   "ASSETS" }` per the Astro deploy guide, plus explicit `main` pointing at
   the adapter's unified entrypoint `@astrojs/cloudflare/entrypoints/server`.
4. **Adapter options.** `imageService: "passthrough"` (default is
   `cloudflare-binding`, which would auto-provision an IMAGES binding we don't
   need until Phase 5). `session: false` (opts out of the adapter's default
   session KV provisioning; auth lands in Phase 4).
5. **Node compat.** No `nodejs_compat` flag: no dependency in Phase 1 needs
   Node APIs on the request path.

## Pinned versions (all stable, published ≤ 2026-11-01)

| Package | Pinned | Published |
|---|---|---|
| `astro` | 7.4.4 | 2026-10-28 |
| `@astrojs/cloudflare` | 14.4.3 | 2026-10-28 |
| `typescript` | 5.9.3 | 2026-09-30 |
| `@astrojs/check` | 0.9.12 | 2026-10-21 |
| `vitest` | 4.1.12 | 2026-10-15 |
| `@cloudflare/vitest-plugin` | 1.4.11 | 2026-10-29 |
| `drizzle-orm` | 0.45.4 | 2026-10-08 |
| `drizzle-kit` | 0.31.11 | 2026-09-21 |
| `@biomejs/biome` | 2.6.4 | 2026-10-28 |
| `wrangler` | 4.156.1 | 2026-11-01 |
| `@playwright/test` | 1.64.1 | 2026-10-14 |
| `@cloudflare/workers-types` | 5.20261101.1 | 2026-11-01 |
| `@types/node` | 22.20.5 | 2026-10-01 |
| `tsx` | 4.23.15 | 2026-09-20 |
| `zod` | 4.6.7 | 2026-10-12 |

Node runtime: v26 LTS (`.nvmrc` = `26`). pnpm `12.14.0` via `packageManager`
(released 2026-10-15). Remote D1 `gurat` id
`d1ab1a16-5b6c-42bd-a03c-90962ec9d921` (region APAC).

## Consequences

- No `nodejs_compat` unless a future dependency fails without it (then ADR).
- Test style follows the Workers Vitest integration guide (real local D1, no mocks).
