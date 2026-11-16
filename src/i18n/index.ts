import en from "./en.json";
import { SITE, type Locale } from "../config/site";

export type UIKey = keyof typeof en;

export function t(locale: Locale, key: UIKey): string {
	if (locale === SITE.defaultLocale) return en[key];
	// Dynamic import would split per-locale chunks on the client; this module
	// is server-only in Phase 1, so a static import keeps it simple and typed.
	return idStrings[key] ?? en[key];
}

// Static import keeps both dictionaries in the same bundle and lets the
// key-drift test compare them directly.
import idStrings from "./id.json";

// en-first path: default locale has no prefix; others are prefixed.
export function localizePath(path: string, locale: Locale): string {
	const clean = path.startsWith("/") ? path : `/${path}`;
	if (locale === SITE.defaultLocale) return clean;
	if (clean === "/") return `/${locale}`;
	if (clean === `/${locale}` || clean.startsWith(`/${locale}/`)) return clean;
	return `/${locale}${clean}`;
}

export function detectLocaleFromPath(path: string): Locale {
	for (const locale of SITE.locales) {
		if (locale === SITE.defaultLocale) continue;
		if (path === `/${locale}` || path.startsWith(`/${locale}/`)) return locale;
	}
	return SITE.defaultLocale;
}

export function alternatesFor(post: { locale: Locale; slug: string }): {
	locale: Locale;
	href: string;
}[] {
	return SITE.locales
		.filter((l) => l !== post.locale)
		.map((locale) => ({
			locale,
			href: locale === SITE.defaultLocale ? `/${post.slug}` : `/${locale}/${post.slug}`,
		}));
}
