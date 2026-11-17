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
	expect(header).not.toContain("sha256-");
	expect(header).toContain("frame-ancestors 'none'");
	expect(header).toContain("default-src 'self'");
});
