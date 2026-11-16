# Phase 2 — Content model and public reading

**Goal:** the public site works end to end from D1 data: a strict content schema, a pure renderer, and all reader-facing routes with neutral, semantic, token-driven markup.

**Depends on:** Phase 1. **Read first:** `00-overview.md`.

## Out of scope
Visual design (Phase 3), admin/editor (Phase 4), media upload (Phase 5), RSS/OG/sitemap (Phase 6), caching (Phase 7).

## Tasks

### 2.1 Content schema (`src/lib/content/schema.ts`)
The document format is ProseMirror/Tiptap JSON restricted to an explicit allowlist. This module is the **single source of truth**; the editor (Phase 4) derives its extensions from it.

- **Nodes:** `doc`, `paragraph`, `heading` (levels 2–4 only; `h1` is reserved for the post title), `blockquote`, `bulletList`, `orderedList`, `listItem`, `codeBlock` (attr `language`), `horizontalRule`, `hardBreak`, `figure` (attrs `mediaId`, `alt`, `caption`, `layout: 'inline'|'wide'|'full'`; used from Phase 5), `text`.
- **Marks:** `bold`, `italic`, `code`, `link` (attrs `href`, optional `title`).
- Export a `zod` validator `validateDoc(json)` that rejects unknown nodes/marks/attrs with a path-aware error.
- Reserve a clear extension point for future nodes (`footnote`, `pullquote`, `callout`) without implementing them.

### 2.2 Renderer (`src/lib/content/render.ts`)
A **pure function, no DOM, no Node-only APIs**, safe to run on Workers:

```ts
renderDoc(doc, ctx): { html: string; toc: {id:string;text:string;level:number}[]; plainText: string; readingMinutes: number }
```
- `ctx` carries `locale` and `media: Map<id, MediaRow>` (for figures; may be empty in this phase).
- Escape all text and attribute values by construction. Links: allow `http`, `https`, `mailto`, and relative URLs only; external links get `rel="noopener noreferrer"`. Anything else is rendered as plain text.
- Headings get stable, deduplicated slug ids and appear in `toc`. (Anchor-link affordances are a design concern.)
- Code blocks: `<pre><code class="language-x">` with escaped text. Syntax highlighting is decided in Phase 3 (if added it runs at save time, never per request).
- Reading time: word count via `Intl.Segmenter` for the post locale; 200 wpm; minimum 1.
- Unknown node/mark ⇒ throw a typed error (never silently drop content).
- Script `pnpm db:rerender` re-renders every post from `content_json` (needed whenever the renderer changes). Update the seed to use real docs and run it.

### 2.3 Routes (EN unprefixed; ID under `/id`)
| Route | Content |
|---|---|
| `/` | Short intro (from i18n strings) + latest 10 public posts |
| `/writing` | Archive grouped by year, cursor-paginated |
| `/writing/[slug]` | Post page |
| `/tags` and `/tags/[slug]` | Tag index; posts for a tag |
| `/about` | Static page in the repo (both languages) |
| 404 | Localized not-found page |

Rules:
- Non-public posts (draft, future-dated, wrong locale) return 404 — never 403/redirect.
- Post page shows: title (`h1`), `<time datetime>` formatted in the configured timezone and locale, reading time, tags, excerpt-less body from `content_html`, link to the other-language translation if one exists (otherwise link to that locale's home).
- `<html lang>` correct per page; `<head>` has `title`, `meta description` (from `seo_description` or excerpt), canonical, `hreflang` alternates for linked translations (+ `x-default`).
- Serve `content_html` via a single, clearly named `<ArticleBody>` component — the only place `set:html` is used, with a comment explaining why it is safe (output of `renderDoc`).

### 2.4 Markup and CSS skeleton
- Semantic landmarks: skip link, `header`, `nav`, `main`, `article`, `footer`; one `h1` per page.
- Styles live in `src/styles/`: `tokens.css` (custom properties: colors, spacing scale, type scale, measure, radii, motion durations — **neutral placeholder values**), `base.css` (reset + element defaults), `article.css` (typography for rendered article HTML; this stylesheet is later shared with the editor in Phase 4).
- Mark every placeholder decision with `/* DESIGN: Phase 3 */`. Do not make aesthetic choices beyond a readable neutral default (system font stack, ~65ch measure, comfortable line height, light + dark via `prefers-color-scheme`).
- **No client-side JavaScript** on public pages in this phase.

### 2.5 Baseline response headers (middleware)
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, minimal `Permissions-Policy`, `X-Frame-Options`/`frame-ancestors` equivalent. Full CSP is Phase 7.

### 2.6 Tests
- Renderer: golden-file tests for every node/mark; XSS suite (script tags in text, `javascript:` and `data:` hrefs, attribute injection via alt/caption/language, nested marks); unknown node rejected; heading id dedup; reading time for EN and ID samples.
- Routes: visibility rules (draft, future, wrong locale), pagination, hreflang symmetry, 404 localization.
- Playwright smoke: home → post → switch language → tag page.

## Acceptance criteria
- [ ] All routes render from seeded D1; drafts and future-dated posts 404 in both locales.
- [ ] Renderer is pure, has no DOM/Node-only dependency, and passes the XSS suite.
- [ ] Post page ships **0 bytes of JS**; `hreflang`/canonical correct; one `h1`; Lighthouse Accessibility ≥ 95 and SEO ≥ 95 on home and post.
- [ ] `pnpm db:rerender` is idempotent.
- [ ] `docs/phase-reports/02.md` written.
