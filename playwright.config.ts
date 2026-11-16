import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	webServer: {
		command: "pnpm dev --host 127.0.0.1",
		url: "http://127.0.0.1:4321",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
	use: { baseURL: "http://127.0.0.1:4321" },
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
