# Runbook — backup, restore, rollback

English. Operator procedures for the weekly D1 backup, restore drills, and
deploy rollback. The launch checklist lives in `DEPLOYMENTS.md` (Bahasa
Indonesia) and links here for restore steps — this file is not duplicated
there.

## 1. Weekly backup (automatic)

`.github/workflows/backup.yml` runs every Monday 02:00 WIB (Sunday 19:00
UTC) plus on demand (`workflow_dispatch` — use before risky operations).

1. `wrangler d1 export gurat --remote --output gurat-YYYY-MM-DD.sql`
   (verified against pinned wrangler 4.156.1: `--output` is required).
2. Uploads to the private bucket `gurat-backups` under
   `backups/gurat-YYYY-MM-DD.sql` (`wrangler r2 object put
   gurat-backups/backups/<file> --file <file> --remote`).
3. Retention is a bucket lifecycle rule (keep newest 12), configured once
   by the owner — not per-run listing (wrangler 4.156.1 has no object-list
   query for retention scripting).

Secrets (GitHub repo settings, never echoed, `set -x` off around use):

- `CLOUDFLARE_API_TOKEN` — least privilege: D1 read + R2 write only.
- `CLOUDFLARE_ACCOUNT_ID`.

One-time owner setup (see DEPLOYMENTS.md §7): create the private bucket
`gurat-backups`, add the lifecycle rule (prefix `backups/`, keep 12
newest), store both secrets.

## 2. Restore — tested procedure

Proven locally on 2026-11-17 (9 posts / 4 tags / 10 media rows round-trip;
counts matched before and after — see `docs/phase-reports/07.md`).

**Local drill** (safe, touches only local state):

1. `pnpm exec wrangler d1 export gurat --local --output restore.sql
   --table posts --table tags --table post_tags --table media
   --table post_media`
   - `--table` scoping is required locally: miniflare's exporter cannot
     dump FTS5 virtual tables (`posts_fts`). The exclusion is lossless:
     `posts_fts` is fully derived — structure comes from migration
     `0002_posts-fts.sql`, content from `pnpm db:rerender`.
   - Remote (`--remote`) exports need no scoping: server-side D1 export
     handles virtual tables.
2. Fresh database: stop dev servers, delete the local D1 sqlite under
   `.wrangler/state/v3/d1/`, run `pnpm db:migrate:local`.
3. Import per table in dependency order (the dump's row order can violate
   FK checks under `d1 execute --file`):
   `media → posts → tags → post_tags → post_media`, one
   `pnpm exec wrangler d1 execute gurat --local --file restore-<table>.sql`
   per table (split with `grep 'INSERT INTO "<table>"' restore.sql`).
4. `pnpm db:rerender` to repopulate `posts_fts`.
5. Verify: `SELECT COUNT(*)` per table matches the pre-export counts.

**Remote scratch drill** (owner, before trusting a backup):

1. `wrangler d1 create gurat-restore-scratch` (remote, delete after).
2. Download the backup: `wrangler r2 object get
   gurat-backups/backups/gurat-YYYY-MM-DD.sql --remote --file restore.sql`.
3. Apply migrations to the scratch DB, import per-table as above,
   rerender, compare `SELECT COUNT(*)` against production.
4. `workflow_dispatch` the backup workflow after any restore to confirm
   the pipeline still works end to end.

## 3. Media

The public bucket holds derived variants only. With `KEEP_ORIGINALS=false`
(the default) no originals exist anywhere — losing the bucket means
re-uploading sources (accepted limitation from ADR-005, restated here so
the runbook is self-contained). Variant loss is recoverable from sources;
post rows reference `r2_key_prefix`, so re-uploads restore URLs.

## 4. Deploy rollback

Deploys run via the `deploy.yml` GitHub Action (`wrangler deploy`,
`workflow_dispatch` only — see ADR-006). If a deploy misbehaves:

1. `wrangler versions list` (pinned docs: exact subcommand confirmed
   before the first deploy) to find the last green version.
2. `wrangler rollback` (or `wrangler versions rollback`) to that version,
   then redeploy the last green commit via `workflow_dispatch`.
3. If the schema changed: migrations are additive-only by convention, so
   old code keeps running on the new schema; never roll a migration back.
