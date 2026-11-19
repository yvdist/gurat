import type { Editor } from "@tiptap/core";

// Slash menu: combobox issuing the same insert commands. The item list is
// built from callbacks (the component wires dialog openers); the query/edit
// operations take the `Editor` explicitly. Component owns `slashOpen`,
// `slashQuery`, `slashIndex`, `slashFrom`, `slashPos` `$state`.

export interface SlashItem {
	id: string;
	label: string;
	run: () => void;
}

export interface SlashCallbacks {
	openImageDialog: (mode: "insert" | "cover" | "pair") => void;
	setPickerLayout: (layout: string) => void;
	insertHorizontalRule: () => void;
	toggleBlockquote: () => void;
}

export function buildSlashItems(cb: SlashCallbacks): SlashItem[] {
	return [
		{
			id: "img-inline",
			label: "Image · inline",
			run: () => cb.openImageDialog("insert"),
		},
		{
			id: "img-full",
			label: "Image · full-bleed",
			run: () => {
				cb.openImageDialog("insert");
				cb.setPickerLayout("full");
			},
		},
		{
			id: "img-pair",
			label: "Image · pair",
			run: () => cb.openImageDialog("pair"),
		},
		{
			id: "divider",
			label: "Divider · gurat line",
			run: () => cb.insertHorizontalRule(),
		},
		{
			id: "quote",
			label: "Quote",
			run: () => cb.toggleBlockquote(),
		},
	];
}

export function filterSlashItems(
	items: SlashItem[],
	query: string,
): SlashItem[] {
	return items.filter((item) =>
		item.label.toLowerCase().includes(query.toLowerCase()),
	);
}

export function deleteSlashText(
	editor: Editor | null,
	slashFrom: number,
): void {
	if (!editor) return;
	try {
		const to = editor.state.selection.from;
		if (to <= slashFrom) return;
		const raw = editor.state.doc.textBetween(slashFrom, to, " ");
		if (!raw.startsWith("/")) return;
		editor.chain().focus().deleteRange({ from: slashFrom, to }).run();
	} catch {
		/* selection already moved; insert anyway */
	}
}

export function pickSlashItem(
	editor: Editor | null,
	item: SlashItem,
	slashFrom: number,
	onDone: () => void,
): void {
	deleteSlashText(editor, slashFrom);
	onDone();
	editor?.chain().focus().run();
	item.run();
}

/** Recompute the query from the editor text; returns `"close"` when the
 * menu should dismiss, else the new query string. */
export function slashQueryAfterEdit(
	editor: Editor | null,
	slashFrom: number,
): { close: true } | { close: false; query: string } {
	if (!editor) return { close: true };
	try {
		const to = editor.state.selection.from;
		if (to <= slashFrom) return { close: true };
		const text = editor.state.doc.textBetween(slashFrom + 1, to, " ");
		if (text.includes(" ") || text.includes("\n")) return { close: true };
		return { close: false, query: text };
	} catch {
		return { close: true };
	}
}
