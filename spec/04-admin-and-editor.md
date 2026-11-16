# Phase 4 — Admin and editor

**Goal:** the owner can sign in (via Cloudflare Access), write, save drafts, preview, publish and unpublish posts in both languages from a browser. Content is saved as JSON and rendered to HTML on the server at save time.

**Depends on:** Phase 2 (Phase 3 recommended before final polish of the writing surface). **Read first:** `00-overview.md`.

## Out of scope

Media upload and picker (Phase 5), revision history, multi-user, comments, redirect manager.

## Tasks

### 4.1 Admin access control (security-critical)

- Protect `/admin*` (pages **and** `/admin/api/*`) with a Cloudflare Access application (document the setup steps in the README; this part is configured in the Cloudflare dashboard by the owner).
- **Defense in depth:** the Worker itself must verify the Access JWT (`Cf-Access-Jwt-Assertion`) on every admin request, so the admin is unreachable on any hostname (including `workers.dev` or preview URLs) without a valid identity.
  - Fetch the team JWKS from `https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`, cache in memory with a TTL, verify signature, `iss`, `aud` (`ACCESS_AUD`), `exp`/`nbf` (use `jose`; verify it runs on Workers).
  - Require the token's email to be in `ADMIN_EMAILS`.
  - Local development bypass is allowed **only** when `import.meta.env.DEV` is true and an explicit env flag is set; it must be impossible to enable in a production build (test this).
- CSRF: all mutating admin endpoints require JSON `Content-Type`, an `Origin` header equal to `SITE_URL`, and `Sec-Fetch-Site: same-origin` when present. Reject otherwise with 403.
- Admin responses: `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`. `robots.txt` disallows `/admin` (Phase 6).

### 4.2 Admin pages (functional, minimal styling using the existing tokens)

- `/admin` — posts table: title, locale, status (draft / published / scheduled), updated, translation indicator, filters by status/locale/tag, search by title.
- `/admin/posts/new`, `/admin/posts/[id]` — editor screen.
- `/admin/preview/[id]` — renders the draft with the **public** components/layout, `noindex`, so what the owner sees equals what readers will see.
- `/admin/tags` — create, rename (EN/ID labels), delete (blocked if in use or with explicit confirm).
- Navigation includes a visible "View site" link and sign-out link (Access logout URL).

### 4.3 Editor (Svelte island, `client:only`)

- Mount Tiptap core directly in a Svelte component. Build the extension list **from `schema.ts`** so the editor can only produce documents the renderer accepts. Add a test that round-trips sample documents (editor → JSON → `validateDoc` → `renderDoc`) and fails on schema drift.
- Writing features: title field, markdown-style input rules and shortcuts, paste cleanup (strip anything outside the schema), live word count and reading time, focus mode (hides chrome), heading levels 2–4, links with protocol validation, code blocks with language attribute.
- **Editing surface uses `article.css` and the same tokens as the public page** so typography is WYSIWYG-faithful.
- Metadata panel: locale, slug (auto from title, editable; show a clear warning when changing the slug of an already published post, since there is no redirect manager), excerpt, SEO description, tags (multi-select), `published_at` picker (future date = scheduled), translation linking: "Create translation" duplicates the document as a new draft in the other locale with the same `translation_group_id`; and "Link existing" for manual pairing.
- **Autosave** drafts debounced (~2 s) with optimistic concurrency: requests include the last known `updated_at`; the server returns 409 on mismatch and the UI shows a non-destructive conflict state (reload / overwrite choice). Show save status (saved / saving / offline / conflict). Warn on leaving with unsaved changes.
- Publish / unpublish / delete (delete requires typed confirmation). Publishing validates required fields (title, slug, non-empty content).

### 4.4 Admin API (`/admin/api/*`)

`POST /posts`, `PUT /posts/:id`, `POST /posts/:id/publish`, `POST /posts/:id/unpublish`, `DELETE /posts/:id`, tag CRUD. All input validated with `zod`.

On every save the server runs: `validateDoc` → resolve referenced media (none yet) → `renderDoc` → persist `content_json`, `content_html`, `toc_json`, `reading_minutes`, update `post_media` links in the same transaction/batch. Errors: 422 with the offending node path for schema violations; 409 for slug or concurrency conflicts.

**CPU risk:** rendering happens once per save, not per read. Measure render time on a 5,000-word document under the Workers runtime. If it threatens the free-tier CPU limit, document an ADR and switch to: render in the browser at save time + strict server-side re-validation of the JSON + server-side re-render only in the background re-render script.

### 4.5 Tests

- Auth: requests without a token, with expired/wrong-audience/wrong-issuer tokens, and with a non-allowlisted email are rejected for pages and API. Use locally generated keypairs and a mocked JWKS.
- API: validation errors, concurrency 409, slug uniqueness, publish/unpublish visibility on public routes.
- Playwright e2e: sign in (dev bypass) → create post → autosave → preview → publish → public page shows it → unpublish → 404.

## Acceptance criteria

- [ ] No admin page or API endpoint responds with anything but a login redirect/401/403 without a valid Access JWT (verified against a production build, not just dev).
- [ ] Dev bypass cannot be enabled in a production build.
- [ ] Editor ↔ renderer schema parity test passes.
- [ ] Two-tab conflict scenario shows the conflict UI and never silently overwrites.
- [ ] Publish makes a post appear on the public site immediately; unpublish makes it 404.
- [ ] Editor controls are labelled, keyboard operable, with visible focus.
- [ ] `docs/phase-reports/04.md` written (including measured render time).
