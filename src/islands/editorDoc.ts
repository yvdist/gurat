import type { Doc } from "../lib/content/schema";
import { validateDoc } from "../lib/content/schema";

// Pure bridge between Tiptap's JSON and the schema allowlist (spec 04 §4.3).
// No DOM: workerd-testable. `docToTiptap` is identity-shaped (our JSON is
// already Tiptap-shaped); `tiptapToDoc` strips everything outside the
// allowlist, then `validateDoc` enforces the rest.
// Mirrors the renderer's href allowlist (`render.ts`): http(s), mailto,
// site-relative (not `//`), `#`, `?`. Invalid → mark dropped, text kept.

function isAllowedHref(href: string): boolean {
	if (href.startsWith("/") && !href.startsWith("//")) return true;
	if (href.startsWith("#") || href.startsWith("?")) return true;
	try {
		const url = new URL(href);
		return (
			url.protocol === "http:" ||
			url.protocol === "https:" ||
			url.protocol === "mailto:"
		);
	} catch {
		return false;
	}
}

function stripMark(mark: unknown): Record<string, unknown> | null {
	if (typeof mark !== "object" || mark === null) return null;
	const m = mark as Record<string, unknown>;
	switch (m.type) {
		case "bold":
		case "italic":
		case "code":
			return { type: m.type };
		case "link": {
			// Drop target/rel/class — only href + optional title survive.
			const attrs =
				typeof m.attrs === "object" && m.attrs !== null
					? (m.attrs as Record<string, unknown>)
					: {};
			const href = typeof attrs.href === "string" ? attrs.href : "";
			if (!isAllowedHref(href)) return null;
			const out: Record<string, unknown> = {
				type: "link",
				attrs: { href },
			};
			const linkAttrs = out.attrs as Record<string, unknown>;
			if (typeof attrs.title === "string" && attrs.title !== "") {
				linkAttrs.title = attrs.title;
			}
			return out;
		}
		default:
			return null;
	}
}

function stripMarks(marks: unknown): Record<string, unknown>[] | undefined {
	if (!Array.isArray(marks)) return undefined;
	const kept = marks
		.map(stripMark)
		.filter((m): m is Record<string, unknown> => m !== null);
	return kept.length > 0 ? kept : undefined;
}

function stripInline(node: unknown): Record<string, unknown> | null {
	if (typeof node !== "object" || node === null) return null;
	const n = node as Record<string, unknown>;
	switch (n.type) {
		case "text": {
			if (typeof n.text !== "string") return null;
			const out: Record<string, unknown> = { type: "text", text: n.text };
			const marks = stripMarks(n.marks);
			if (marks !== undefined) out.marks = marks;
			return out;
		}
		case "hardBreak":
			return { type: "hardBreak" };
		case "sidenote": {
			// Label only; nested inlines recurse (links inside survive).
			const attrs =
				typeof n.attrs === "object" && n.attrs !== null
					? (n.attrs as Record<string, unknown>)
					: {};
			const label = typeof attrs.label === "string" ? attrs.label : "";
			const content = Array.isArray(n.content)
				? n.content
						.map(stripInline)
						.filter((c): c is Record<string, unknown> => c !== null)
				: [];
			return { type: "sidenote", attrs: { label }, content };
		}
		default:
			return null;
	}
}

function stripInlines(content: unknown): Record<string, unknown>[] {
	if (!Array.isArray(content)) return [];
	return content
		.map(stripInline)
		.filter((c): c is Record<string, unknown> => c !== null);
}

function stripCodeText(node: unknown): Record<string, unknown> | null {
	if (typeof node !== "object" || node === null) return null;
	const n = node as Record<string, unknown>;
	if (n.type !== "text" || typeof n.text !== "string") return null;
	return { type: "text", text: n.text };
}

