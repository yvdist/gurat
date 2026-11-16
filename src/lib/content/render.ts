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

// Phase-2 placeholder for figure image URLs. Media lives in R2 from Phase 5;
// until then the seed carries no figure nodes, so every call site passes an
// empty map and unknown mediaIds fail loudly at render time.
export function variantUrl(mediaRow: Media): string {
	return `/media/${mediaRow.id}/placeholder`;
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

function renderInline(inline: Inline, path: string): string {
	switch (inline.type) {
		case "text":
			return renderInlineText(inline.text, inline.marks, path);
		case "hardBreak":
			return "<br>";
		default:
			throw new RenderError(path, "unknown inline node");
	}
}

function renderInlines(inlines: Inline[] | undefined, path: string): string {
	if (inlines === undefined) return "";
	return inlines.map((n, i) => renderInline(n, `${path}[${i}]`)).join("");
}

function plainTextOf(inlines: Inline[] | undefined): string {
	if (inlines === undefined) return "";
	return inlines
		.map((n) => {
			if (n.type === "text") return n.text;
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

function renderFigure(
	node: Figure,
	ctx: RenderContext,
	path: string,
): { html: string; plain: string } {
	const mediaRow = ctx.media.get(node.attrs.mediaId);
	if (mediaRow === undefined) {
		throw new RenderError(path, `unknown mediaId ${node.attrs.mediaId}`);
	}
	const alt = node.attrs.alt === "" ? mediaRow.altDefault : node.attrs.alt;
	const img = `<img src="${escapeHtml(variantUrl(mediaRow))}" alt="${escapeHtml(alt)}">`;
	const caption =
		node.attrs.caption === ""
			? ""
			: `<figcaption>${escapeHtml(node.attrs.caption)}</figcaption>`;
	return {
		html: `<figure class="layout-${node.attrs.layout}">${img}${caption}</figure>`,
		plain: node.attrs.caption,
	};
}

interface BlockState {
	toc: TocEntry[];
	slugCounts: Map<string, number>;
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
	const inner = renderInlines(node.content, `${path}.content`);
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
				html: `<p>${renderInlines(node.content, `${path}.content`)}</p>`,
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
		case "bulletList":
			return renderListItems(node.content, ctx, state, `${path}.content`, "ul");
		case "orderedList":
			return renderListItems(node.content, ctx, state, `${path}.content`, "ol");
		case "codeBlock": {
			const body = (node.content ?? [])
				.map((t) => escapeHtml(t.text))
				.join("");
			return {
				html: `<pre><code${codeClass(node.attrs.language)}>${body}</code></pre>`,
				plain: (node.content ?? []).map((t) => t.text).join(""),
			};
		}
		case "horizontalRule":
			return { html: "<hr>", plain: "" };
		case "figure":
			return renderFigure(node, ctx, path);
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
	const state: BlockState = { toc: [], slugCounts: new Map() };
	const parts = doc.content.map((b, i) =>
		renderBlock(b, ctx, state, `content[${i}]`),
	);
	const html = parts.map((p) => p.html).join("");
	const plainText = parts.map((p) => p.plain).join("\n\n");
	const readingMinutes = Math.max(
		1,
		Math.round(countWords(plainText, ctx.locale) / 200),
	);
	return { html, toc: state.toc, plainText, readingMinutes };
}
