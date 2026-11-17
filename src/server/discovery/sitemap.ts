import type { Locale } from "../../config/site";
import { localizePath } from "../../i18n";
import { escapeHtml } from "../../lib/content/render";

export interface SitemapPost {
	slug: string;
	updatedAt: number;
	locale: Locale;
	groupId: string | null;
}

export interface SitemapTag {
	slug: string;
	lastModified: number | null;
}

export interface SitemapAlternate {
	locale: Locale;
	href: string;
}

export interface SitemapEntry {
	path: string;
	lastmod: number | null;
	alternates: SitemapAlternate[];
}

/** Build url entries for one locale: statics + tag pages + posts. */
export function buildSitemapEntries(input: {
	locale: Locale;
	staticPaths: string[];
	tags: SitemapTag[];
	posts: SitemapPost[];
	postHrefs: Map<string, { en: string | null; id: string | null }>;
}): SitemapEntry[] {
	const entries: SitemapEntry[] = [];
	for (const path of input.staticPaths) {
		entries.push({ path, lastmod: null, alternates: [] });
	}
	for (const tag of input.tags) {
		const href = localizePath(`/tags/${tag.slug}`, input.locale);
		const other: Locale = input.locale === "en" ? "id" : "en";
		entries.push({
			path: href,
			lastmod: tag.lastModified,
			alternates: [
				{ locale: input.locale, href },
				{ locale: other, href: localizePath(`/tags/${tag.slug}`, other) },
			],
		});
	}
	for (const post of input.posts) {
		const href = localizePath(`/writing/${post.slug}`, post.locale);
		const pair =
			post.groupId !== null ? input.postHrefs.get(post.groupId) : undefined;
		const alternates: SitemapAlternate[] =
			pair?.en && pair?.id
				? [
						{ locale: "en", href: pair.en },
						{ locale: "id", href: pair.id },
					]
				: [{ locale: post.locale, href }];
		entries.push({ path: href, lastmod: post.updatedAt, alternates });
	}
	return entries;
}

export function renderSitemapXml(
	siteUrl: string,
	entries: SitemapEntry[],
): string {
	const urls = entries
		.map((e) => {
			const lastmod =
				e.lastmod !== null
					? `<lastmod>${new Date(e.lastmod).toISOString()}</lastmod>`
					: "";
			const alternates = e.alternates
				.map(
					(a) =>
						`<xhtml:link rel="alternate" hreflang="${a.locale}" href="${escapeHtml(siteUrl + a.href)}"/>`,
				)
				.join("");
			const xDefault =
				e.alternates.length > 1
					? `<xhtml:link rel="alternate" hreflang="x-default" href="${escapeHtml(siteUrl + (e.alternates.find((a) => a.locale === "en")?.href ?? e.path))}"/>`
					: "";
			return `<url><loc>${escapeHtml(siteUrl + e.path)}</loc>${lastmod}${alternates}${xDefault}</url>`;
		})
		.join("");
	return (
		`<?xml version="1.0" encoding="UTF-8"?>` +
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">` +
		urls +
		`</urlset>`
	);
}

/** Max updatedAt across sitemap entries, for Last-Modified. */
export function sitemapLastModified(entries: SitemapEntry[]): number | null {
	let max: number | null = null;
	for (const e of entries) {
		if (e.lastmod !== null && (max === null || e.lastmod > max))
			max = e.lastmod;
	}
	return max;
}