function stripBlock(node: unknown): Record<string, unknown> | null {
	if (typeof node !== "object" || node === null) return null;
	const n = node as Record<string, unknown>;
	switch (n.type) {
		case "paragraph":
			return n.content === undefined
				? { type: "paragraph" }
				: { type: "paragraph", content: stripInlines(n.content) };
		case "heading": {
			const attrs =
				typeof n.attrs === "object" && n.attrs !== null
					? (n.attrs as Record<string, unknown>)
					: {};
			const level =
				attrs.level === 2 || attrs.level === 3 || attrs.level === 4
					? attrs.level
					: 2;
			return n.content === undefined
				? { type: "heading", attrs: { level } }
				: {
						type: "heading",
						attrs: { level },
						content: stripInlines(n.content),
					};
		}
		case "blockquote":
			return {
				type: "blockquote",
				content: stripBlocks(n.content),
			};
		case "bulletList":
		case "orderedList":
			return {
				type: n.type,
				content: Array.isArray(n.content)
					? (
							n.content.map((item): Record<string, unknown> | null =>
								typeof item === "object" &&
								item !== null &&
								(item as Record<string, unknown>).type === "listItem"
									? {
											type: "listItem",
											content: stripBlocks(
												(item as Record<string, unknown>).content,
											),
										}
									: null,
							) as (Record<string, unknown> | null)[]
						).filter((c): c is Record<string, unknown> => c !== null)
					: [],
			};
		case "codeBlock": {
			// Language only — drop any other attrs Tiptap adds.
			const attrs =
				typeof n.attrs === "object" && n.attrs !== null
					? (n.attrs as Record<string, unknown>)
					: {};
			const language = typeof attrs.language === "string" ? attrs.language : "";
			const content = Array.isArray(n.content)
				? n.content
						.map(stripCodeText)
						.filter((c): c is Record<string, unknown> => c !== null)
				: [];
			return { type: "codeBlock", attrs: { language }, content };
		}
		case "horizontalRule":
			return { type: "horizontalRule" };
		case "figure": {
			const attrs =
				typeof n.attrs === "object" && n.attrs !== null
					? (n.attrs as Record<string, unknown>)
					: {};
			const layout =
				attrs.layout === "wide" || attrs.layout === "full"
					? attrs.layout
					: "inline";
			return {
				type: "figure",
				attrs: {
					mediaId: typeof attrs.mediaId === "string" ? attrs.mediaId : "",
					alt: typeof attrs.alt === "string" ? attrs.alt : "",
					caption: typeof attrs.caption === "string" ? attrs.caption : "",
					layout,
				},
			};
		}
		case "pullquote":
		case "footnote":
			return { type: n.type, content: stripBlocks(n.content) };
		default:
			return null;
	}
}

function stripBlocks(content: unknown): Record<string, unknown>[] {
	if (!Array.isArray(content)) return [];
	return content
		.map(stripBlock)
		.filter((b): b is Record<string, unknown> => b !== null);
}

/** Identity-shaped: our stored JSON is already Tiptap-shaped. */
export function docToTiptap(doc: Doc): unknown {
	return JSON.parse(JSON.stringify(doc)) as unknown;
}

/**
 * Strip Tiptap output down to the schema allowlist, then validate.
 * Unknown nodes/marks/attrs are dropped here (paste cleanup); anything
 * that survives but violates the schema throws via `validateDoc` with a
 * content path (schema-drift tripwire in the round-trip test).
 */
export function tiptapToDoc(json: unknown): Doc {
	if (typeof json !== "object" || json === null) {
		return validateDoc({ type: "doc", content: [{ type: "paragraph" }] });
	}
	const root = json as Record<string, unknown>;
	const stripped: { type: "doc"; content: Record<string, unknown>[] } = {
		type: "doc",
		content: stripBlocks(root.content),
	};
	if (stripped.content.length === 0) {
		// New-post blank state: the schema requires ≥ 1 block. A single
		// empty paragraph is the only auto-insert `tiptapToDoc` performs;
		// everything else is author content.
		stripped.content = [{ type: "paragraph" }];
	}
	return validateDoc(stripped);
}
