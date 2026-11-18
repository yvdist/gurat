import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../../lib/env";

// Cloudflare Access gate for `/admin*` (spec 04 §4.1, security-critical).
// Verified against:
// https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
// (Cf-Access-Jwt-Assertion header, JWKS at <team>/cdn-cgi/access/certs,
// 6-week rotation with old key valid 7 d, jose Workers example).

export class AccessError extends Error {
	readonly status: 401 | 403;
	readonly code: string;

	constructor(status: 401 | 403, code: string) {
		super(`Access denied: ${code}`);
		this.name = "AccessError";
		this.status = status;
		this.code = code;
	}
}

export interface AccessIdentity {
	email: string;
	bypass: boolean;
}

export interface VerifyAccessOptions {
	/** Defaults to `import.meta.env.DEV`. Pass explicitly in tests. */
	isDev?: boolean;
	/** Epoch ms for `exp`/`nbf` checks. Defaults to `Date.now()`. */
	now?: number;
}

// Module-level JWKS cache, one entry per team domain. `jose`'s
// `createRemoteJWKSet` already refetches on `kid` miss (30 s cooldown) and
// caches for `cacheMaxAge` — 6 h here, well inside the 6-week rotation with
// the old key valid 7 d after rotation.
const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const JWKS_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function jwksForTeam(
	teamDomain: string,
): ReturnType<typeof createRemoteJWKSet> {
	const cached = jwksByTeam.get(teamDomain);
	if (cached) return cached;
	const jwks = createRemoteJWKSet(
		new URL(`${teamDomain}/cdn-cgi/access/certs`),
		{
			cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
		},
	);
	jwksByTeam.set(teamDomain, jwks);
	return jwks;
}

/** Test hook: drop cached JWKS so rotation tests start clean. */
export function clearJwksCache(): void {
	jwksByTeam.clear();
}

/**
 * Normalize `ACCESS_TEAM_DOMAIN` so trivial typos are never fatal:
 * surrounding whitespace, trailing `.`/`/`, missing `https://`.
 * Returns the canonical `https://<team>.cloudflareaccess.com` or `""`
 * when the value is empty/garbage (callers then fail closed as
 * `access-not-configured`, never a confusing `invalid-token`).
 */
export function normalizeTeamDomain(raw: unknown): string {
	if (typeof raw !== "string") return "";
	let v = raw.trim().replace(/[.]+$/, "").replace(/\/+$/, "");
	if (v === "") return "";
	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `https://${v}`;
	let url: URL;
	try {
		url = new URL(v);
	} catch {
		return "";
	}
	if (url.protocol !== "https:") return "";
	if (!url.hostname.endsWith(".cloudflareaccess.com")) return "";
	url.pathname = "/";
	url.search = "";
	url.hash = "";
	return url.toString().replace(/\/$/, "");
}

function teamDomain(env: Env): string {
	return normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
}

function devBypassEmails(env: Env): string[] {
	return env.ADMIN_EMAILS.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter((s) => s.length > 0);
}
const ADMIN_ROBOTS_TAG = "noindex, nofollow";
const ADMIN_CACHE_CONTROL = "no-store";

function withAdminHeaders(headers: Headers): Headers {
	headers.set("X-Robots-Tag", ADMIN_ROBOTS_TAG);
	headers.set("Cache-Control", ADMIN_CACHE_CONTROL);
	return headers;
}

/**
 * Verify the request carries a valid Cloudflare Access identity.
 * Order: dev bypass (DEV-only) → header → JWKS/signature → iss/aud/exp →
 * allowlist. Throws `AccessError` on every rejection path.
 */
