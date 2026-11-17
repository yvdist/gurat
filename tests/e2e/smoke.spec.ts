import { expect, test } from "@playwright/test";

// Reader journey against seeded local D1 (see tests/e2e/reading.spec.ts for
// the full flow): home responds 200 with the display headline.
test("home responds 200 with headline", async ({ page }) => {
	await page.goto("/");
	await expect(page).toHaveTitle(/Gurat/);
	await expect(page.locator("h1")).toHaveCount(1);
	await expect(page.locator("h1")).toContainText("written slowly");
});
