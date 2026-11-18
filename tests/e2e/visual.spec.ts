import { expect, test } from "@playwright/test";

// Structural screenshots (capture-only, no pixel assertions): home, post,
// archive, tag, 404 at 360/768/1280 px × light/dark (forced via colorScheme
// + localStorage seed) → tests/e2e/__screenshots__/, committed, updated
// only on intentional visual change.
const pages = [
	{ name: "home", path: "/" },
	{ name: "post", path: "/writing/no-014-photo-first" },
	{ name: "archive", path: "/writing" },
	{ name: "tag", path: "/tags/software" },
	{ name: "notfound", path: "/writing/no-such-post" },
] as const;

const viewports = [
	{ name: "360", width: 360, height: 800 },
	{ name: "768", width: 768, height: 1024 },
	{ name: "1280", width: 1280, height: 900 },
] as const;

for (const theme of ["light", "dark"] as const) {
	for (const vp of viewports) {
		for (const p of pages) {
			test(`screenshot ${p.name} ${vp.name} ${theme}`, async ({ page }) => {
				await page.goto(p.path);
				// Seed the stored override before the no-flash script runs.
				await page.addInitScript((t) => {
					localStorage.setItem("gurat-theme", t);
				}, theme);
				await page.setViewportSize({ width: vp.width, height: vp.height });
				await page.goto(p.path);
				await expect(page.locator("h1")).toHaveCount(1);
				await page.screenshot({
					path: `tests/e2e/__screenshots__/${p.name}-${vp.name}-${theme}.png`,
					fullPage: true,
				});
			});
		}
	}
}
