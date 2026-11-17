import type { MiddlewareHandler } from "astro";
import { adminCsp, mediaOriginFrom, publicCsp } from "./server/security/csp";

// Baseline response headers (spec 02 §2.5) + Phase-7 CSP, request id, 5xx log.
// Env arrives via `context.locals.runtime` (Astro Cloudflare runtime) — never
// `cloudflare:workers` here (env isolation: only `src/lib/env.ts` imports it).
// HSTS is dashboard-edge per spec — never a Worker header (lies on local http).
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
	const runtimeEnv = (
		context.locals as {
			runtime?: { env?: { MEDIA_BASE_URL?: unknown } };
		}
	).runtime?.env;
	const raw = runtimeEnv?.MEDIA_BASE_URL;
	const isAdmin = path === "/admin" || path.startsWith("/admin/");
	response.headers.set(
		"Content-Security-Policy",
		isAdmin
			? adminCsp()
			: publicCsp(mediaOriginFrom(typeof raw === "string" ? raw : null)),
	);
	response.headers.set("X-Request-Id", rid);
	return response;
};
