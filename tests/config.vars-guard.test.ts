import { describe, expect, it } from "vitest";
import mcpWranglerJsonc from "../mcp/wrangler.jsonc?raw";
import rootWranglerJsonc from "../wrangler.jsonc?raw";

// Guard against the 2026-11-18 incident: a `vars` block in wrangler.jsonc
// overwrites dashboard-managed vars on every `wrangler deploy` (wiped
// ACCESS_TEAM_DOMAIN/ACCESS_AUD/ADMIN_EMAILS/MEDIA_BASE_URL to "").
// Dashboard is the single source of truth; deploy uses `--keep-vars`.
// Strip `//` comments (jsonc) before parsing.
describe("wrangler.jsonc has no vars block", () => {
	it.each([
		["wrangler.jsonc", rootWranglerJsonc],
		["mcp/wrangler.jsonc", mcpWranglerJsonc],
	] as const)(
		"%s: dashboard stays the single source of truth for vars",
		(_name, raw) => {
			const json = raw.replace(/^\s*\/\/.*$/gm, "");
			const config = JSON.parse(json) as { vars?: unknown };
			expect(
				config.vars,
				"vars block would overwrite dashboard values on deploy",
			).toBeUndefined();
		},
	);
});
