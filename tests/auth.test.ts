import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/lib/env";
import {
	AccessError,
	assertSameOrigin,
	assertSameOriginNoJson,
	clearJwksCache,
	requireAdminApi,
	requireAdminPage,
	verifyAccess,
} from "../src/server/auth/access";

const TEAM = "https://test-team.cloudflareaccess.com";
const AUD = "test-aud-tag";
const EMAIL = "owner@example.com";

function testEnv(overrides: Partial<Env> = {}): Env {
	return {
		DB: undefined as never,
		MEDIA: undefined as never,
		SITE_URL: "https://gurat.yvdist.com",
		ACCESS_TEAM_DOMAIN: TEAM,
		ACCESS_AUD: AUD,
		ADMIN_EMAILS: EMAIL,
		MEDIA_BASE_URL: "",
		...overrides,
	};
}

function req(headers: Record<string, string> = {}): Request {
	return new Request("https://gurat.yvdist.com/admin", { headers });
}

// Local RS256 keypair; the JWKS endpoint is stubbed via global fetch so no
// network is involved.
async function keypair() {
	const { publicKey, privateKey } = await generateKeyPair("RS256");
	const jwk = await exportJWK(publicKey);
	return { publicKey, privateKey, jwk: { ...jwk, kid: "k1", alg: "RS256" } };
}

async function sign(
	privateKey: CryptoKey,
	claims: Record<string, unknown> = {},
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	return await new SignJWT({ email: EMAIL, ...claims })
		.setProtectedHeader({ alg: "RS256", kid: "k1" })
		.setIssuer(TEAM)
		.setAudience(AUD)
		.setIssuedAt(now)
		.setExpirationTime(now + 300)
		.sign(privateKey);
}

