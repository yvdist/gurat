import { Node } from "@tiptap/core";

// Editor node definitions — names match the schema `type` values 1:1 so
// stored JSON round-trips through Tiptap unchanged. Pure module: no Svelte
// `$state`; the component owns all state.

export const Footnote = Node.create({
	name: "footnote",
	group: "block",
	content: "block+",
	parseHTML() {
		return [{ tag: "section.footnotes" }];
	},
	renderHTML({ HTMLAttributes }) {
		return ["section", { ...HTMLAttributes, class: "footnotes" }, 0];
	},
});

export const Pullquote = Node.create({
	name: "pullquote",
	group: "block",
	content: "block+",
	parseHTML() {
		return [{ tag: "figure.pullquote" }];
	},
	renderHTML({ HTMLAttributes }) {
		return ["figure", { ...HTMLAttributes, class: "pullquote" }, 0];
	},
});

/** Preview-URL resolver injected by the component (owns the cache + base). */
export type PreviewFn = (mediaId: string) => string;

export function createFigureView(preview: PreviewFn) {
	return Node.create({
		name: "figure",
		group: "block",
		atom: true,
		selectable: true,
		addAttributes() {
			return {
				mediaId: { default: "" },
				alt: { default: "" },
				caption: { default: "" },
				layout: { default: "inline" },
			};
		},
		parseHTML() {
			return [{ tag: "figure" }];
		},
		renderHTML({ node, HTMLAttributes }) {
			const attrs = node.attrs as Record<string, string>;
			return [
				"figure",
				{ ...HTMLAttributes, class: `layout-${attrs.layout ?? "inline"}` },
				[
					"img",
					{
						src: preview(attrs.mediaId ?? ""),
						alt: attrs.alt ?? "",
					},
				],
				...(attrs.caption ? [["figcaption", {}, attrs.caption] as const] : []),
			];
		},
	});
}
