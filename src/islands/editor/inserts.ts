import type { Editor } from "@tiptap/core";

// Block inserts + link helpers — `(editor, …)` functions. The component owns
// dialog `$state` (linkHref, linkError, popover) and calls these for the
// editor mutations.

export function insertPullquote(editor: Editor | null): void {
	editor
		?.chain()
		.focus()
		.insertContent({
			type: "pullquote",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "Quote" }] },
			],
		})
		.run();
}

export function insertFootnote(editor: Editor | null): void {
	editor
		?.chain()
		.focus()
		.insertContent({
			type: "footnote",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "Footnote" }] },
			],
		})
		.run();
}

export function togglePullquote(editor: Editor | null): void {
	if (!editor) return;
	if (editor.isActive("pullquote")) {
		editor.chain().focus().lift("pullquote").run();
	} else {
		// Wrap the current block in a pullquote.
		editor.chain().focus().wrapIn("pullquote").run();
	}
}

export function stripLinkAttrs(html: string): string {
	// Paste cleanup: keep only href (+title) on pasted links — drop
	// target/rel/class so pasted JSON never carries schema-foreign attrs.
	return html.replaceAll(/<a\b([^>]*)>/gi, (...args: [string, string]) => {
		const attrs = args[1];
		const href = /href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i.exec(attrs)?.[1] ?? "";
		const title =
			/title\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i.exec(attrs)?.[1] ?? "";
		return `<a href=${href}${title ? ` title=${title}` : ""}>`;
	});
}

/** Href allowlist (mirrors `editorDoc.ts` + `render.ts`): http(s), mailto,
 * site-relative (not `//`), `#`, `?`. Returns the error message or null. */
export function validateLinkHref(href: string): string | null {
	const ERROR = "Only http(s), mailto, and site-relative links are allowed.";
	try {
		const url =
			href.startsWith("/") && !href.startsWith("//")
				? new URL(href, "https://x.invalid")
				: href.startsWith("#") || href.startsWith("?")
					? new URL(`https://x.invalid/${href}`)
					: new URL(href);
		const proto =
			href.startsWith("/") && !href.startsWith("//")
				? "relative"
				: href.startsWith("#") || href.startsWith("?")
					? "fragment"
					: url.protocol;
		if (
			!["relative", "fragment", "http:", "https:", "mailto:"].includes(proto)
		) {
			return ERROR;
		}
	} catch {
		return ERROR;
	}
	return null;
}

export function applyLinkHref(editor: Editor | null, href: string): void {
	if (!editor) return;
	if (href !== "") {
		editor.chain().focus().setLink({ href }).run();
	} else {
		editor.chain().focus().unsetLink().run();
	}
}
