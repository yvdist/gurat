import { type APIRequestContext, expect, test } from "@playwright/test";

const SLUG = `e2e-${Date.now().toString(36)}`;

async function bypassActive(request: APIRequestContext) {
	const res = await request.get("/admin/api/tags");
	return res.status() === 200;
}

test.beforeEach(async ({ request }) => {
	test.skip(
		!(await bypassActive(request)),
		"needs ADMIN_DEV_BYPASS=1 + ADMIN_EMAILS + SITE_URL=http://localhost:4322 in .dev.vars",
	);
});

test("create → autosave → preview → publish → 200 → unpublish → 404", async ({
	page,
	request,
}) => {
	await page.goto("/admin");
	await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

	await page.getByRole("link", { name: "+ new post" }).click();
	await expect(page).toHaveURL(/\/admin\/posts\/new$/);

	// Title lives in the canvas H1; slug/excerpt live in the DETAILS panel.
	await page.locator("#meta-title").fill("E2E Post");
	await page.getByRole("button", { name: "DETAILS" }).click();
	await page.locator("#meta-slug").fill(SLUG);
	await page.locator("#meta-excerpt").fill("E2E excerpt");
	// DETAILS paints above the topbar; close it so Publish is clickable.
	await page.keyboard.press("Escape");
	// The first save creates the row and swaps the URL to its id — waiting
	// for that (not the initial "saved" text) proves the save landed.
	const editor = page.locator(
		".article-body .tiptap, .article-body [contenteditable]",
	);
	await editor.click();
	await editor.pressSequentially("Hello from e2e. This is the body text.", {
		delay: 10,
	});
	await expect(page).toHaveURL(/\/admin\/posts\/(?!new$)[^/]+$/, {
		timeout: 15000,
	});

	// Preview renders the draft with public components.
	const postId = page.url().split("/").pop() ?? "";
	const preview = await request.get(`/admin/preview/${postId}`);
	expect(preview.status()).toBe(200);
	expect(await preview.text()).toContain("Hello from e2e");

	// Publish → public URL 200. Stays on the edit page; Unpublish appears
	// in the DETAILS drawer (Danger zone), so reopen it first — the drawer
	// paints above the topbar while open.
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await page.getByRole("button", { name: "Confirm publish" }).click();
	await page.getByRole("button", { name: "DETAILS" }).click();
	const unpubBtn = page.getByRole("button", { name: "Unpublish", exact: true });
	await expect(unpubBtn).toBeVisible({ timeout: 15000 });
	const pub = await request.get(`/writing/${SLUG}`);
	expect(pub.status()).toBe(200);
	expect(await pub.text()).toContain("Hello from e2e");

	// Unpublish → 404. Stays on the edit page; Publish reappears (topbar —
	// close DETAILS so it isn't covered).
	await unpubBtn.click();
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("button", { name: "Publish", exact: true }),
	).toBeVisible({ timeout: 15000 });
	expect((await request.get(`/writing/${SLUG}`)).status()).toBe(404);
});

test("two-tab conflict shows UI, never silently overwrites", async ({
	page,
	context,
	request,
}) => {
	await page.goto("/admin/posts/new");
	await page.locator("#meta-title").fill("Conflict Post");
	await page.getByRole("button", { name: "DETAILS" }).click();
	await page.locator("#meta-slug").fill(`${SLUG}-conflict`);
	const editor = page.locator(
		".article-body .tiptap, .article-body [contenteditable]",
	);
	await editor.click();
	const created = page.waitForResponse(
		(r) =>
			r.url().includes("/admin/api/posts") && r.request().method() === "POST",
		{ timeout: 15000 },
	);
	await editor.pressSequentially("First version body text here.", {
		delay: 10,
	});
	await created;
	await expect(page).toHaveURL(/\/admin\/posts\/(?!new$)[^/]+$/);
	const postId = page.url().split("/").pop() ?? "";

	const tab2 = await context.newPage();
	await tab2.goto(`/admin/posts/${postId}`);
	const editor2 = tab2.locator(
		".article-body .tiptap, .article-body [contenteditable]",
	);
	await editor2.click();
	const saved2 = tab2.waitForResponse(
		(r) =>
			r.url().includes(`/admin/api/posts/${postId}`) &&
			r.request().method() === "PUT" &&
			r.status() === 200,
		{ timeout: 15000 },
	);
	await editor2.press("ControlOrMeta+a");
	await editor2.pressSequentially("Second tab version body text here.", {
		delay: 10,
	});
	await saved2;
	// First tab saves stale content → conflict panel, server keeps tab2 text.
	const conflicted = page.waitForResponse(
		(r) =>
			r.url().includes(`/admin/api/posts/${postId}`) &&
			r.request().method() === "PUT" &&
			r.status() === 409,
		{ timeout: 15000 },
	);
	await page
		.locator(".article-body .tiptap, .article-body [contenteditable]")
		.click();
	await page.keyboard.press("a");
	await conflicted;
	await expect(page.getByRole("alert")).toContainText("Someone else saved");

	const preview = await request.get(`/admin/preview/${postId}`);
	expect(await preview.text()).toContain("Second tab version");
	expect(await preview.text()).not.toContain("First version");
	await tab2.close();
});

test("share image upload sets the public og:image URL", async ({ request }) => {
	const slug = `e2e-og-${Date.now().toString(36)}`;
	const created = await request.post("/admin/api/posts", {
		headers: { Origin: "http://localhost:4322" },
		data: {
			locale: "en",
			slug,
			title: "E2E OG Post",
			excerpt: "OG excerpt",
			contentJson: JSON.stringify({
				type: "doc",
				content: [
					{
						type: "heading",
						attrs: { level: 2 },
						content: [{ type: "text", text: "OG body" }],
					},
					{
						type: "paragraph",
						content: [{ type: "text", text: "Body." }],
					},
				],
			}),
			tagIds: [],
		},
	});
	expect(created.status()).toBe(201);
	const { post } = (await created.json()) as { post: { id: string } };

	// Reuse the valid 1200×630 fallback PNG as the upload payload.
	const png = await request.get("/og-default.png");
	expect(png.status()).toBe(200);
	const uploaded = await request.put(`/admin/api/posts/${post.id}/og`, {
		headers: { Origin: "http://localhost:4322" },
		multipart: {
			image: {
				name: "og.png",
				mimeType: "image/png",
				buffer: await png.body(),
			},
		},
	});
	expect(uploaded.status()).toBe(200);
	expect(await uploaded.json()).toEqual({ og: { key: `og/${post.id}.png` } });

	const pub = await request.post(`/admin/api/posts/${post.id}/publish`, {
		headers: { Origin: "http://localhost:4322" },
		data: { publishedAt: Date.now() - 1000 },
	});
	expect(pub.status()).toBe(200);
	const pageRes = await request.get(`/writing/${slug}`);
	expect(pageRes.status()).toBe(200);
	const html = await pageRes.text();
	expect(html).toContain(`og/${post.id}.png`);

	const gone = await request.delete(`/admin/api/posts/${post.id}`, {
		headers: { Origin: "http://localhost:4322" },
		data: {},
	});
	expect(gone.status()).toBe(200);
});
