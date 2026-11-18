import { expect, test } from "@playwright/test";

// Seeded editorial baseline (plan Step 5): the 6 seeded surfaces at
// 390/768/1440 px × light/dark → docs/design/audit/seeded/, 36 files.
// Extends the visual.spec.ts pattern (forced colorScheme + localStorage
// seed, one h1 per page); does NOT modify visual.spec.ts.
//
// Media route is DEV-only by design (spec §5.5: 404s in production builds),
// so captures run against `astro dev` (the config's second webServer,
// :4322), never preview — pass a matching baseURL when running directly.
// 390 is the requested width (the existing suite keeps 360).
// File-scoped: dev server serves the R2-backed media the baseline proves.
test.use({ baseURL: "http://localhost:4322" });
const pages = [
	{ name: "home", path: "/" },
	{ name: "post-en", path: "/writing/no-014-photo-first" },
	{ name: "post-id", path: "/id/writing/no-014-foto-dulu" },
	{ name: "archive", path: "/writing" },
	{ name: "tags", path: "/tags" },
	{ name: "about", path: "/about" },
] as const;

const viewports = [
	{ name: "390", width: 390, height: 844 },
	{ name: "768", width: 768, height: 1024 },
	{ name: "1440", width: 1440, height: 900 },
] as const;

for (const theme of ["light", "dark"] as const) {
	for (const vp of viewports) {
		for (const p of pages) {
			test(`seeded ${p.name} ${vp.name} ${theme}`, async ({ page }) => {
				await page.goto(p.path);
				// Seed the stored override before the no-flash script runs.
				await page.addInitScript((t) => {
					localStorage.setItem("gurat-theme", t);
				}, theme);
				await page.setViewportSize({ width: vp.width, height: vp.height });
				await page.goto(p.path);
				// Scoped to `main`: every page carries its h1 there and the
				// dev toolbar injects its own h1s outside it.
				await expect(page.locator("main h1")).toHaveCount(1);
				// Hide the dev toolbar app so captures show the page only.
				await page.addStyleTag({
					content: "astro-dev-toolbar { display: none !important; }",
				});
				await page.screenshot({
					path: `docs/design/audit/seeded/${p.name}-${vp.name}-${theme}.png`,
					fullPage: true,
				});
			});
		}
	}
}
