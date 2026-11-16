# AGENTS.md — Gurat (Phase 1)

## What this is

Personal bilingual writing site. Phase 1 = runnable Astro SSR skeleton on
Workers + D1 schema/migrations/seed + typed repositories + i18n core + CI.
No rendering, admin, editor, media, or visual design.

## Read first

- `spec/00-overview.md` (locked decisions, conventions)
- `spec/01-foundation-and-data.md` (sole scope authority for this phase)
- `docs/decisions/002-versions.md` (pinned versions + doc-verified API corrections)
- `docs/phase-reports/01.md` (acceptance evidence)

## Commands

`pnpm dev` (workerd + local D1) · `pnpm check` (= `astro check` + `biome check .` + `vitest run`) ·
`pnpm build` · `pnpm test` · `pnpm e2e` ·
`pnpm db:migrate:local|remote` · `pnpm db:seed:local`

## Conventions

- TypeScript strict; no `any` without comment. SQL only via bound parameters
  (`inArray`, `eq`, … — never string interpolation).
- Env isolation: only `src/lib/env.ts` imports `cloudflare:workers`. Repos take
  `D1Database`/`Db` params. Tests import `cloudflare:workers` per the Workers
  Vitest guide (test-only exception).
- Visibility rule lives once in `src/server/db/posts.ts` (`visibilityFilter`):
  `status = 'published' AND published_at <= now`. No other file writes
  post-visibility SQL.
- Migrations: edit `src/server/db/schema.ts`, run `pnpm db:generate`, apply with
  `wrangler d1 migrations apply gurat --local`. Flat `migrations/*.sql` layout.
- `compatibility_date` is `2026-10-30` (max the pinned workerd supports), not
  scaffold day. `wrangler.jsonc` `main` is the adapter entrypoint
  `@astrojs/cloudflare/entrypoints/server`.
- pnpm 12 reads `pnpm-workspace.yaml` (`allowBuilds`, `overrides`), NOT a `pnpm`
  field in `package.json`. `@cloudflare/vite-plugin` is override-pinned to
  1.66.0 (adapter's `^1.63.1` range floats to 1.69.x, which needs wrangler
  ^4.160 — past the version cutoff).
- Scripts use `pnpm exec <bin>` (bare bins fail under `pnpm run` on Windows).
- Biome `recommended` preset; `*.astro` override disables `noUnusedImports`
  (Biome can't see frontmatter use in markup — imports there ARE used).
