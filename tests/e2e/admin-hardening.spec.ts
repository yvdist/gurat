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
	// DEV (`astro dev`, this project's harness) pins exactly the three
	// Astro-internal hashes, plus per-response hashes of the actual island
	// scripts on island pages (auto-hashed by the middleware). Production
	// (`astro preview`/deploy) carries only the per-response hashes. Same
	// split as the `adminCsp` unit test — never `'unsafe-inline'`.
	for (const pinned of [
		"sha256-+8GaM4dmbWZ33N3gOIea1mixiJP7H2KgqAfQgo=",
		"sha256-Y8t0ntteBwH+PqGKUyjWW3CAk+BNJKSoQc0xZ68FjhM=",
		"sha256-At4sXbunobuxXv56+YxR7rwL4c3n8ubyPDiI7CIowSo=",
	]) {
		expect(header).toContain(pinned);
	}
});
