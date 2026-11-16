import { expect, test } from "@playwright/test";

test("home responds 200 with placeholder", async ({ page }) => {
	await page.goto("/");
	await expect(page).toHaveTitle(/Gurat/);
	await expect(page.getByRole("heading", { name: "Gurat" })).toBeVisible();
});
