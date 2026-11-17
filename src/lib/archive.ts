import { type Locale, SITE } from "../config/site";
import { localizePath } from "../i18n";
import type { PublishedPost } from "../server/db";

// Groups posts by publication year in the configured display timezone,
// newest year first. Pure helper shared by the EN and ID archive pages.
export function groupByYear(
	posts: PublishedPost[],
): { year: string; posts: PublishedPost[] }[] {
	const groups = new Map<string, PublishedPost[]>();
	const fmt = new Intl.DateTimeFormat("en", {
		year: "numeric",
		timeZone: SITE.timezone,
	});
	for (const post of posts) {
		if (post.publishedAt === null) continue;
		const year = fmt.format(new Date(post.publishedAt));
		const list = groups.get(year) ?? [];
		list.push(post);
		groups.set(year, list);
	}
	return [...groups.entries()]
		.sort(([a], [b]) => (a < b ? 1 : -1))
		.map(([year, yearPosts]) => ({ year, posts: yearPosts }));
}

// hreflang pairs for a locale-rooted path: the unprefixed path plus self.
// Same list serves both locales (EN unprefixed, ID under /id).
export function rootHreflangs(
	path: string,
): { locale: Locale; href: string }[] {
	return SITE.locales.map((l) => ({
		locale: l,
		href: l === SITE.defaultLocale ? path : `/${l}${path === "/" ? "" : path}`,
	}));
}
export interface HreflangLink {
	locale: Locale;
	href: string;
}

// Post hreflangs: self first, then visible translations. Symmetric by
// construction — each listed href's own page lists back (same group ids).
export function postHreflangs(
	locale: Locale,
	slug: string,
	translations: { locale: Locale; slug: string }[],
): HreflangLink[] {
	return [
		{ locale, href: localizePath(`/writing/${slug}`, locale) },
		...translations.map((tr) => ({
			locale: tr.locale,
			href: localizePath(`/writing/${tr.slug}`, tr.locale),
		})),
	];
}

// Tag pages share one slug namespace, so the EN/ID pair are true alternates.
export function tagHreflangs(slug: string): HreflangLink[] {
	return SITE.locales.map((locale) => ({
		locale,
		href: localizePath(`/tags/${slug}`, locale),
	}));
}
