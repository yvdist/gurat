import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	webServer: {
		// Production server: the 0-JS and head-tag assertions prove the
		// shipped output (`pnpm dev` injects HMR scripts, so it cannot).
		// Requires seeded local D1 (`pnpm db:seed:local && pnpm db:rerender`).
		command: "pnpm build && pnpm preview --host 127.0.0.1",
		url: "http://127.0.0.1:4321",
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
	},
	use: { baseURL: "http://127.0.0.1:4321" },
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
