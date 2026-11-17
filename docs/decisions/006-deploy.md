# 006 — Deploy via GitHub Action running `wrangler deploy` (not Workers Builds)

Date: 2026-11-17. Status: accepted.

Docs verified at decision time (2026-11-17, pinned wrangler 4.156.1):

- `wrangler deploy [path]` — deploys a Worker to Cloudflare
  (`pnpm exec wrangler deploy --help`).
- `wrangler rollback [version-id]` — rolls a deployment back to a prior
  Worker version (`pnpm exec wrangler rollback --help`).
- `wrangler versions list` — lists the 10 most recent Worker versions
  (`pnpm exec wrangler versions --help`).

## Context

Spec `07-hardening-and-ops.md` orders an explicit owner-run
`pnpm db:migrate:remote` before deploy, and requires a rollback procedure in
the runbook. Two deployment shapes were available.

## Decision

**GitHub Action running `wrangler deploy`** (`.github/workflows/deploy.yml`,
`workflow_dispatch` only):

1. The spec's order — check → build → migrate (owner, explicit) → deploy —
   maps onto Action steps with no Cloudflare git access to manage.
2. Rollback is `wrangler rollback <version-id>` from `wrangler versions
   list`, then redeploy of the last green commit (steps in `docs/runbook.md`
   §4). Additive-only migrations keep old code running on the new schema,
   so rollback never touches the database.
3. **Rejected: Workers Builds git integration.** It would deploy on push
   without the explicit migrate-first gate, and adds a Cloudflare-side git
   permission for zero gain on a personal site.

## Consequences

- `workers.dev` stays enabled. Safety rests on Phase-4 JWT (host-independent,
  unit-covered in `tests/auth.test.ts`); the post-deploy checklist curls
  `/admin/api/*` on the `workers.dev` URL expecting 401 without a token.
  Disabling it would remove preview URLs for zero security gain — stated here
  so it is not relitigated.
- The Action needs `CLOUDFLARE_API_TOKEN` with Workers deploy scope
  (plus `CLOUDFLARE_ACCOUNT_ID`).
