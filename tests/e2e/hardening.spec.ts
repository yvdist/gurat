import { expect, test } from "@playwright/test";

// Phase-7 header/CSP proof against seeded local D1 (production preview
// server; admin assertions run in the `admin` project via the dev bypass).
// The zero-violation listener is the hash-drift tripwire: any `Base.astro`
// script edit changes the rendered bytes, the pinned hashes stop matching,
// and this fails closed — intended.

const BASELINE: Record<string, string> = {
	"x-content-type-options": "nosniff",
	"referrer-policy": "strict-origin-when-cross-origin",
	"permissions-policy": "camera=(), microphone=(), geolocation=()",
	"x-frame-options": "DENY",
};

function expectBaseline(headers: Record<string, string>) {
	for (const [name, value] of Object.entries(BASELINE)) {
		expect(headers[name], `header ${name}`).toBe(value);
	}
	// Fresh UUID per response.
	expect(headers["x-request-id"], "x-request-id").toMatch(
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
	);
	const csp = headers["content-security-policy"];
	expect(csp, "csp present").toBeTruthy();
	expect(csp).toContain("default-src 'self'");
	expect(csp).toContain("frame-ancestors 'none'");
	expect(csp).toContain("base-uri 'none'");
	expect(csp).toContain("form-action 'self'");
	return csp ?? "";
}

test("public pages carry baseline headers + hashed-script CSP", async ({
	request,
}) => {
	for (const path of [
		"/",
		"/writing/no-014-photo-first",
		"/id/",
		"/id/writing/no-014-foto-dulu",
		"/sitemap.xml",
	]) {
		const res = await request.get(path);
		expect(res.status(), `GET ${path}`).toBe(200);
		const csp = expectBaseline(res.headers());
		// Pinned Base.astro script hashes; never 'unsafe-inline' for scripts.
		expect(csp).toContain(
			"'sha256-dSwg7v9xTCFke3R+41nP4qD5rE6ZATNcPk7sz5ezGzo='",
		);
		expect(csp).toContain(
			"'sha256-dAHpaqBtPUz0woM0pVlnViqkNcCTLEALJYVOiG/qU2w='",
		);
		expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
	}
});

test("healthz returns ok with no-store and noindex", async ({ request }) => {
	const res = await request.get("/healthz");
	expect(res.status()).toBe(200);
	expect(await res.json()).toEqual({ ok: true });
	const headers = res.headers();
	expect(headers["cache-control"]).toBe("no-store");
	expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
	expect(headers["content-type"]).toContain("application/json");
	expectBaseline(headers);
});

test("no page emits a CSP violation in either theme", async ({ page }) => {
	const violations: string[] = [];
	page.on("console", (msg) => {
		if (/Content Security Policy/i.test(msg.text())) {
			violations.push(`console: ${msg.text()}`);
		}
	});
	page.on("pageerror", (err) => {
		if (/Content Security Policy/i.test(err.message)) {
			violations.push(`pageerror: ${err.message}`);
		}
	});
	for (const theme of ["light", "dark", "auto"] as const) {
		await page.goto("/");
		await page.evaluate((t) => {
			try {
				localStorage.setItem("gurat-theme", t);
			} catch {
				/* private mode: theme stays default */
			}
		}, theme);
		for (const path of [
			"/",
			"/writing/no-014-photo-first",
			"/id/writing/no-014-foto-dulu",
			"/tags",
			"/nonexistent-page",
		]) {
			await page.goto(path);
		}
	}
	expect(violations).toEqual([]);
});
