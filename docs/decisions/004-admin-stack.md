# 004 — Phase 4 admin stack: Svelte, Tiptap, jose

Date: 2026-11-17. Status: accepted.

## Context

Spec 04 adds an owner-only admin surface (dashboard, editor, preview, tags)
and server-side Access JWT verification. Phase 4 needs: a Svelte island
renderer in Astro, a browser rich-text editor whose output the server already
accepts (`src/lib/content/schema.ts` allowlist), and JWT verification that
runs on workerd.

## Decision

Pin (all stable, published ≤ 2026-11-01 cutoff, ≥ 2 weeks old at plan date
2026-11-17):

| Package                  | Pinned | Published  |
| ------------------------ | ------ | ---------- |
| `svelte`                 | 5.57.3 | 2026-10-26 |
| `@astrojs/svelte`        | 9.1.2  | 2026-10-28 |
| `@tiptap/core`           | 3.32.2 | 2026-10-30 |
| `@tiptap/starter-kit`    | 3.32.2 | 2026-10-30 |
| `@tiptap/extension-link` | 3.32.2 | 2026-10-30 |
| `jose`                   | 6.2.14 | 2026-10-29 |

Pins go in `package.json` (exact, no ranges). No new `allowBuilds` entries:
none of the six packages need postinstall builds (verified — `pnpm add`
succeeded without `allowBuilds` prompts; `esbuild`/`workerd` entries in
`pnpm-workspace.yaml` unchanged).

Only config change: register `@astrojs/svelte` in `astro.config.mjs`
(no other config change).

## Why these

- **Access JWT verification → `jose`.** The Cloudflare Access docs'
  own Workers example validates the `Cf-Access-Jwt-Assertion` header with
  `jwtVerify(token, createRemoteJWKSet(...), { issuer, audience })` from
  `jose`. Zero dependencies, tree-shakeable ESM, and Cloudflare Workers is
  a listed supported runtime (WebCrypto + fetch based).
- **Editor → Tiptap core mounted directly in a Svelte component.**
  Spec 00 forbids wrapper deps; the Tiptap Svelte install doc mounts
  `new Editor({ element, extensions: [StarterKit, ...] })` inside
  `onMount` with Svelte 5 runes — exactly the pattern Phase 4 uses.
  `StarterKit` supplies markdown input rules, shortcuts, and paste
  handling (no reimplementation). `Link` extension is configured
  separately (`openOnClick: false`) so link attributes stay within the
  schema allowlist. Custom nodes (sidenote/footnote/pullquote/figure) are
  local `Node` extensions, not extra deps.
- **Svelte 5.57.3 + `@astrojs/svelte` 9.1.2.** Only `client:` island in the
  project; `client:only="svelte"` keeps Tiptap out of SSR/prerender so the
  public pages keep their 0-JS budget. Peer range (`svelte ^5.43.6`,
  `astro ^7.0.0`) satisfied.

## Doc URLs (verified at decision time)

- Access JWT validation (header, JWKS URL, rotation, jose Workers example):
  https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- `jose` supported runtimes (incl. Cloudflare Workers) + zero-dep ESM:
  https://github.com/panva/jose#supported-runtimes
- Tiptap Svelte integration (core-mounted, Svelte 5 runes):
  https://tiptap.dev/docs/editor/getting-started/install/svelte

## Consequences

- `jose` JWKS: module-cached `createRemoteJWKSet` per team domain, 6 h TTL;
  refetch once on `kid` miss (rotation: 6-week cycle, old key valid 7 d).
- Tiptap bundle is admin-only; public pages unaffected (separate island
  chunk, `client:only` non-SSR).
- Fallback (not taken): if `jwtVerify`/`createRemoteJWKSet` failed on
  workerd, manual fetch-certs + imported-JWK `jwtVerify`. `jose` is
  doc-verified for Workers, so implementer proceeds without the fallback.
