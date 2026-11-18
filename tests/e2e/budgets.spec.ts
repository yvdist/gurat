import { expect, test } from "@playwright/test";

// Phase-7 budget gate (spec 07 §7.4c): the reading surface stays featherweight.
// HTML + linked same-origin CSS ≤ 50 KB (images excluded — they stream from
// R2); total page JS ≤ 3 KB (the two hashed inline scripts ≈ 1.3 KB plus the
// JSON-LD data block). JSON-LD is asserted separately so data growth is
// visible instead of silently eating the code budget.
const HTML_CSS_BUDGET = 50 * 1024;
const JS_BUDGET = 3 * 1024;
const PAGES = [
	"/writing/no-014-photo-first",
	"/id/writing/no-014-foto-dulu",
	"/",
] as const;

for (const path of PAGES) {
	test(`budgets ${path}`, async ({ page }) => {
		const cssBytes: number[] = [];
		let jsBytes = 0;
		let jsonLdBytes = 0;
		page.on("response", (res) => {
			const url = res.url();
			if (!url.startsWith("http://127.0.0.1:4321")) return;
			if (url.endsWith(".css")) {
				void res.body().then((b) => cssBytes.push(b.length));
			}
		});
		await page.goto(path);
		const html = await page.content();
		const htmlBytes = Buffer.byteLength(html, "utf8");

		// Inline scripts: the two hashed theme/interaction scripts + (on posts)
		// the JSON-LD data block. Classify by type attribute.
		const scripts = await page.locator("script").evaluateAll((els) =>
			els.map((el) => ({
				type: el.getAttribute("type") ?? "",
				text: el.textContent ?? "",
			})),
		);
		for (const s of scripts) {
			const bytes = Buffer.byteLength(s.text, "utf8");
			if (s.type === "application/ld+json") jsonLdBytes += bytes;
			else jsBytes += bytes;
		}
		// External same-origin JS (islands load on admin only; public should be ~none).
		const externalJs = await page
			.locator('script[src^="/"], script[src^="http://127.0.0.1:4321"]')
			.count();
		expect(externalJs, "no external same-origin scripts on public pages").toBe(
			0,
		);

		const cssTotal = cssBytes.reduce((a, b) => a + b, 0);
		expect(
			htmlBytes + cssTotal,
			`${path}: HTML (${htmlBytes} B) + CSS (${cssTotal} B) ≤ 50 KB`,
		).toBeLessThanOrEqual(HTML_CSS_BUDGET);
		expect(
			jsBytes,
			`${path}: inline JS (${jsBytes} B) ≤ 3 KB`,
		).toBeLessThanOrEqual(JS_BUDGET);
		// Visibility, not a gate: report JSON-LD size alongside.
		console.log(
			`budget ${path}: html=${htmlBytes} css=${cssTotal} js=${jsBytes} jsonld=${jsonLdBytes}`,
		);
	});
}
