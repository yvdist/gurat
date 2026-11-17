import type { Locale } from "../../config/site";
import type { Media } from "../../server/db/schema";
import type {
	Block,
	Doc,
	Figure,
	Heading,
	Inline,
	ListItem,
	Mark,
	Sidenote,
} from "./schema";

// Pure renderer: Tiptap allowlist JSON → HTML + toc + plain text + reading
// time. No DOM, no Node-only APIs — safe on workerd. Every allowlisted
// node/mark at any depth is handled; anything else throws RenderError with
// the content path (never silently drop content). All text and attribute
// values are escaped by construction.

export class RenderError extends Error {
	path: string;

	constructor(path: string, message: string) {
		super(`render error at ${path}: ${message}`);
		this.name = "RenderError";
		this.path = path;
	}
}

export interface RenderContext {
	locale: Locale;
	media: Map<string, Media>;
	/** Public origin for media URLs; empty = same-origin `/media/...`. */
	baseUrl: string;
	/** Cover media id: treated as above-the-fold (eager + fetchpriority). */
	coverMediaId?: string | null;
}

export interface TocEntry {
	id: string;
	text: string;
	level: number;
}

export interface RenderResult {
	html: string;
	toc: TocEntry[];
	plainText: string;
	readingMinutes: number;
}

