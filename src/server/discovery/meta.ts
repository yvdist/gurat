import type { Locale } from "../../config/site";

export interface BlogPostingInput {
	siteName: string;
	locale: Locale;
	headline: string;
	description: string;
	canonicalUrl: string;
	ogImage: string;
	publishedAt: number;
	updatedAt: number;
}

/**
 * Pre-serialized BlogPosting JSON-LD. The layout injects it via `set:html`;
 * safe because every value is a validated post field serialized with
 * `JSON.stringify` (never author HTML — same argument as ArticleBody).
 */
export function buildBlogPosting(input: BlogPostingInput): string {
	return JSON.stringify({
		"@context": "https://schema.org",
		"@type": "BlogPosting",
		headline: input.headline,
		description: input.description,
		inLanguage: input.locale,
		datePublished: new Date(input.publishedAt).toISOString(),
		dateModified: new Date(input.updatedAt).toISOString(),
		author: { "@type": "Person", name: input.siteName },
		image: [input.ogImage],
		mainEntityOfPage: input.canonicalUrl,
		url: input.canonicalUrl,
	});
}
