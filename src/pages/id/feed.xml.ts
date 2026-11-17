import type { APIRoute } from "astro";
import { SITE } from "../../config/site";
import { getEnv } from "../../lib/env";
import { createDb, listPublishedPosts } from "../../server/db";
import {
	buildFeedXml,
	FEED_LIMIT,
	feedLastModified,
	toFeedPost,
} from "../../server/discovery/feed";
import { isFresh, quotedEtag, sha256Hex } from "../../server/discovery/http";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	const env = getEnv();
	const db = createDb(env.DB);
	const { items } = await listPublishedPosts(
		db,
		{ locale: "id", limit: FEED_LIMIT },
		Date.now(),
	);
	const feedPosts = items.map(toFeedPost);
	const xml = buildFeedXml({
		locale: "id",
		siteUrl: SITE.url,
		mediaBase: env.MEDIA_BASE_URL || SITE.url,
		posts: feedPosts,
		siteName: SITE.name,
	});
	const lastModified = feedLastModified(feedPosts);
	const etag = quotedEtag(await sha256Hex(xml));
	if (isFresh(request, etag, lastModified)) {
		return new Response(null, { status: 304 });
	}
	const headers: Record<string, string> = {
		"Content-Type": "application/rss+xml; charset=utf-8",
		ETag: etag,
	};
	if (lastModified !== null) {
		headers["Last-Modified"] = new Date(lastModified).toUTCString();
	}
	return new Response(xml, { status: 200, headers });
};
