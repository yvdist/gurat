import type { Locale } from "../../config/site";
import { localizePath } from "../../i18n";
import { escapeHtml } from "../../lib/content/render";
import type { PublishedPost } from "../db/posts";

export interface FeedPost {
	id: string;
	slug: string;
	title: string;
	excerpt: string;
	seoDescription: string | null;
	contentHtml: string;
	publishedAt: number | null;
	updatedAt: number;
}

export interface BuildFeedInput {
	locale: Locale;
	siteUrl: string;
	mediaBase: string;
	posts: FeedPost[];
	siteName: string;
}

export const FEED_LIMIT = 30;

/** Latest `updatedAt` across items, else null (conditional GET has no date). */
export function feedLastModified(posts: FeedPost[]): number | null {
	let max: number | null = null;
	for (const p of posts) {
		if (max === null || p.updatedAt > max) max = p.updatedAt;
	}
	return max;
}

/** Rewrite same-origin media/relative hrefs to absolute URLs for readers. */
export function absolutizeFeedHtml(html: string, origin: string): string {
	return html
		.replaceAll('src="/media/', `src="${origin}/media/`)
		.replaceAll('href="/', `href="${origin}/`);
}

function itemXml(
	post: FeedPost,
	locale: Locale,
	siteUrl: string,
	origin: string,
): string {
	const permalink = `${siteUrl}${localizePath(`/writing/${post.slug}`, locale)}`;
	const pubDate =
		post.publishedAt !== null ? new Date(post.publishedAt).toUTCString() : "";
	const lang = locale === "id" ? "id" : "en";
	const description = post.seoDescription ?? post.excerpt;
	// Content is stored renderer-escaped HTML; single CDATA wrap with the only
	// legal escape (`]]>` split) so full markup survives feed readers.
	const cdata = absolutizeFeedHtml(post.contentHtml, origin).replaceAll(
		"]]>",
		"]]&gt;",
	);
	return [
		"<item>",
		`<title>${escapeHtml(post.title)}</title>`,
		`<link>${escapeHtml(permalink)}</link>`,
		`<guid isPermaLink="false">urn:uuid:${escapeHtml(post.id)}</guid>`,
		pubDate === "" ? null : `<pubDate>${pubDate}</pubDate>`,
		`<description>${escapeHtml(description)}</description>`,
		`<content:encoded><![CDATA[${cdata}]]></content:encoded>`,
		`<language>${lang}</language>`,
		"</item>",
	]
		.filter((line) => line !== null)
		.join("");
}

export function buildFeedXml(input: BuildFeedInput): string {
	const lang = input.locale === "id" ? "id" : "en";
	const feedPath = localizePath("/feed.xml", input.locale);
	const lastBuild = feedLastModified(input.posts) ?? Date.now();
	const items = input.posts
		.map((p) =>
			itemXml(p, input.locale, input.siteUrl, input.mediaBase || input.siteUrl),
		)
		.join("");
	return (
		`<?xml version="1.0" encoding="UTF-8"?>` +
		`<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">` +
		`<channel>` +
		`<title>${escapeHtml(input.siteName)}</title>` +
		`<link>${escapeHtml(input.siteUrl + localizePath("/", input.locale))}</link>` +
		`<description>${escapeHtml(input.siteName)} — ${escapeHtml(feedPath)}</description>` +
		`<language>${lang}</language>` +
		`<lastBuildDate>${new Date(lastBuild).toUTCString()}</lastBuildDate>` +
		items +
		`</channel></rss>`
	);
}

/** Narrow a repo row to the fields the feed builder consumes. */
export function toFeedPost(p: PublishedPost): FeedPost {
	return {
		id: p.id,
		slug: p.slug,
		title: p.title,
		excerpt: p.excerpt,
		seoDescription: p.seoDescription,
		contentHtml: p.contentHtml,
		publishedAt: p.publishedAt,
		updatedAt: p.updatedAt,
	};
}