describe("verifyAccess", () => {
	beforeEach(() => {
		clearJwksCache();
		vi.unstubAllGlobals();
	});

	async function stubJwks(jwks: unknown) {
		const fetchMock = vi.fn(async () => Response.json(jwks));
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
	}

	it("accepts a valid token", async () => {
		const { privateKey, jwk } = await keypair();
		await stubJwks({ keys: [jwk] });
		const token = await sign(privateKey);
		const id = await verifyAccess(
			req({ "Cf-Access-Jwt-Assertion": token }),
			testEnv(),
			{
				isDev: false,
			},
		);
		expect(id).toEqual({ email: EMAIL, bypass: false });
	});

	it("rejects missing token with 401", async () => {
		await expect(
			verifyAccess(req(), testEnv(), { isDev: false }),
		).rejects.toMatchObject({
			status: 401,
		} satisfies Partial<AccessError>);
	});

	it("rejects expired tokens with 401", async () => {
		const { privateKey, jwk } = await keypair();
		await stubJwks({ keys: [jwk] });
		const now = Math.floor(Date.now() / 1000);
		const token = await new SignJWT({ email: EMAIL })
			.setProtectedHeader({ alg: "RS256", kid: "k1" })
			.setIssuer(TEAM)
			.setAudience(AUD)
			.setIssuedAt(now - 600)
			.setExpirationTime(now - 300)
			.sign(privateKey);
		const err = await verifyAccess(
			req({ "Cf-Access-Jwt-Assertion": token }),
			testEnv(),
			{ isDev: false },
		).catch((e) => e);
		expect(err).toBeInstanceOf(AccessError);
		expect(err.status).toBe(401);
		expect(err.code).toBe("token-expired");
	});

	it("rejects wrong audience with 403", async () => {
		const { privateKey, jwk } = await keypair();
		await stubJwks({ keys: [jwk] });
		const token = await sign(privateKey, {});
		const badAud = await new SignJWT({ email: EMAIL })
			.setProtectedHeader({ alg: "RS256", kid: "k1" })
			.setIssuer(TEAM)
			.setAudience("other-app")
			.setExpirationTime("5m")
			.sign(privateKey);
		void token;
		const err = await verifyAccess(
			req({ "Cf-Access-Jwt-Assertion": badAud }),
			testEnv(),
			{ isDev: false },
		).catch((e) => e);
		expect(err.status).toBe(403);
		expect(err.code).toBe("wrong-audience");
	});

	it("rejects wrong issuer with 403", async () => {
		const { privateKey, jwk } = await keypair();
		await stubJwks({ keys: [jwk] });
		const token = await new SignJWT({ email: EMAIL })
			.setProtectedHeader({ alg: "RS256", kid: "k1" })
			.setIssuer("https://evil.cloudflareaccess.com")
			.setAudience(AUD)
			.setExpirationTime("5m")
			.sign(privateKey);
		const err = await verifyAccess(
			req({ "Cf-Access-Jwt-Assertion": token }),
			testEnv(),
			{ isDev: false },
		).catch((e) => e);
		expect(err.status).toBe(403);
		expect(err.code).toBe("wrong-issuer");
	});

	it("rejects non-allowlisted email with 403 (case-insensitive allowlist)", async () => {
		const { privateKey, jwk } = await keypair();
		await stubJwks({ keys: [jwk] });
		const token = await new SignJWT({ email: "intruder@example.com" })
			.setProtectedHeader({ alg: "RS256", kid: "k1" })
			.setIssuer(TEAM)
			.setAudience(AUD)
			.setExpirationTime("5m")
			.sign(privateKey);
		const err = await verifyAccess(
			req({ "Cf-Access-Jwt-Assertion": token }),
			testEnv({ ADMIN_EMAILS: "Owner@Example.com" }),
			{ isDev: false },
		).catch((e) => e);
		expect(err.status).toBe(403);
		expect(err.code).toBe("not-allowlisted");
	});

	it("allows the first allowlisted email when bypass is on in DEV", async () => {
		const id = await verifyAccess(
			req(),
			testEnv({
				ADMIN_DEV_BYPASS: "1",
				ADMIN_EMAILS: "Owner@Example.com, other@x.com",
			}),
			{ isDev: true },
		);
		expect(id).toEqual({ email: "owner@example.com", bypass: true });
	});

	it("bypass is dead in prod even with the flag set", async () => {
		const err = await verifyAccess(req(), testEnv({ ADMIN_DEV_BYPASS: "1" }), {
			isDev: false,
		}).catch((e) => e);
		expect(err).toBeInstanceOf(AccessError);
		expect(err.status).toBe(401);
		expect(err.code).toBe("missing-token");
	});

	it("refetches JWKS on kid rotation", async () => {
		const oldKeys = await keypair();
		const newKeys = await keypair();
		const fetchMock = vi.fn(async () => Response.json({ keys: [oldKeys.jwk] }));
		vi.stubGlobal("fetch", fetchMock);
		// Populate the cache with the old key set.
		const oldToken = await new SignJWT({ email: EMAIL })
			.setProtectedHeader({ alg: "RS256", kid: "k1" })
			.setIssuer(TEAM)
			.setAudience(AUD)
			.setExpirationTime("5m")
			.sign(oldKeys.privateKey);
		await verifyAccess(
			req({ "Cf-Access-Jwt-Assertion": oldToken }),
			testEnv(),
			{
				isDev: false,
			},
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		// jose only refetches on `kid` miss past the 30 s cooldown: advance
		// the clock, rotate the key set, then verify a new-key token.
		vi.useFakeTimers();
		try {
			vi.setSystemTime(Date.now() + 31_000);
			fetchMock.mockResolvedValue(
				Response.json({ keys: [{ ...newKeys.jwk, kid: "k2" }] }),
			);
			const now = Math.floor(Date.now() / 1000);
			const token = await new SignJWT({ email: EMAIL })
				.setProtectedHeader({ alg: "RS256", kid: "k2" })
				.setIssuer(TEAM)
				.setAudience(AUD)
				.setExpirationTime(now + 300)
				.sign(newKeys.privateKey);
			const id = await verifyAccess(
				req({ "Cf-Access-Jwt-Assertion": token }),
				testEnv(),
				{ isDev: false, now: Date.now() },
			);
			expect(id.email).toBe(EMAIL);
			expect(fetchMock).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("guards", () => {
	beforeEach(() => {
		clearJwksCache();
		vi.unstubAllGlobals();
	});

	it("page guard redirects to Access login when unauthenticated", async () => {
		const url = new URL("https://gurat.yvdist.com/admin");
		const res = await requireAdminPage(req(), testEnv(), url, {
			isDev: false,
		}).catch((r) => r);
		expect(res).toBeInstanceOf(Response);
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toContain("/cdn-cgi/access/login");
		expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
	});

	it("API guard returns JSON 401 when unauthenticated", async () => {
		const res = await requireAdminApi(req(), testEnv(), { isDev: false }).catch(
			(r) => r,
		);
		expect(res).toBeInstanceOf(Response);
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "missing-token" });
	});

	it("CSRF rejects wrong content type, origin, and fetch-site", () => {
		const env = testEnv();
		expect(() => assertSameOrigin(req({ Origin: env.SITE_URL }), env)).toThrow(
			"csrf",
		);
		expect(() =>
			assertSameOrigin(
				req({ "Content-Type": "application/json", Origin: "https://evil.com" }),
				env,
			),
		).toThrow("csrf");
		expect(() =>
			assertSameOrigin(
				req({
					"Content-Type": "application/json",
					Origin: env.SITE_URL,
					"Sec-Fetch-Site": "cross-site",
				}),
				env,
			),
		).toThrow("csrf");
		expect(() =>
			assertSameOrigin(
				req({
					"Content-Type": "application/json",
					Origin: env.SITE_URL,
					"Sec-Fetch-Site": "same-origin",
				}),
				env,
			),
		).not.toThrow();
	});
	it("no-JSON CSRF checks origin and fetch-site without JSON type", () => {
		const env = testEnv();
		expect(() =>
			assertSameOriginNoJson(req({ Origin: "https://evil.com" }), env),
		).toThrow("csrf");
		expect(() =>
			assertSameOriginNoJson(
				req({ Origin: env.SITE_URL, "Sec-Fetch-Site": "cross-site" }),
				env,
			),
		).toThrow("csrf");
		// Multipart content type passes (boundaries are never JSON).
		expect(() =>
			assertSameOriginNoJson(
				req({
					"Content-Type": "multipart/form-data; boundary=xxx",
					Origin: env.SITE_URL,
					"Sec-Fetch-Site": "same-origin",
				}),
				env,
			),
		).not.toThrow();
	});
});
