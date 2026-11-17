import type { APIRoute } from "astro";
import { getEnv } from "../lib/env";
import { createDb, listPublishedPosts } from "../server/db";

export const prerender = false;

// Liveness probe (spec 07 §7.2): the smallest read the pinned drizzle/D1
// API supports, through the real repository path. No version strings, no env
// echo — `{"ok":true}` or `{"ok":false}` only.
export const GET: APIRoute = async () => {
	const headers = {
		"Content-Type": "application/json; charset=utf-8",
		"X-Robots-Tag": "noindex, nofollow",
		"Cache-Control": "no-store",
	};
	try {
		await listPublishedPosts(
			createDb(getEnv().DB),
			{ locale: "en", limit: 1 },
			Date.now(),
		);
		return new Response('{"ok":true}', { status: 200, headers });
	} catch {
		// No detail: a failing probe must not leak schema or binding state.
		return new Response('{"ok":false}', { status: 503, headers });
	}
};
