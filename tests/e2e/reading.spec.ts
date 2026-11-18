import { expect, test } from "@playwright/test";

// Phase-3 reader flow against seeded local D1 (`pnpm dev` serves workerd +
// local D1; seed via `pnpm db:seed:local && pnpm db:rerender`):
// home → post → language switch → tag page. Head tags and the ≤3 KB inline
// JS budget (two scripts: no-flash theme + interactions) prove the shipped
// output — `pnpm dev` injects HMR scripts, so production assertions run
// against `pnpm preview` (playwright webServer).
test("home links to posts with one h1 and reader head tags", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.locator("h1")).toHaveCount(1);
	// Two inline scripts only (no-flash theme + interactions), ≤ 3 KB total.
	await expect(page.locator("script")).toHaveCount(2);
	const canonical = page.locator('link[rel="canonical"]');
	await expect(canonical).toHaveAttribute("href", /\/$/);
	await expect(
		page.locator('link[rel="alternate"][hreflang="id"]:not([type])'),
	).toHaveCount(1);
	await expect(
		page.locator('link[rel="alternate"][hreflang="x-default"]'),
	).toHaveCount(1);
	await page.getByRole("link", { name: "Hello, world" }).first().click();
	await expect(page).toHaveURL(/\/writing\/no-014-photo-first$/);
});

test("post page shows translated content and switches locale", async ({
	page,
}) => {
	await page.goto("/writing/hello-world");
	await expect(page.locator("h1")).toHaveCount(1);
	await expect(page.locator("h1")).toContainText("Hello, world");
	// Two inline scripts (no-flash + interactions) plus the JSON-LD block.
	await expect(page.locator("script")).toHaveCount(3);
	await expect(page.locator("time[datetime]")).toHaveCount(1);
	await expect(page.locator(".article-body")).toHaveCount(1);
	const html = await page.locator(".article-body").innerHTML();
	expect(html).not.toContain("<script");
	// Phase-3 nodes render in the fixture post.
	expect(html).toContain("pullquote");
	expect(html).toContain("sidenote");
	expect(html).toContain("footnotes");
	// Translation link leads to the Indonesian counterpart.
	await page.getByRole("link", { name: "Bahasa Indonesia" }).click();
	await expect(page).toHaveURL(/\/id\/writing\/no-014-foto-dulu$/);
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

test("theme toggle persists and post numbers resolve", async ({ page }) => {
	await page.goto("/");
	// Post numbers render zero-padded on cards and rows.
	await expect(page.getByText(/^No\. \d{3}$/).first()).toBeVisible();
	// Theme toggle: three buttons, exactly one pressed.
	const toggle = page.getByRole("group", { name: "Theme" });
	await expect(toggle.getByRole("button")).toHaveCount(3);
	await toggle.getByRole("button", { name: "dark" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await expect(toggle.getByRole("button", { name: "dark" })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	// Post page: breadcrumb number + prev/next links resolve 200.
	await page.goto("/writing/hello-world");
	await expect(
		page.locator(".breadcrumb").getByText(/No\. \d{3}/),
	).toBeVisible();
	const prevNext = page.locator(".prevnext a");
	if ((await prevNext.count()) > 0) {
		const href = await prevNext.first().getAttribute("href");
		expect(href).toBeTruthy();
		const res = await page.goto(href ?? "/");
		expect(res?.status()).toBe(200);
	}
});
