// Shared conditional-GET helpers for discovery routes (feeds, sitemap,
// robots). ETags are SHA-256 hex of the exact response body, quoted as
// strong validators. Last-Modified is floored to whole seconds (HTTP dates
// carry no sub-second precision) before comparison.
export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text),
	);
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export function quotedEtag(hash: string): string {
	return `"${hash}"`;
}

/** True when the request's validators already match this representation. */
export function isFresh(
	request: Request,
	etag: string,
	lastModifiedMs: number | null,
): boolean {
	const inm = request.headers.get("if-none-match");
	if (inm !== null) {
		const tags = inm.split(",").map((s) => s.trim());
		if (tags.includes(etag) || tags.includes("*")) return true;
	}
	if (lastModifiedMs !== null) {
		const ims = request.headers.get("if-modified-since");
		if (ims !== null) {
			const t = Date.parse(ims);
			const lastSec = Math.floor(lastModifiedMs / 1000) * 1000;
			if (!Number.isNaN(t) && lastSec <= t) return true;
		}
	}
	return false;
}
