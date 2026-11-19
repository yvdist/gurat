# MCP server (`gurat-mcp`)

Separate Cloudflare Worker exposing a Streamable HTTP MCP endpoint so any
MCP-capable AI provider (Claude, Gemini, agent harnesses) can generate post
**drafts**. Draft-only by design: no publish/unpublish/delete tools exist, and
the repo layer hardcodes `status: "draft"` on create — a leaked token can
never publish. The owner reviews and publishes in `/admin`.

- ADR: [`docs/decisions/007-mcp-server.md`](decisions/007-mcp-server.md)
- Endpoint: `https://<mcp-worker-host>/mcp` (Worker name `gurat-mcp`, same D1
  database as the site)
- Auth: `Authorization: Bearer <MCP_BEARER_TOKEN>`

## Tools

| Tool           | What                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `list-posts`   | Compact rows (id, locale, slug, title, status, updatedAt) — never `contentJson`                                    |
| `get-post`     | Full post by id, including `contentJson` for revision                                                              |
| `create-draft` | New draft; `contentJson` is a stringified Tiptap doc                                                               |
| `update-draft` | Save a draft; needs `expectedUpdatedAt` from `get-post`/`create-draft`; refuses published posts (`forbidden(403)`) |
| `list-tags`    | Tag id/slug/labels for a locale (tagIds must reference real ids)                                                   |

Resource `gurat://schema/content-blocks` teaches the model the Tiptap
allowlist. Error shape: `"<code>(<status>): <detail>"` (e.g.
`schema(422): content.1.type`) — zod paths pass through verbatim so the model
can self-correct.

## Setup (owner)

1. `cd mcp && wrangler secret put MCP_BEARER_TOKEN` (dashboard secret, never
   in config — `mcp/wrangler.jsonc` has no `vars` block, same rule as the
   main Worker).
2. Deploy from `mcp/`: `wrangler deploy --keep-vars` (same flag, same reason:
   dashboard stays the single source of truth).
3. Connect from Claude Code:
   `claude mcp add --transport http gurat https://<mcp-worker-host>/mcp --header "Authorization: Bearer <token>"`
   (or the equivalent bearer-token HTTP transport in Gemini / inspector).

## Token rotation

Dashboard secret overwrite + redeploy. The old token dies immediately
(single token, no grace — acceptable for one owner). OAuth via
`workers-oauth-provider` is the recorded upgrade path if multi-user ever
arrives (see ADR 007).
