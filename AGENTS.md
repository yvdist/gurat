# AGENTS.md — Gurat (live site)

## What this is

Personal bilingual (EN/ID) writing site. Astro SSR on Cloudflare Workers +
Static Assets, D1 via Drizzle, R2 for media. All 7 build phases are done and
merged to `main`; the site is live at `https://gurat.yvdist.com`. Work now is
operations, fixes, and redesign — not phased builds.

## Read first

- `spec/00-overview.md` (locked decisions, conventions — still authoritative)
- `DEPLOYMENTS.md` (owner runbook, Bahasa Indonesia: deploy, DNS, checklists)
- `docs/runbook.md` (English: backup, tested restore, rollback)
- `docs/decisions/` (ADRs 001–006; check before relitigating anything)
- `docs/phase-reports/07.md` (latest acceptance evidence + known limitations)

`spec/01–07.md` are archived per-phase briefs (all complete). Read them only
for archaeology, never as scope authority. `docs/design/*` + `docs/ui-ux/`
are the design source (relevant for redesign work).

## Commands

`pnpm dev` (workerd + local D1) · `pnpm check` (= `astro check` + `biome check .` + `vitest run`) ·
`pnpm build` · `pnpm test` · `pnpm e2e` ·
`pnpm types` (regenerate gitignored `src/worker-configuration.d.ts` — required for `astro check`) ·
`pnpm db:migrate:local|remote` · `pnpm db:seed:local`

Deploy: owner runs `pnpm db:migrate:remote` first, then GitHub Actions →
`deploy` workflow (`workflow_dispatch`, `wrangler deploy --keep-vars`).
Never touch dashboard vars from code or CI.

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
  Additive only — old code must keep running on the new schema.
- `compatibility_date` is `2026-10-30` (max the pinned workerd supports), not
  scaffold day. `wrangler.jsonc` `main` is the adapter entrypoint
  `@astrojs/cloudflare/entrypoints/server`.
- pnpm 12 reads `pnpm-workspace.yaml` (`allowBuilds`, `overrides`), NOT a `pnpm`
  field in `package.json`. `@cloudflare/vite-plugin` is override-pinned to
  1.66.0 (adapter's `^1.63.1` range floats to 1.69.x, which needs wrangler
  ^4.160 — past the version cutoff).
- Scripts use `pnpm exec <bin>` (bare bins fail under `pnpm run` on Windows).
- Biome `recommended` preset; verify with output (`Checked N files`), never
  trust empty output. `*.astro` override disables `noUnusedImports`
  (Biome can't see frontmatter use in markup — imports there ARE used).
- Commit messages MUST follow Conventional Commits: `type(scope): subject`,
  one logical change per commit (`feat`, `fix`, `docs`, `test`, `refactor`,
  `chore`). Scope is the area (`deploy`, `admin`, `media`, `e2e`). NEVER
  rewrite published history without owner approval.
- Dashboard is the single source of truth for Worker vars (`wrangler.jsonc`
  has NO `vars` block; deploy uses `--keep-vars`). A vitest guard
  (`tests/config.vars-guard.test.ts`) fails if a `vars` block returns.
  NEVER add vars to `wrangler.jsonc` or deploy without `--keep-vars`
  (2026-11-18 incident: deploy wiped `ACCESS_*`/emails to `""`).
- D1 export cannot dump FTS5 virtual tables (local or remote) — always use
  `--table` scoping, exclude `posts_fts` (derived; rebuilt by rerender).
  Remote export needs a D1 **Edit** token (Read gets error 10000).
- R2 lifecycle rules expire by object **age** only (`--expire-days`) — there
  is no keep-N option. Backup retention = 84-day expiry ≈ 12 weekly dumps.
- Doc claims about dashboard/API capabilities MUST be verified against
  pinned-tool `--help` or official docs before writing them down.
