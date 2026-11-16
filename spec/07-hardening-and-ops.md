# Phase 7 — Hardening, operations and launch

**Goal:** make the site safe, observable, backed up and deployable, then launch on the real domain.

**Depends on:** all previous phases. **Read first:** `00-overview.md`.

## Tasks

### 7.1 Security headers and CSP
- Strict `Content-Security-Policy` on public pages: `default-src 'self'`; `img-src 'self'` + `MEDIA_BASE_URL` origin (+ `data:` only if needed for placeholders); `style-src 'self'`; `script-src 'self'` plus a **hash** for the tiny theme script if Phase 3 added one; `frame-ancestors 'none'`; `base-uri 'none'`; `form-action 'self'`. If analytics are enabled, add only its required origin.
- Separate, stricter-but-sufficient CSP for admin (the editor island needs scripts from `'self'`; no remote origins).
- Keep Phase 2 baseline headers. HSTS is configured at the Cloudflare edge (document it).
- Playwright test asserts the headers on public and admin responses and that the CSP produces no console violations on key pages.

### 7.2 Caching (optional — decision gate)
D1 read quotas and the Worker request quota are large relative to a personal blog, so **start without caching**. Adopt only if measurements justify it.
- Measure: p95 TTFB for home/post, daily Worker requests and D1 reads under realistic traffic (e.g. a share spike simulation).
- If adopting: use `Cache-Control: public, s-maxage=…, stale-while-revalidate=…` on public HTML and **purge by URL through the Cloudflare API** after publish/unpublish/edit/delete (post, home, archive, tag pages, both feeds, sitemap, and the translated counterpart). Note that the Workers `caches.default` API is per data center and does **not** purge globally — verify current behavior in the docs before relying on it.
- Write an ADR with the numbers and the chosen TTLs. Acceptance when adopted: after publish, the change is visible on the public URL within an agreed window (default ≤ 5 s for the owner's first request after purge) and no stale content survives beyond the TTL.

### 7.3 Backups
- Scheduled GitHub Action (weekly, plus manual dispatch): `wrangler d1 export --remote` → upload the SQL dump to a **private** R2 bucket (`backups/YYYY-MM-DD.sql`), keep the last 12, delete older.
- Least-privilege API token stored as a GitHub secret; never printed in logs.
- Document and **actually test** a restore into a scratch D1 database; record the steps in `docs/runbook.md`.
- Media: document that the public bucket holds only derived variants; if `KEEP_ORIGINALS` is enabled, include the originals bucket in the backup/retention plan.

### 7.4 Observability and errors
- Enable Workers Logs within free-tier limits (sampling if needed); structured logs, no personal data, no tokens.
- Friendly localized 500 page; unexpected errors logged with a request id.
- A simple health route (`/healthz`) that checks D1 connectivity, `noindex`, no sensitive output.

### 7.5 Quality gates
Add to CI (fail the build on regression):
- Lighthouse CI on home and a long post (mobile): Performance ≥ 95, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 95.
- axe-core via Playwright on home, archive, post, tag, 404 in both locales and both themes.
- Budgets: public post page HTML + CSS ≤ 50 KB (excluding images), JS ≤ 3 KB.
- Dependency audit (`pnpm audit`) reported, with an allowlist file for accepted findings.

### 7.6 Deployment pipeline
- Choose and record in an ADR: Workers Builds Git integration **or** a GitHub Action running `wrangler deploy`.
- Secrets via `wrangler secret` (production) and `.dev.vars` (local). No secrets in the repo.
- **Migrations are applied explicitly** by the owner before deploying (`pnpm db:migrate:remote`), preferably additive and backward compatible; document the order in the runbook.
- Rollback: documented procedure to redeploy/roll back to a previous Worker version.
- Decide how `workers.dev` and preview URLs are handled (disable, or protect with Access). Admin is safe regardless because of Phase 4 JWT verification — add a test/checklist item confirming it.

### 7.7 Domain and DNS (checklist — do in this order)
1. Export/screenshot **all** existing DNS records of `yvdist.com` (A/AAAA/CNAME/MX/TXT/CAA…).
2. Add the zone to Cloudflare (free plan); recreate every record exactly; keep the portfolio and other subdomains' records intact (use "DNS only" where the target platform requires it; verify email-related records especially).
3. Lower TTLs beforehand; switch nameservers at the registrar; wait for propagation; verify the portfolio and every existing subdomain still work.
4. Attach the custom domain for the Worker (`<sub>.yvdist.com`) and the R2 public bucket domain (`media.yvdist.com`).
5. Create the Cloudflare Access application for `/admin*`; set `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ADMIN_EMAILS`.
6. Verify TLS, redirects (www/non-www if relevant), HSTS.

### 7.8 Launch checklist
- [ ] Production D1 migrated; owner can sign in through Access; non-allowlisted account is refused.
- [ ] First real post published in EN and ID with translation linked; feeds and sitemap correct.
- [ ] Search Console (and Bing Webmaster) verified, sitemap submitted.
- [ ] Backup workflow ran once successfully; restore tested.
- [ ] README documents: local dev, deploy, migrations, backup/restore, and the writing workflow.
- [ ] `docs/phase-reports/07.md` written, with a final summary of deviations and known limitations.

## Acceptance criteria
- [ ] CSP/headers tests pass; no violations on key pages.
- [ ] CI quality gates are green and enforced.
- [ ] Backup + restore verified end to end.
- [ ] Site live on the real subdomain; admin reachable only via Access; media served from the media domain with immutable caching.
