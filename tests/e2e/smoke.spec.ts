import { expect, test } from "@playwright/test";

// Reader journey against seeded local D1 (see tests/e2e/reading.spec.ts for
// the full Phase-2 flow): home responds 200 with the site title.
test("home responds 200 with site title", async ({ page }) => {
	await page.goto("/");
	await expect(page).toHaveTitle(/Gurat/);
	await expect(page.getByRole("heading", { name: "Gurat" })).toBeVisible();
});
