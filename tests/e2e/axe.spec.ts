import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Phase-7 accessibility gate (spec 07 §7.4b): zero serious-or-worse
// findings on home, archive, post, tag, 404 × both locales × both themes.
// Reuses the seeded preview server; known-needs-review rules stay visible.
const PAGES = [
	"/",
	"/writing",
	"/writing/hello-world",
	"/tags/essays",
	"/writing/no-such-post",
	"/id/",
	"/id/writing",
	"/id/writing/halo-dunia",
	"/id/tags/essays",
	"/id/writing/halaman-tidak-ada",
] as const;

for (const theme of ["light", "dark"] as const) {
	for (const path of PAGES) {
		test(`axe ${path} [${theme}]`, async ({ page }) => {
			await page.addInitScript((t) => {
				try {
					localStorage.setItem("gurat-theme", t);
				} catch {
					/* private mode */
				}
			}, theme);
			await page.goto(path);
			const results = await new AxeBuilder({ page }).analyze();
			const blocking = results.violations.filter((v) =>
				["serious", "critical"].includes(v.impact ?? ""),
			);
			expect(
				blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`),
				`${path} [${theme}] serious/critical a11y violations`,
			).toEqual([]);
		});
	}
}