export function escapeHtml(s: string): string {
	return s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

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

function isExternalHref(href: string): boolean {
	try {
		const url = new URL(href);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

function slugify(text: string): string {
	const slug = text
		.toLowerCase()
		.normalize("NFKD")
		.replaceAll(/[\u0300-\u036f]/g, "")
		.replaceAll(/[^a-z0-9]+/g, "-")
		.replaceAll(/^-+|-+$/g, "");
	return slug === "" ? "section" : slug;
}

// Single URL rule (spec 05 §5.4): `baseUrl` (MEDIA_BASE_URL) + `/media/<id>/<w>.webp`.
// Empty base = same-origin (local dev route); absolute origin = public R2.
export function variantUrl(
	mediaRow: Media,
	width: number,
	baseUrl: string,
): string {
	const prefix = baseUrl.replace(/\/+$/, "");
	return `${prefix}/media/${mediaRow.id}/${width}.webp`;
}

/** Ascending `${url} ${w}w` srcset from stored variants; falls back to the single stored width. */
export function srcsetFor(mediaRow: Media, baseUrl: string): string {
	let widths: number[] | null = null;
	try {
		const v: unknown = JSON.parse(mediaRow.variantsJson);
		if (Array.isArray(v)) {
			const ws: number[] = [];
			for (const item of v) {
				if (typeof item === "object" && item !== null) {
					const w = (item as Record<string, unknown>).w;
					if (typeof w === "number" && Number.isInteger(w) && w > 0) ws.push(w);
				}
			}
			if (ws.length > 0) widths = [...new Set(ws)].sort((a, b) => a - b);
		}
	} catch {
		widths = null;
	}
	const list = widths ?? [mediaRow.width];
	return list
		.map((w) => `${variantUrl(mediaRow, w, baseUrl)} ${w}w`)
		.join(", ");
}

/** Largest variant URL (src fallback); falls back to the single stored width. */
export function largestVariantUrl(mediaRow: Media, baseUrl: string): string {
	const srcset = srcsetFor(mediaRow, baseUrl);
	const last = srcset.split(", ").pop() ?? "";
	const url = last.split(" ")[0] ?? "";
	return url === "" ? variantUrl(mediaRow, mediaRow.width, baseUrl) : url;
}

function renderMark(mark: Mark, inner: string, path: string): string {
	switch (mark.type) {
		case "bold":
			return `<strong>${inner}</strong>`;
		case "italic":
			return `<em>${inner}</em>`;
		case "code":
			return `<code>${inner}</code>`;
		case "link": {
			const href = mark.attrs.href;
			if (!isAllowedHref(href)) return inner;
			const title =
				mark.attrs.title !== undefined
					? ` title="${escapeHtml(mark.attrs.title)}"`
					: "";
			const rel = isExternalHref(href) ? ' rel="noopener noreferrer"' : "";
			return `<a href="${escapeHtml(href)}"${title}${rel}>${inner}</a>`;
		}
		default:
			throw new RenderError(path, "unknown mark");
	}
}

function renderInlineText(
	text: string,
	marks: Mark[] | undefined,
	path: string,
): string {
	const escaped = escapeHtml(text);
	if (marks === undefined) return escaped;
	return marks.reduceRight(
		(inner, mark, i) => renderMark(mark, inner, `${path}.marks[${i}]`),
		escaped,
	);
}

// Sidenote: inline span with an escaped label; numbering k is document order
// (pre-order traversal). Wide screens float it into the sidenote column via
// CSS; narrow screens show it as an inline marginal block. Inline footnote
// references are sidenote spans whose content links `#fn-{k}` — the author
// pairs them with the footnote blocks below; the renderer does not
// cross-validate.
function renderSidenote(
	node: Sidenote,
	state: BlockState,
	path: string,
): string {
	const k = state.sidenoteCount + 1;
	state.sidenoteCount = k;
	const inner = renderInlines(node.content, state, `${path}.content`);
	return `<span class="sidenote" id="sn-${k}"><span class="sidenote-label">${escapeHtml(node.attrs.label)}</span>${inner}</span>`;
}

function renderInline(inline: Inline, state: BlockState, path: string): string {
	switch (inline.type) {
		case "text":
			return renderInlineText(inline.text, inline.marks, path);
		case "hardBreak":
			return "<br>";
		case "sidenote":
			return renderSidenote(inline, state, path);
		default:
			throw new RenderError(path, "unknown inline node");
	}
}

function renderInlines(
	inlines: Inline[] | undefined,
	state: BlockState,
	path: string,
): string {
	if (inlines === undefined) return "";
	return inlines
		.map((n, i) => renderInline(n, state, `${path}[${i}]`))
		.join("");
}

function plainTextOf(inlines: Inline[] | undefined): string {
	if (inlines === undefined) return "";
	return inlines
		.map((n) => {
			if (n.type === "text") return n.text;
			if (n.type === "sidenote") return plainTextOf(n.content);
			return "";
		})
		.join(" ");
}

const LANGUAGE_RE = /^[a-zA-Z0-9+-]{1,32}$/;

function codeClass(language: string): string {
	return LANGUAGE_RE.test(language)
		? ` class="language-${escapeHtml(language)}"`
		: "";
}

const SIZES_BY_LAYOUT: Record<Figure["attrs"]["layout"], string> = {
	inline: "(max-width: 768px) 100vw, 68ch",
	wide: "(max-width: 1280px) 100vw, 1200px",
	full: "100vw",
};

const DOMINANT_RE = /^#[0-9a-f]{6}$/i;

function renderFigure(
	node: Figure,
	ctx: RenderContext,
	state: BlockState,
	path: string,
): { html: string; plain: string } {
	const mediaRow = ctx.media.get(node.attrs.mediaId);
	if (mediaRow === undefined) {
		throw new RenderError(path, `unknown mediaId ${node.attrs.mediaId}`);
	}
	let widths: number[];
	try {
		const v: unknown = JSON.parse(mediaRow.variantsJson);
		if (!Array.isArray(v)) {
			throw new RenderError(path, "bad variants_json");
		}
		const ws: number[] = [];
		for (const item of v) {
			if (typeof item !== "object" || item === null) {
				throw new RenderError(path, "bad variants_json");
			}
			const w = (item as Record<string, unknown>).w;
			if (typeof w !== "number" || !Number.isInteger(w) || w <= 0) {
				throw new RenderError(path, "bad variants_json");
			}
			ws.push(w);
		}
		const ordered = [...new Set(ws)].sort((a, b) => a - b);
		// Empty array (no recorded variants) falls back to the stored width.
		widths = ordered.length > 0 ? ordered : [mediaRow.width];
	} catch (err) {
		if (err instanceof RenderError) throw err;
		throw new RenderError(path, "bad variants_json");
	}
	const alt = node.attrs.alt === "" ? mediaRow.altDefault : node.attrs.alt;
	const lastW = widths[widths.length - 1] ?? mediaRow.width;
	const src = variantUrl(mediaRow, lastW, ctx.baseUrl);
	const srcset = widths
		.map((w) => `${variantUrl(mediaRow, w, ctx.baseUrl)} ${w}w`)
		.join(", ");
	const sizes = SIZES_BY_LAYOUT[node.attrs.layout];
	const isFirst = state.figureCount === 0;
	const isAboveFold = isFirst || ctx.coverMediaId === node.attrs.mediaId;
	state.figureCount += 1;
	const loading = isAboveFold
		? ` loading="eager" fetchpriority="high"`
		: ` loading="lazy"`;
	const style =
		typeof mediaRow.dominantColor === "string" &&
		DOMINANT_RE.test(mediaRow.dominantColor)
			? ` style="background-color:${escapeHtml(mediaRow.dominantColor)}"`
			: "";
	const img =
		`<img src="${escapeHtml(src)}"` +
		` srcset="${escapeHtml(srcset)}"` +
		` sizes="${sizes}"` +
		` width="${mediaRow.width}" height="${mediaRow.height}"` +
		` decoding="async"${loading}` +
		` alt="${escapeHtml(alt)}"${style}>`;
	const caption =
		node.attrs.caption === ""
			? ""
			: `<figcaption>${escapeHtml(node.attrs.caption)}</figcaption>`;
	return {
		html: `<figure class="layout-${node.attrs.layout}">${img}${caption}</figure>`,
		plain: node.attrs.caption,
	};
}

interface FootnoteEntry {
	k: number;
	html: string;
}

interface BlockState {
	toc: TocEntry[];
	slugCounts: Map<string, number>;
	sidenoteCount: number;
	footnoteCount: number;
	footnotes: FootnoteEntry[];
	figureCount: number;
}

function renderHeading(
	node: Heading,
	state: BlockState,
	path: string,
): { html: string; plain: string } {
	const text = plainTextOf(node.content);
	const base = slugify(text);
	const seen = (state.slugCounts.get(base) ?? 0) + 1;
	state.slugCounts.set(base, seen);
	const id = seen === 1 ? base : `${base}-${seen}`;
	state.toc.push({ id, text, level: node.attrs.level });
	const inner = renderInlines(node.content, state, `${path}.content`);
	return {
		html: `<h${node.attrs.level} id="${escapeHtml(id)}">${inner}</h${node.attrs.level}>`,
		plain: text,
	};
}

function renderListItems(
	items: ListItem[],
	ctx: RenderContext,
	state: BlockState,
	path: string,
	tag: "ul" | "ol",
): { html: string; plain: string } {
	const rendered = items.map((item, i) => {
		const itemPath = `${path}[${i}]`;
		const parts = item.content.map((b, j) =>
			renderBlock(b, ctx, state, `${itemPath}.content[${j}]`),
		);
		return {
			html: `<li>${parts.map((p) => p.html).join("")}</li>`,
			plain: parts.map((p) => p.plain).join("\n\n"),
		};
	});
	return {
		html: `<${tag}>${rendered.map((x) => x.html).join("")}</${tag}>`,
		plain: rendered.map((x) => x.plain).join("\n\n"),
	};
}

function renderBlock(
	node: Block,
	ctx: RenderContext,
	state: BlockState,
	path: string,
): { html: string; plain: string } {
	switch (node.type) {
		case "paragraph":
			return {
				html: `<p>${renderInlines(node.content, state, `${path}.content`)}</p>`,
				plain: plainTextOf(node.content),
			};
		case "heading":
			return renderHeading(node, state, path);
		case "blockquote": {
			const parts = node.content.map((b, i) =>
				renderBlock(b, ctx, state, `${path}.content[${i}]`),
			);
			return {
				html: `<blockquote>${parts.map((p) => p.html).join("")}</blockquote>`,
				plain: parts.map((p) => p.plain).join("\n\n"),
			};
		}
		case "pullquote": {
			const parts = node.content.map((b, i) =>
				renderBlock(b, ctx, state, `${path}.content[${i}]`),
			);
			return {
				html: `<figure class="pullquote"><blockquote>${parts.map((p) => p.html).join("")}</blockquote></figure>`,
				plain: parts.map((p) => p.plain).join("\n\n"),
			};
		}
		case "footnote": {
			const k = state.footnoteCount + 1;
			state.footnoteCount = k;
			const parts = node.content.map((b, i) =>
				renderBlock(b, ctx, state, `${path}.content[${i}]`),
			);
			state.footnotes.push({
				k,
				html: parts.map((p) => p.html).join(""),
			});
			return { html: "", plain: parts.map((p) => p.plain).join("\n\n") };
		}
		case "bulletList":
			return renderListItems(node.content, ctx, state, `${path}.content`, "ul");
		case "orderedList":
			return renderListItems(node.content, ctx, state, `${path}.content`, "ol");
		case "codeBlock": {
			const body = (node.content ?? []).map((t) => escapeHtml(t.text)).join("");
			return {
				html: `<pre><code${codeClass(node.attrs.language)}>${body}</code></pre>`,
				plain: (node.content ?? []).map((t) => t.text).join(""),
			};
		}
		case "horizontalRule":
			return { html: "<hr>", plain: "" };
		case "figure":
			return renderFigure(node, ctx, state, path);
		default:
			throw new RenderError(path, "unknown block node");
	}
}

function countWords(text: string, locale: Locale): number {
	const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
	let count = 0;
	for (const seg of segmenter.segment(text)) {
		if (seg.isWordLike === true) count++;
	}
	return count;
}

export function renderDoc(doc: Doc, ctx: RenderContext): RenderResult {
	const state: BlockState = {
		toc: [],
		slugCounts: new Map(),
		sidenoteCount: 0,
		footnoteCount: 0,
		footnotes: [],
		figureCount: 0,
	};
	const parts = doc.content.map((b, i) =>
		renderBlock(b, ctx, state, `content[${i}]`),
	);
	let html = parts.map((p) => p.html).join("");
	if (state.footnotes.length > 0) {
		const items = state.footnotes
			.map(
				(f) =>
					`<li id="fn-${f.k}">${f.html} <a href="#fnref-${f.k}">↩</a></li>`,
			)
			.join("");
		html += `<section class="footnotes"><ol>${items}</ol></section>`;
	}
	const plainText = parts.map((p) => p.plain).join("\n\n");
	const readingMinutes = Math.max(
		1,
		Math.round(countWords(plainText, ctx.locale) / 200),
	);
	return { html, toc: state.toc, plainText, readingMinutes };
}
