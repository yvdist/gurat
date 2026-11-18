import { expect, test } from "@playwright/test";

// Phase-6 discovery surface against seeded local D1
// (`pnpm db:seed:local && pnpm db:rerender`; production preview server):
// feeds, sitemap, robots, head metadata, search, related-posts empty state.
test("EN and ID feeds validate as RSS with public posts only", async ({
	request,
}) => {
	const en = await request.get("/feed.xml");
	expect(en.status()).toBe(200);
	expect(en.headers()["content-type"]).toContain("application/rss+xml");
	const enXml = await en.text();
	expect(enXml).toContain("<rss version=");
	expect(enXml).toContain("/writing/no-014-photo-first");
	expect(enXml).toContain("/writing/no-013-metronome-heart");
	expect(enXml).not.toContain("unfinished-draft");
	const etag = en.headers().etag;
	expect(etag).toBeTruthy();
	const cached = await request.get("/feed.xml", {
		headers: { "If-None-Match": etag ?? "" },
	});
	expect(cached.status()).toBe(304);

	const id = await request.get("/id/feed.xml");
	expect(id.status()).toBe(200);
	const idXml = await id.text();
	expect(idXml).toContain("/id/writing/no-014-foto-dulu");
	expect(idXml).not.toContain("catatan-terjadwal");
	expect(idXml).toContain("<language>id</language>");
});

test("sitemap lists public URLs with alternates; robots points at it", async ({
	request,
}) => {
	const sm = await request.get("/sitemap.xml");
	expect(sm.status()).toBe(200);
	const xml = await sm.text();
	expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
	expect(xml).toContain("/writing/no-014-photo-first");
	expect(xml).toContain("/id/writing/no-014-foto-dulu");
	expect(xml).not.toContain("unfinished-draft");
	expect(xml).not.toContain("catatan-terjadwal");
	expect(xml).toContain('hreflang="id"');
	expect(xml).toContain("x-default");

	const robots = await request.get("/robots.txt");
	expect(robots.status()).toBe(200);
	const body = await robots.text();
	expect(body).toContain("Disallow: /admin");
	expect(body).toContain("Sitemap:");
	expect(body).toContain("/sitemap.xml");
});

test("post page carries absolute OG/Twitter/JSON-LD and symmetric hreflangs", async ({
	page,
}) => {
	await page.goto("/writing/no-014-photo-first");
	const head = page.locator("head");
	await expect(head.locator('meta[property="og:title"]')).toHaveAttribute(
		"content",
		/Photo first/,
	);
	await expect(head.locator('meta[name="twitter:card"]')).toHaveAttribute(
		"content",
		"summary_large_image",
	);
	const ogImage = await head
		.locator('meta[property="og:image"]')
		.getAttribute("content");
	expect(ogImage).toMatch(/^https?:\/\//);
	expect(ogImage).toContain("og-default.png");
	const jsonLd = JSON.parse(
		(await head.locator('script[type="application/ld+json"]').textContent()) ??
			"{}",
	) as Record<string, unknown>;
	expect(jsonLd).toMatchObject({
		"@type": "BlogPosting",
		inLanguage: "en",
	});
	// Self + translation, linking back (RSS autodiscovery shares hreflang,
	// so scope to links without a type attribute).
	const idHref = await head
		.locator('link[rel="alternate"][hreflang="id"]:not([type])')
		.getAttribute("href");
	expect(idHref).toContain("/id/writing/no-014-foto-dulu");
	// Feed autodiscovery for both locales on every page.
	await expect(
		head.locator('link[type="application/rss+xml"][hreflang="en"]'),
	).toHaveCount(1);
	await expect(
		head.locator('link[type="application/rss+xml"][hreflang="id"]'),
	).toHaveCount(1);
	// NO.014 shares tag-software with NO.007/011/013: related lists them.
	await expect(page.locator(".related")).toHaveCount(1);
	await expect(page.locator(".related")).toContainText(/quiet discipline|Delete the dashboard|metronome/i);
	// Home footer RSS text is now a real link to the locale feed.
	await expect(page.locator(".site-footer .rss a")).toHaveAttribute(
		"href",
		"/feed.xml",
	);
});

test("search serves form-only without q, results with q, 400 on blank", async ({
	page,
	request,
}) => {
	await page.goto("/search");
	await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
	await expect(page.locator(".archive-row")).toHaveCount(0);

	await page.goto("/search?q=metronome");
	await expect(page.locator(".archive-row").first()).toContainText(
		"The metronome and the heart",
	);

	const blank = await request.get("/search?q=%20%20");
	expect(blank.status()).toBe(400);

	await page.goto("/id/search?q=metronom");
	await expect(page.locator(".archive-row").first()).toContainText(
		"Metronom dan detak jantung",
	);
});
