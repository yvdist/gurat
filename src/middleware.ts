import type { MiddlewareHandler } from "astro";

// Baseline response headers (spec 02 §2.5). No CSP here — that is Phase 7.
export const onRequest: MiddlewareHandler = async (_context, next) => {
	const response = await next();
	response.headers.set("X-Content-Type-Options", "nosniff");
	response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	response.headers.set(
		"Permissions-Policy",
		"camera=(), microphone=(), geolocation=()",
	);
	response.headers.set("X-Frame-Options", "DENY");
	return response;
};
