import type { Editor } from "@tiptap/core";
import { tiptapToDoc } from "../editorDoc";

// Save payload builders — pure functions over explicit params. The component
// keeps `$state` (postId, stamps, fetch) and applies the result; `save()`
// itself stays in the component because it mutates six state fields plus
// `window.history`.

export function currentDocJson(
	editor: Editor | null,
	fallback: string,
): string {
	if (!editor) return fallback;
	return JSON.stringify(tiptapToDoc(editor.getJSON()));
}

export interface SaveBase {
	locale: string;
	slug: string;
	title: string;
	excerpt: string;
	seoDescription: string | null;
	coverMediaId: string | null;
	translationGroupId: string | null;
	tagIds: string[];
	contentJson: string;
}

export function buildSaveBody(
	base: SaveBase,
	published: { publishedAt?: number },
	postId: string | null,
	expectedUpdatedAt: number,
	serverUpdatedAt: number,
	overwrite: boolean,
): Record<string, unknown> {
	const body: Record<string, unknown> = { ...base, ...published };
	if (postId !== null) {
		body.expectedUpdatedAt = overwrite ? serverUpdatedAt : expectedUpdatedAt;
	}
	return body;
}

export interface SaveSuccess {
	post: { id: string; updatedAt: number };
}

export function isConflict(res: { status: number }): boolean {
	return res.status === 409;
}
