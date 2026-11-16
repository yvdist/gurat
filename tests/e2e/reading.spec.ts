import { expect, test } from "@playwright/test";

// Phase-2 reader flow against seeded local D1 (`pnpm dev` serves workerd +
// local D1; seed via `pnpm db:seed:local && pnpm db:rerender`):
// home → post → language switch → tag page.
test("home links to posts with one h1 and reader head tags", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.locator("h1")).toHaveCount(1);
	await expect(page.locator("script")).toHaveCount(0);
	const canonical = page.locator('link[rel="canonical"]');
	await expect(canonical).toHaveAttribute("href", /\/$/);
	await expect(
		page.locator('link[rel="alternate"][hreflang="id"]'),
	).toHaveCount(1);
	await expect(
		page.locator('link[rel="alternate"][hreflang="x-default"]'),
	).toHaveCount(1);
	await page.getByRole("link", { name: "Hello, world" }).click();
	await expect(page).toHaveURL(/\/writing\/hello-world$/);
});

test("post page shows translated content and switches locale", async ({
	page,
}) => {
	await page.goto("/writing/hello-world");
	await expect(page.locator("h1")).toHaveCount(1);
	await expect(page.locator("h1")).toContainText("Hello, world");
	await expect(page.locator("script")).toHaveCount(0);
	await expect(page.locator("time[datetime]")).toHaveCount(1);
	await expect(page.locator(".article-body")).toHaveCount(1);
	const html = await page.locator(".article-body").innerHTML();
	expect(html).not.toContain("<script");
	// Translation link leads to the Indonesian counterpart.
	await page.getByRole("link", { name: "Bahasa Indonesia" }).click();
	await expect(page).toHaveURL(/\/id\/writing\/halo-dunia$/);
	await expect(page.locator("html")).toHaveAttribute("lang", "id");
	await expect(page.locator("h1")).toContainText("Halo, dunia");
});

test("tag page lists posts; unknown slugs 404 localized", async ({ page }) => {
	await page.goto("/tags/essays");
	await expect(page.locator("h1")).toHaveCount(1);
	await expect(page.getByRole("link", { name: "Hello, world" })).toBeVisible();
	await page.goto("/id/tags/essays");
	await expect(page.locator("html")).toHaveAttribute("lang", "id");
	await expect(page.getByRole("link", { name: "Halo, dunia" })).toBeVisible();
	const missingEn = await page.goto("/writing/no-such-post");
	expect(missingEn?.status()).toBe(404);
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
	await expect(page.locator("h1")).toContainText("Not found");
	const missingId = await page.goto("/id/writing/no-such-post");
	expect(missingId?.status()).toBe(404);
	await expect(page.locator("html")).toHaveAttribute("lang", "id");
	await expect(page.locator("h1")).toContainText("Tidak ditemukan");
});

test("draft and future posts 404 in both locales", async ({ page }) => {
	for (const url of [
		"/writing/draft-post",
		"/id/writing/draft-post",
		"/writing/tulisan-mendatang",
		"/id/writing/tulisan-mendatang",
	]) {
		const response = await page.goto(url);
		expect(response?.status(), url).toBe(404);
	}
});
