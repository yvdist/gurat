// Embedded-JSON serializer for the admin media library payload.
//
// The `media-data` script element in `src/pages/admin/media.astro` carries
// user-controlled strings (alt text, ids, post slugs). Raw `JSON.stringify`
// output can contain `</script` or `<!--`, which terminate or confuse the
// script element — the truncated remainder is not JSON and the page's only
// client script dies in `JSON.parse`. Escaped output stays valid JSON that
// decodes back exactly (`<\/` → `</`, `\u0021` → `!`). `</` and `<!--` are
// the only sequences that can close or confusion-parse a script element
// (HTML §4.12.1.3 script data escaped states). `&` and bare `<` are inert
// inside script elements per the HTML spec, so nothing else needs escaping.
export interface MediaPayloadItem {
	id: string;
	altDefault: string;
	width: number;
	height: number;
	variantsJson: string;
	useCount: number;
	posts: string[];
}

/** Serialize library items to JSON safe for embedding in a script element. */
export function serializeMediaPayload(
	items: readonly MediaPayloadItem[],
): string {
	return JSON.stringify(items)
		.replaceAll("</", "<\\/")
		.replaceAll("<!--", "<\\u0021--");
}
