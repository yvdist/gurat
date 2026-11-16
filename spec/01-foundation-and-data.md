# Phase 1 — Foundation and data

**Goal:** a runnable Astro-on-Workers skeleton with a D1 schema, migrations, seed data, a typed data layer, i18n core and CI. No real UI yet.

**Depends on:** nothing. **Read first:** `00-overview.md`.

## Out of scope
Rendering content, admin, editor, media upload, any visual design.

## Tasks

### 1.1 Scaffold
- Create the Astro project (latest stable), `output: 'server'`, `@astrojs/cloudflare` adapter, TypeScript `strict`, pnpm, `.nvmrc` (Node LTS).
- Install and configure: Vitest, Playwright (smoke only for now), one linter/formatter (Biome **or** ESLint + Prettier; record the choice in an ADR).
- Scripts: `dev`, `build`, `preview`, `check` (= `astro check` + lint + unit tests), `db:migrate:local`, `db:migrate:remote`, `db:seed:local`, `test`, `e2e`.

### 1.2 Workers configuration
- `wrangler.jsonc` for a **Worker with static assets** (not Pages). Compatibility date = the day you scaffold. Enable Node compat flags only if a dependency needs them (record why).
- Declare bindings: D1 `DB`, R2 `MEDIA` (declared now, unused until Phase 5).
- Create `src/lib/env.ts`: a single typed accessor for bindings/vars/secrets, implemented with whatever the **current** adapter documents. No other file touches adapter-specific env APIs.
- Local dev must run inside the Workers runtime (dev/prod parity) with a local D1.

### 1.3 Schema and migrations
Use Drizzle ORM (D1 driver) for schema + types; generate SQL migrations into `/migrations` and apply with Wrangler's D1 migrations. If this flow proves awkward, document an ADR and fall back to hand-written SQL migrations with typed prepared-statement helpers.

Initial schema (create tables in this order: media, tags, posts, post_tags, post_media):

```sql
CREATE TABLE media (
  id TEXT PRIMARY KEY,
  r2_key_prefix TEXT NOT NULL UNIQUE,      -- e.g. media/<id>/
  mime TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  alt_default TEXT NOT NULL DEFAULT '',
  dominant_color TEXT,                     -- '#rrggbb'
  variants_json TEXT NOT NULL DEFAULT '[]',-- [{w,key,bytes,mime}]
  created_at INTEGER NOT NULL
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  label_en TEXT NOT NULL,
  label_id TEXT NOT NULL
);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  locale TEXT NOT NULL CHECK (locale IN ('en','id')),
  translation_group_id TEXT,               -- posts sharing a value are translations
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  published_at INTEGER,                    -- epoch ms; may be in the future (scheduled)
  content_json TEXT NOT NULL,              -- source of truth
  content_html TEXT NOT NULL DEFAULT '',   -- rendered at save time
  toc_json TEXT NOT NULL DEFAULT '[]',
  reading_minutes INTEGER NOT NULL DEFAULT 1,
  cover_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  seo_description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (locale, slug)
);
CREATE UNIQUE INDEX posts_translation_unique
  ON posts (translation_group_id, locale) WHERE translation_group_id IS NOT NULL;
CREATE INDEX posts_feed_idx ON posts (locale, status, published_at DESC);

CREATE TABLE post_tags (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE post_media (                    -- maintained on save; blocks deleting referenced media
  post_id  TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE RESTRICT,
  PRIMARY KEY (post_id, media_id)
);
```

**Visibility rule (single source of truth, implement once in the data layer):**
a post is public iff `status = 'published' AND published_at <= now`. This also gives scheduled publishing for free, no cron needed.

### 1.4 Data layer (`src/server/db/`)
Typed repository functions, each with unit/integration tests against a **real local D1** (prefer Cloudflare's Workers Vitest pool; verify current docs) rather than mocks:
- `listPublishedPosts({ locale, tagSlug?, limit, cursor? })` — cursor pagination by `(published_at, id)`.
- `getPublishedPostBySlug(locale, slug)` including tags and translation alternates.
- `getTranslations(groupId)`.
- `listTags(locale)` (with published post counts).
- Stubs/types for admin functions (implemented in Phase 4).

### 1.5 Seed
`pnpm db:seed:local` inserts: 6 posts (3 EN, 3 ID; two linked translation pairs), 4 tags, 1 draft, 1 post scheduled in the future, 1 post with a very long title. `content_json` uses a minimal valid doc (paragraphs/headings); `content_html` may be a placeholder until Phase 2 adds `pnpm db:rerender`.

### 1.6 i18n core
- `src/config/site.ts`: locales `['en','id']`, default `en` (no prefix), `id` at `/id`, timezone `Asia/Jakarta`.
- Helpers: `localizePath(path, locale)`, `detectLocaleFromPath`, `alternatesFor(post)`.
- UI string dictionaries `src/i18n/en.json`, `id.json` with a typed `t(key)`; a test fails if keys differ between files.

### 1.7 CI
GitHub Actions: install (frozen lockfile), `pnpm check`, `pnpm build`. Cache pnpm store. Deployment is **not** automated yet.

### 1.8 README
Setup, commands, how to run migrations/seed locally, project structure.

## Acceptance criteria
- [ ] `pnpm install && pnpm dev` runs inside the Workers runtime with local D1.
- [ ] Migrations apply from an empty database; re-running is a no-op.
- [ ] `pnpm db:seed:local` works; repository tests prove: drafts and future-dated posts are never returned by public queries; cursor pagination is stable; unique constraints (`locale+slug`, translation group) are enforced.
- [ ] `pnpm check` and `pnpm build` pass locally and in CI.
- [ ] `wrangler deploy --dry-run` succeeds.
- [ ] No file other than `src/lib/env.ts` reads bindings directly.
- [ ] `docs/phase-reports/01.md` written.
