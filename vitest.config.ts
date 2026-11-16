import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run in the real workerd runtime with a real local D1 (no mocks).
// D1 binding comes from wrangler.jsonc; migrations must be applied to the
// test isolate — see tests/setup.ts.
export default defineConfig({
	plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
	test: {
		setupFiles: ["./tests/setup.ts"],
		// Playwright specs run under node via `pnpm e2e`, not in workerd.
		exclude: ["tests/e2e/**", "**/node_modules/**"],
	},
});
