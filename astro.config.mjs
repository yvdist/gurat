import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

// Docs: https://docs.astro.build/en/guides/integrations-guide/cloudflare/ (adapter v14.4.x)
// Docs: https://docs.astro.build/en/guides/deploy/cloudflare/ (Workers + Static Assets)
// `astro dev` / `astro preview` run on the real workerd runtime via the
// Cloudflare Vite plugin (dev/prod parity, incl. local D1).
export default defineConfig({
	output: "server",
	adapter: cloudflare({
		// No runtime image transforms in Phase 1; avoid auto-provisioning an
		// IMAGES binding. Revisited when media lands (Phase 5).
		imageService: "passthrough",
	}),
	// No sessions yet (auth lands in Phase 4); opts out of the adapter's
	// default session KV provisioning. See https://docs.astro.build/en/guides/sessions/#disabling-sessions
	session: false,
});
