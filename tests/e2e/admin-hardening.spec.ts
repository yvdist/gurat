import { type APIRequestContext, expect, test } from "@playwright/test";

// Phase-7 admin CSP proof (dev server + ADMIN_DEV_BYPASS; skipped
// otherwise). Anonymous-API 401s are unit-covered in `tests/auth.test.ts`
// (the dev bypass defeats them here by design); the post-deploy checklist
// curls them against the live workers.dev URL instead.

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

test("admin carries its own CSP variant", async ({ page, request }) => {
	await page.goto("/admin");
	// The response header is authoritative (no meta CSP exists).
	const res = await request.get("/admin");
	expect(res.status()).toBe(200);
	const header = res.headers()["content-security-policy"];
	expect(header).toBeTruthy();
	expect(header).toContain("script-src 'self'");
	expect(header).not.toMatch(/script-src[^;]*'unsafe-inline'/);
	expect(header).toContain("frame-ancestors 'none'");
	expect(header).toContain("default-src 'self'");
	// DEV (`astro dev`, this project's harness) allows exactly the three
	// pinned Astro-internal hashes so islands hydrate; production
	// (`astro preview`/deploy) must be hash-free. Same split as the
	// `adminCsp` unit test — never widen to `'unsafe-inline'`.
	expect(header?.includes("sha256-") ?? false).toBe(true);
	expect(header?.match(/sha256-/g)).toHaveLength(3);
});
