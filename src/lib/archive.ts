import { type Locale, SITE } from "../config/site";
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
