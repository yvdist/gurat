import { z } from "zod";

// Content schema — the single source of truth for the ProseMirror/Tiptap JSON
// allowlist (spec 02 §2.1). The editor (Phase 4) derives its extensions from
// this module; the renderer (`render.ts`) consumes its `Doc` output.
//
// Strict everywhere (`.strict()`): unknown nodes/marks/attrs fail with a
// path-aware zod error (error paths used as-is, never wrapped).
//
// Member schemas are intentionally left un-annotated so zod keeps their
// literal discriminators (zod 4 `discriminatedUnion` rejects members widened
// to bare `z.ZodType`). Only the recursive `BlockSchema` carries an explicit
// type, which recursion requires.
//
// EXTENSION POINT: future block nodes (e.g. `callout`) are added here — a
// new interface plus its schema in the `Block` union below, plus a branch in
// `renderDoc`. Nothing else needs to change: validation and rendering both
// dispatch on this union.

export interface BoldMark {
	type: "bold";
}

export interface ItalicMark {
	type: "italic";
}

export interface CodeMark {
	type: "code";
}

export interface LinkMark {
	type: "link";
	attrs: {
		href: string;
		title?: string;
	};
}

export type Mark = BoldMark | ItalicMark | CodeMark | LinkMark;

export interface DocText {
	type: "text";
	text: string;
	marks?: Mark[];
}

export interface HardBreak {
	type: "hardBreak";
}

export interface Sidenote {
	type: "sidenote";
	attrs: {
		label: string;
	};
	content: Inline[];
}

export type Inline = DocText | HardBreak | Sidenote;

export interface Paragraph {
	type: "paragraph";
	content?: Inline[];
}

export interface Heading {
	type: "heading";
	attrs: {
		level: 2 | 3 | 4;
	};
	content?: Inline[];
}

export interface Blockquote {
	type: "blockquote";
	content: Block[];
}

export interface BulletList {
	type: "bulletList";
	content: ListItem[];
}

export interface OrderedList {
	type: "orderedList";
	content: ListItem[];
}

export interface ListItem {
	type: "listItem";
	content: Block[];
}

export interface CodeText {
	type: "text";
	text: string;
}

export interface CodeBlock {
	type: "codeBlock";
	attrs: {
		language: string;
	};
	content?: CodeText[];
}

export interface HorizontalRule {
	type: "horizontalRule";
}

export interface Figure {
	type: "figure";
	attrs: {
		mediaId: string;
		alt: string;
		caption: string;
		layout: "inline" | "wide" | "full";
	};
}

export interface Pullquote {
	type: "pullquote";
	content: Block[];
}

export interface Footnote {
	type: "footnote";
	content: Block[];
}

export type Block =
	| Paragraph
	| Heading
	| Blockquote
	| BulletList
	| OrderedList
	| CodeBlock
	| HorizontalRule
	| Figure
	| Pullquote
	| Footnote;

export interface Doc {
	type: "doc";
	content: Block[];
}

const BoldMarkSchema = z.object({ type: z.literal("bold") }).strict();

const ItalicMarkSchema = z.object({ type: z.literal("italic") }).strict();

const CodeMarkSchema = z.object({ type: z.literal("code") }).strict();

const LinkMarkSchema = z
	.object({
		type: z.literal("link"),
		attrs: z
			.object({ href: z.string(), title: z.string().optional() })
			.strict(),
	})
	.strict();

const MarkSchema = z.discriminatedUnion("type", [
	BoldMarkSchema,
	ItalicMarkSchema,
	CodeMarkSchema,
	LinkMarkSchema,
]);

const DocTextSchema = z
	.object({
		type: z.literal("text"),
		text: z.string(),
		marks: z.array(MarkSchema).optional(),
	})
	.strict();

const HardBreakSchema = z.object({ type: z.literal("hardBreak") }).strict();

// Assigned below: sidenotes nest inlines (e.g. a link inside a sidenote).
let InlineSchema: z.ZodType<Inline>;
const lazyInline = (): z.ZodType<Inline> => InlineSchema;

const SidenoteSchema = z
	.object({
		type: z.literal("sidenote"),
		attrs: z.object({ label: z.string() }).strict(),
		content: z.array(z.lazy(lazyInline)).min(1),
	})
	.strict();

InlineSchema = z.discriminatedUnion("type", [
	DocTextSchema,
	HardBreakSchema,
	SidenoteSchema,
]);

// Assigned below after the container schemas (they reference it lazily).
let BlockSchema: z.ZodType<Block>;
const lazyBlock = (): z.ZodType<Block> => BlockSchema;

const ParagraphSchema = z
	.object({
		type: z.literal("paragraph"),
		content: z.array(InlineSchema).optional(),
	})
	.strict();

const HeadingSchema = z
	.object({
		type: z.literal("heading"),
		attrs: z
			.object({ level: z.union([z.literal(2), z.literal(3), z.literal(4)]) })
			.strict(),
		content: z.array(InlineSchema).optional(),
	})
	.strict();

const BlockquoteSchema = z
	.object({
		type: z.literal("blockquote"),
		content: z.array(z.lazy(lazyBlock)).min(1),
	})
	.strict();

const ListItemSchema = z
	.object({
		type: z.literal("listItem"),
		content: z.array(z.lazy(lazyBlock)).min(1),
	})
	.strict();

const BulletListSchema = z
	.object({
		type: z.literal("bulletList"),
		content: z.array(ListItemSchema).min(1),
	})
	.strict();

const OrderedListSchema = z
	.object({
		type: z.literal("orderedList"),
		content: z.array(ListItemSchema).min(1),
	})
	.strict();

const CodeTextSchema = z
	.object({ type: z.literal("text"), text: z.string() })
	.strict();

const CodeBlockSchema = z
	.object({
		type: z.literal("codeBlock"),
		attrs: z.object({ language: z.string() }).strict(),
		content: z.array(CodeTextSchema).optional(),
	})
	.strict();

const HorizontalRuleSchema = z
	.object({ type: z.literal("horizontalRule") })
	.strict();

const FigureSchema = z
	.object({
		type: z.literal("figure"),
		attrs: z
			.object({
				mediaId: z.string(),
				alt: z.string(),
				caption: z.string(),
				layout: z.enum(["inline", "wide", "full"]),
			})
			.strict(),
	})
	.strict();

const PullquoteSchema = z
	.object({
		type: z.literal("pullquote"),
		content: z.array(z.lazy(lazyBlock)).min(1),
	})
	.strict();

const FootnoteSchema = z
	.object({
		type: z.literal("footnote"),
		content: z.array(z.lazy(lazyBlock)).min(1),
	})
	.strict();

BlockSchema = z.discriminatedUnion("type", [
	ParagraphSchema,
	HeadingSchema,
	BlockquoteSchema,
	BulletListSchema,
	OrderedListSchema,
	CodeBlockSchema,
	HorizontalRuleSchema,
	FigureSchema,
	PullquoteSchema,
	FootnoteSchema,
]);

const DocSchema = z
	.object({
		type: z.literal("doc"),
		content: z.array(z.lazy(lazyBlock)).min(1),
	})
	.strict();

export function validateDoc(json: unknown): Doc {
	return DocSchema.parse(json);
}
