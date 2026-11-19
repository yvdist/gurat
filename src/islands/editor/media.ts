import type { Editor } from "@tiptap/core";
import { smallestVariantUrl } from "../../lib/content/render";
import type { Media } from "../../server/db/schema";
import type { PreparedImage, UploadedRef } from "../mediaClient";

// Media operations — editor mutations take the `Editor` explicitly; network
// goes through an injected `fetch`-shaped dep so the functions stay pure of
// component state. The component owns library `$state`, preview-URL cache,
// and picker fields.

export interface LibraryItem {
	id: string;
	altDefault: string;
	width: number;
	height: number;
	variantsJson: string;
	useCount: number;
}

export interface MediaDeps {
	fetchMedia: () => Promise<{ media?: (Media & { useCount?: number })[] }>;
	mediaBaseUrl: string;
}

export async function fetchLibrary(deps: MediaDeps): Promise<{
	items: LibraryItem[];
	raw: (Media & { useCount?: number })[];
	previewUrls: Map<string, string>;
}> {
	const data = await deps.fetchMedia();
	const items = (data.media ?? []).map((m) => ({
		id: m.id,
		altDefault: m.altDefault,
		width: m.width,
		height: m.height,
		variantsJson: m.variantsJson,
		useCount: m.useCount ?? 0,
	}));
	const previewUrls = new Map<string, string>();
	for (const m of data.media ?? []) {
		previewUrls.set(m.id, smallestVariantUrl(m, deps.mediaBaseUrl));
	}
	return { items, raw: data.media ?? [], previewUrls };
}

export function insertFigureAt(
	editor: Editor | null,
	mediaId: string,
	alt: string,
	caption: string,
	layout: string,
): void {
	if (!editor) return;
	editor
		.chain()
		.focus()
		.insertContent({
			type: "figure",
			attrs: { mediaId, alt, caption, layout },
		})
		.run();
}

/** Atomic pair insert: two back-to-back inserts leave a NodeSelection on the
 * first figure that the second insert replaces, so insert both at once. */
export function insertFigurePair(
	editor: Editor | null,
	mediaId: string,
	alt: string,
	caption: string,
): void {
	if (!editor) return;
	editor
		.chain()
		.focus()
		.insertContent([
			{
				type: "figure",
				attrs: { mediaId, alt, caption, layout: "pair" },
			},
			{
				type: "figure",
				attrs: { mediaId, alt, caption: "", layout: "pair" },
			},
		])
		.run();
}

export interface UploadDeps extends MediaDeps {
	fileToVariants: (file: File) => Promise<PreparedImage>;
	uploadMedia: (prepared: PreparedImage, alt: string) => Promise<UploadedRef>;
}

/** Upload one file, returning its id + preview URL for the cache. */
export async function uploadOneImage(
	file: File,
	alt: string,
	deps: UploadDeps,
): Promise<{ id: string; previewUrl: string }> {
	const prepared = await deps.fileToVariants(file);
	const { id } = await deps.uploadMedia(prepared, alt);
	const previewUrl = smallestVariantUrl(
		{
			id,
			r2KeyPrefix: `media/${id}/`,
			mime: "image/webp",
			width: prepared.sourceWidth,
			height: prepared.sourceHeight,
			bytes: prepared.sourceBytes,
			altDefault: "",
			dominantColor: prepared.dominant,
			variantsJson: JSON.stringify(
				prepared.variants.map((v) => ({
					w: v.w,
					key: `media/${id}/${v.w}.webp`,
					bytes: v.blob.size,
					mime: "image/webp",
				})),
			),
			createdAt: Date.now(),
		} as Media,
		deps.mediaBaseUrl,
	);
	return { id, previewUrl };
}

/** Pipeline for dropped/pasted files: variants → upload → insert at cursor.
 * Returns inserted ids; throws nothing (per-file failures reported via
 * `onError`). */
export async function filesToFigures(
	editor: Editor | null,
	files: File[],
	deps: UploadDeps & {
		onPreview: (id: string, url: string) => void;
		onError?: () => void;
	},
): Promise<string[]> {
	const images = files.filter((f) => f.type.startsWith("image/"));
	if (images.length === 0 || !editor) return [];
	const inserted: string[] = [];
	for (const file of images) {
		try {
			const { id, previewUrl } = await uploadOneImage(file, "", deps);
			deps.onPreview(id, previewUrl);
			// Dropped/pasted images carry no author alt yet: insert with an
			// empty alt so the save renders the default until edited.
			insertFigureAt(editor, id, "", "", "inline");
			inserted.push(id);
		} catch {
			deps.onError?.();
		}
	}
	return inserted;
}
