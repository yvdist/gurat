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

// hreflang pairs for a locale-rooted path. Callers pass their page canonical,
// which on ID pages already carries the `/id` prefix — strip any locale
// prefix first so both locales point at the true alternates.
export function rootHreflangs(path: string): HreflangLink[] {
	const bare = path.replace(/^\/(en|id)(?=\/|$)/, "") || "/";
	return SITE.locales.map((l) => ({
		locale: l,
		href: l === SITE.defaultLocale ? bare : `/${l}${bare === "/" ? "" : bare}`,
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
// Listing-surface cover resolution (archive rows, tag strips, about
// portrait). Seed posts carry no `cover_media_id`, so covers resolve from
// body figures: explicit cover first, else the first figure in the stored
// editor doc, else null — callers render a title-only row, never a
// placeholder box.
export interface FigureRef {
	mediaId: string;
	alt: string;
	caption: string;
}

// All figure references in document order (empty array on bad JSON).
export function figureRefs(contentJson: string): FigureRef[] {
	const found: FigureRef[] = [];
	try {
		const walk = (node: unknown): void => {
			if (typeof node !== "object" || node === null) return;
			const n = node as {
				type?: unknown;
				attrs?: unknown;
				content?: unknown;
			};
			if (
				n.type === "figure" &&
				typeof n.attrs === "object" &&
				n.attrs !== null
			) {
				const attrs = n.attrs as Record<string, unknown>;
				const mediaId = attrs.mediaId;
				if (typeof mediaId === "string" && mediaId !== "") {
					found.push({
						mediaId,
						alt: typeof attrs.alt === "string" ? attrs.alt : "",
						caption: typeof attrs.caption === "string" ? attrs.caption : "",
					});
				}
			}
			if (Array.isArray(n.content)) for (const child of n.content) walk(child);
		};
		walk(JSON.parse(contentJson) as unknown);
	} catch {
		return [];
	}
	return found;
}

export function listingCoverId(post: {
	coverMediaId: string | null;
	contentJson: string;
}): string | null {
	if (post.coverMediaId !== null && post.coverMediaId !== "") {
		return post.coverMediaId;
	}
	return figureRefs(post.contentJson).at(0)?.mediaId ?? null;
}
