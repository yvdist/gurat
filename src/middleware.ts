import type { MiddlewareHandler } from "astro";
import { getEnv } from "./lib/env";
import { adminCsp, mediaOriginFrom, publicCsp } from "./server/security/csp";

// Baseline response headers (spec 02 §2.5) + Phase-7 CSP, request id, 5xx log.
// Env via `getEnv()` (the `cloudflare:workers` import lives in
// `src/lib/env.ts` only). HSTS is dashboard-edge per spec — never a Worker
// header (lies on local http).
export const onRequest: MiddlewareHandler = async (context, next) => {
	const rid = crypto.randomUUID();
	const start = Date.now();
	const { method } = context.request;
	const path = new URL(context.request.url).pathname;
	const log = (status: number): void => {
		// One JSON line: id, method, path, status, latency. No query, headers,
		// or identity — error triage only.
		console.error(
			JSON.stringify({ ms: Date.now() - start, path, rid, status, method }),
		);
	};
	let response: Response;
	try {
		response = await next();
	} catch (err) {
		log(500);
		// Rethrow so Astro renders `500.astro`.
		throw err;
	}
	if (response.status >= 500) log(response.status);
	response.headers.set("X-Content-Type-Options", "nosniff");
	response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	response.headers.set(
		"Permissions-Policy",
		"camera=(), microphone=(), geolocation=()",
	);
	response.headers.set("X-Frame-Options", "DENY");
	// `getEnv()` throws outside the worker runtime (e.g. prerendered builds);
	// CSP must never break the response, so degrade to self-only.
	let mediaRaw: string | null = null;
	try {
		const raw = getEnv().MEDIA_BASE_URL;
		if (typeof raw === "string") mediaRaw = raw;
	} catch {
		mediaRaw = null;
	}
	const isAdmin = path === "/admin" || path.startsWith("/admin/");
	response.headers.set(
		"Content-Security-Policy",
		isAdmin ? adminCsp() : publicCsp(mediaOriginFrom(mediaRaw)),
	);
	response.headers.set("X-Request-Id", rid);
	return response;
};
