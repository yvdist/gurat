import type { APIRoute } from "astro";
import { SITE } from "../config/site";
import { isFresh, quotedEtag, sha256Hex } from "../server/discovery/http";

export const prerender = false;

export function buildRobotsTxt(siteUrl: string): string {
	return [
		`User-agent: *`,
		`Allow: /`,
		`Disallow: /admin`,
		``,
		`Sitemap: ${siteUrl}/sitemap.xml`,
		``,
	].join("\n");
}

export const GET: APIRoute = async ({ request }) => {
	const body = buildRobotsTxt(SITE.url);
	const etag = quotedEtag(await sha256Hex(body));
	if (isFresh(request, etag, null)) {
		return new Response(null, { status: 304 });
	}
	return new Response(body, {
		status: 200,
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			ETag: etag,
		},
	});
};
