import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	webServer: [
		{
			// Production server: the 0-JS and head-tag assertions prove the
			// shipped output (`pnpm dev` injects HMR scripts, so it cannot).
			// Requires seeded local D1 (`pnpm db:seed:local && pnpm db:rerender`).
			command: "pnpm build && pnpm preview --host 127.0.0.1",
			url: "http://127.0.0.1:4321",
			reuseExistingServer: !process.env.CI,
			timeout: 180_000,
		},
		{
			// Admin journeys need the DEV-only bypass (`import.meta.env.DEV`
			// is false in the production build above by design). `astro dev`
			// reads `.dev.vars` for the flag — set `ADMIN_DEV_BYPASS=1`,
			// `ADMIN_EMAILS=<owner>`, `SITE_URL=http://localhost:4322`
			// there before running the admin project.
			command: "pnpm dev --port 4322",
			url: "http://localhost:4322",
			reuseExistingServer: !process.env.CI,
			timeout: 180_000,
			stdout: "pipe",
		},
	],
	use: { baseURL: "http://127.0.0.1:4321" },
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
			testIgnore: "**/admin.spec.ts",
		},
		{
			name: "admin",
			use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:4322" },
			testMatch: "**/admin.spec.ts",
		},
	],
});