export async function verifyAccess(
	request: Request,
	env: Env,
	opts: VerifyAccessOptions = {},
): Promise<AccessIdentity> {
	const isDev = opts.isDev ?? import.meta.env.DEV;

	// Local bypass: ONLY when the build is DEV *and* the explicit flag is
	// set. Production builds can never satisfy both: `import.meta.env.DEV`
	// is false in `astro build` output, and the flag alone is insufficient.
	if (isDev && env.ADMIN_DEV_BYPASS === "1") {
		const first = devBypassEmails(env)[0];
		if (!first) throw new AccessError(403, "not-allowlisted");
		return { email: first, bypass: true };
	}

	const token = request.headers.get("Cf-Access-Jwt-Assertion");
	if (!token) throw new AccessError(401, "missing-token");

	const team = teamDomain(env);
	if (team === "" || !env.ACCESS_AUD) {
		throw new AccessError(403, "access-not-configured");
	}

	let payload: Record<string, unknown>;
	try {
		const verified = await jwtVerify(
			token,
			jwksForTeam(team),
			{
				issuer: team,
				audience: env.ACCESS_AUD,
				...(opts.now !== undefined ? { currentDate: new Date(opts.now) } : {}),
			},
		);
		payload = verified.payload as Record<string, unknown>;
	} catch (err) {
		const code =
			err && typeof err === "object" && "code" in err ? String(err.code) : "";
		// Expired tokens (and clock skew) → 401 so the client retries login;
		// wrong aud/iss/signature → 403 (identity valid but not for this app).
		if (code === "ERR_JWT_EXPIRED") throw new AccessError(401, "token-expired");
		if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
			const reason =
				err && typeof err === "object" && "claim" in err
					? String((err as { claim: unknown }).claim)
					: "";
			if (reason === "aud") throw new AccessError(403, "wrong-audience");
			if (reason === "iss") throw new AccessError(403, "wrong-issuer");
			throw new AccessError(403, "invalid-claims");
		}
		throw new AccessError(403, "invalid-token");
	}

	const email =
		typeof payload.email === "string" ? payload.email.toLowerCase() : "";
	if (!email || !devBypassEmails(env).includes(email)) {
		throw new AccessError(403, "not-allowlisted");
	}

	return { email, bypass: false };
}

/**
 * Guard for admin *pages*: no token → 302 to the Access login page;
 * invalid/forbidden → 403 plain text. Never 404-masks admin.
 */
export async function requireAdminPage(
	request: Request,
	env: Env,
	url: URL,
	opts: VerifyAccessOptions = {},
): Promise<AccessIdentity> {
	try {
		return await verifyAccess(request, env, opts);
	} catch (err) {
		if (err instanceof AccessError && err.status === 401) {
			const team = teamDomain(env) || "https://login.invalid";
			// Production always configures the team domain; local dev uses the
			// bypass so this fallback is unreachable in practice.
			const headers = withAdminHeaders(
				new Headers({
					Location: `${team}/cdn-cgi/access/login?redirect_url=${encodeURIComponent(url.toString())}`,
				}),
			);
			throw new Response(null, { status: 302, headers });
		}
		if (err instanceof AccessError) {
			throw new Response(`Forbidden: ${err.code}`, {
				status: 403,
				headers: withAdminHeaders(
					new Headers({ "Content-Type": "text/plain" }),
				),
			});
		}
		throw err;
	}
}

/**
 * Guard for admin *API* endpoints: failures → JSON `{ error: code }`.
 * Never 404-masks admin.
 */
export async function requireAdminApi(
	request: Request,
	env: Env,
	opts: VerifyAccessOptions = {},
): Promise<AccessIdentity> {
	try {
		return await verifyAccess(request, env, opts);
	} catch (err) {
		if (err instanceof AccessError) {
			throw new Response(JSON.stringify({ error: err.code }), {
				status: err.status,
				headers: withAdminHeaders(
					new Headers({ "Content-Type": "application/json" }),
				),
			});
		}
		throw err;
	}
}

/**
 * CSRF guard for mutating admin endpoints (spec 04 §4.1): JSON
 * `Content-Type`, `Origin` exactly equal to `SITE_URL`, and — when present —
 * `Sec-Fetch-Site: same-origin`. GET preview is not mutating (no check).
 */
export function assertSameOrigin(request: Request, env: Env): void {
	const contentType = request.headers.get("Content-Type") ?? "";
	if (!contentType.includes("application/json")) {
		throw new AccessError(403, "csrf");
	}
	if ((request.headers.get("Origin") ?? "") !== env.SITE_URL) {
		throw new AccessError(403, "csrf");
	}
	const secFetchSite = request.headers.get("Sec-Fetch-Site");
	if (secFetchSite !== null && secFetchSite !== "same-origin") {
		throw new AccessError(403, "csrf");
	}
}

/**
 * CSRF guard for endpoints whose legitimate requests never carry JSON
 * (multipart uploads, empty-body DELETEs — spec 05 §5.1): same `Origin` +
 * `Sec-Fetch-Site` checks as {@link assertSameOrigin}, but without the JSON
 * `Content-Type` requirement.
 */
export function assertSameOriginNoJson(request: Request, env: Env): void {
	if ((request.headers.get("Origin") ?? "") !== env.SITE_URL) {
		throw new AccessError(403, "csrf");
	}
	const secFetchSite = request.headers.get("Sec-Fetch-Site");
	if (secFetchSite !== null && secFetchSite !== "same-origin") {
		throw new AccessError(403, "csrf");
	}
}
