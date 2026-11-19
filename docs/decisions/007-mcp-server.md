# 007 — MCP server as a separate Worker, bearer-token auth, draft-only tools

Date: 2026-11-19. Status: accepted.

## Context

Owner wants any MCP-capable AI provider (Claude, Gemini, agent harnesses) to
generate post drafts for the site. Owner reviews in the `/admin` editor before
publishing. v1 ships post tools now so it is usable immediately; media/tags
read tools are deferred, not dropped. Tech stack stays 100% TypeScript.

## Options considered

1. **Where the MCP endpoint lives**: separate Cloudflare Worker (`mcp/`, own
   `wrangler.jsonc`, same D1) vs. mounting the MCP handler inside the Astro
   Worker. The Astro adapter owns `fetch` on the main Worker; mounting MCP
   there risks routing/SSE conflicts (unverified — avoided rather than
   proven). A separate Worker keeps the main site untouched and lets each
   Worker deploy independently.
2. **Auth**: bearer token vs. OAuth (`workers-oauth-provider`). Single owner,
   no login UX needed — a dashboard-held secret is enough. OAuth is the
   documented upgrade path if multi-user ever arrives.
3. **Scope**: draft-only tools vs. full publish/unpublish/delete. Token leak
   must never publish: the repo layer (`createPost` hardcodes
   `status: "draft"`) enforces draft-only, and no publish tool ships.
4. **Content format**: model sends Tiptap JSON directly (validated by the
   existing zod `DocSchema`) vs. markdown with a server converter. No markdown
   converter exists — new code with no equivalent, so direct JSON wins.

## Decision

Separate `gurat-mcp` Worker exposing a Streamable HTTP MCP endpoint with
bearer-token auth (`MCP_BEARER_TOKEN` via dashboard secret, never in config),
backed by the same D1 database. Five tools only: `list-posts`, `get-post`,
`create-draft`, `update-draft`, `list-tags`. `update-draft` refuses published
posts. A `gurat://schema/content-blocks` resource teaches the model the Tiptap
allowlist. Main Astro Worker untouched except a shared-env type addition.

## Consequences

- Token rotation is dashboard secret overwrite + redeploy; old token dies
  immediately (single token, no grace — acceptable for one owner).
- OAuth upgrade path recorded here, not built.
- Media/tags _write_ tools and publish tools are deferred follow-ups;
  `update-draft` refusal on published posts is the v1 boundary line.
- `mcp/wrangler.jsonc` has NO `vars` block — same 2026-11-18 wipe rule as the
  main Worker (dashboard is single source of truth; `--keep-vars` on deploy).
