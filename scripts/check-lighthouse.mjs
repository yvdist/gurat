// Lighthouse gate (spec 07 §7.4a): mobile home + one long seeded post must
// score ≥ 95 in Performance, Accessibility, Best-Practices, and SEO.
// Runs against a local preview server (`BASE_URL`, default the Playwright
// preview port). Chrome binary via `CHROME_PATH` (CI: browser-actions cache
// path; local: Playwright's bundled Chromium or system Chrome).
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4321";
const URLS = [`${BASE}/`, `${BASE}/writing/second-post`];
const FLOOR = 95;
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];

const chrome = await launch({
	chromePath: process.env.CHROME_PATH,
	chromeFlags: ["--headless", "--no-sandbox", "--disable-dev-shm-usage"],
});
let failed = false;
try {
	for (const url of URLS) {
		const { lhr } = await lighthouse(url, {
			port: chrome.port,
			formFactor: "mobile",
			screenEmulation: { disabled: false },
			onlyCategories: CATEGORIES,
		});
		console.log(`lighthouse ${url}`);
		for (const name of CATEGORIES) {
			const score = Math.round((lhr.categories[name]?.score ?? 0) * 100);
			const ok = score >= FLOOR;
			if (!ok) failed = true;
			console.log(`  ${name}: ${score} ${ok ? "ok" : `FAIL (< ${FLOOR})`}`);
		}
	}
} finally {
	await chrome.kill();
}
if (failed) {
	process.exit(1);
}
console.log("lighthouse gate: all categories ≥ 95.");
