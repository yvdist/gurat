import type { APIRoute } from "astro";
import { type Locale, SITE } from "../config/site";
import { localizePath } from "../i18n";
import { getEnv } from "../lib/env";
import { createDb, listPublishedPosts, listTags } from "../server/db";
import { isFresh, quotedEtag, sha256Hex } from "../server/discovery/http";
import {
	buildSitemapEntries,
	renderSitemapXml,
	type SitemapPost,
	type SitemapTag,
	sitemapLastModified,
} from "../server/discovery/sitemap";

export const prerender = false;

const STATICS = ["/", "/writing", "/tags", "/about"];
const PAGE_LIMIT = 50;

type Db = ReturnType<typeof createDb>;

/** All visible posts for a locale (cursor loop; same visibilityFilter). */
async function allPosts(
	db: Db,
	locale: Locale,
	now: number,
): Promise<SitemapPost[]> {
	const out: SitemapPost[] = [];
	let cursor: string | undefined;
	for (;;) {
		const page = await listPublishedPosts(
			db,
			{
				locale,
				limit: PAGE_LIMIT,
				...(cursor === undefined ? {} : { cursor }),
			},
			now,
		);
		for (const p of page.items) {
			out.push({
				slug: p.slug,
				updatedAt: p.updatedAt,
				locale,
				groupId: p.translationGroupId,
			});
		}
		if (page.nextCursor === null) break;
		cursor = page.nextCursor;
	}
	return out;
}

/** Non-empty tags with lastmod = newest visible post's updatedAt. */
async function liveTags(
	db: Db,
	locale: Locale,
	now: number,
): Promise<SitemapTag[]> {
	const out: SitemapTag[] = [];
	for (const tag of await listTags(db, locale, now)) {
		if (tag.postCount === 0) continue;
		const { items } = await listPublishedPosts(
			db,
			{ locale, tagSlug: tag.slug, limit: 1 },
			now,
		);
		out.push({
			slug: tag.slug,
			lastModified: items[0]?.updatedAt ?? null,
		});
	}
	return out;
}

export const GET: APIRoute = async ({ request }) => {
	const env = getEnv();
	const db = createDb(env.DB);
	const now = Date.now();

	const enPosts = await allPosts(db, "en", now);
	const idPosts = await allPosts(db, "id", now);
	const pairHrefs = new Map<string, { en: string | null; id: string | null }>();
	for (const p of [...enPosts, ...idPosts]) {
		if (p.groupId === null) continue;
		const entry = pairHrefs.get(p.groupId) ?? { en: null, id: null };
		entry[p.locale] = localizePath(`/writing/${p.slug}`, p.locale);
		pairHrefs.set(p.groupId, entry);
	}

	const entries = [
		...buildSitemapEntries({
			locale: "en",
			staticPaths: STATICS,
			tags: await liveTags(db, "en", now),
			posts: enPosts,
			postHrefs: pairHrefs,
		}),
		...buildSitemapEntries({
			locale: "id",
			staticPaths: STATICS.map((s) => (s === "/" ? "/id" : `/id${s}`)),
			tags: await liveTags(db, "id", now),
			posts: idPosts,
			postHrefs: pairHrefs,
		}),
	];

	const xml = renderSitemapXml(SITE.url, entries);
	const lastModified = sitemapLastModified(entries);
	const etag = quotedEtag(await sha256Hex(xml));
	if (isFresh(request, etag, lastModified)) {
		return new Response(null, { status: 304 });
	}
	const headers: Record<string, string> = {
		"Content-Type": "application/xml; charset=utf-8",
		ETag: etag,
	};
	if (lastModified !== null) {
		headers["Last-Modified"] = new Date(lastModified).toUTCString();
	}
	return new Response(xml, { status: 200, headers });
};
