<script lang="ts">
import { Editor, Node } from "@tiptap/core";
import LinkExt from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import { onDestroy, onMount } from "svelte";
import "../styles/tokens.css";
import "../styles/article.css";
import "../styles/admin.css";
import { smallestVariantUrl } from "../lib/content/render";
import type { Media } from "../server/db/schema";
import { docToTiptap, tiptapToDoc } from "./editorDoc";
import { fileToVariants, uploadMedia } from "./mediaClient";
import { generateOgImage } from "./ogImage";

// Browser-only editor island (spec 04 §4.3). Mounted `client:only` from
// the post pages; Tiptap core is mounted directly in this component
// (no wrapper dep). Extension list derives from `schema.ts` via
// `editorDoc.ts` — unknown nodes/marks never survive a save.

interface TranslationCandidate {
	id: string;
	locale: "en" | "id";
	title: string;
	slug: string;
	groupId: string | null;
	updatedAt: number;
}

interface Props {
	postId: string | null;
	initialDoc: string;
	initialUpdatedAt: number;
	locale: "en" | "id";
	groupId?: string | null;
	candidates?: TranslationCandidate[];
	/** Public media origin (MEDIA_BASE_URL); empty = same-origin. */
	mediaBaseUrl?: string;
}

const {
	postId: initialPostId,
	initialDoc,
	initialUpdatedAt,
	locale,
	groupId: initialGroupId = null,
	candidates = [],
	mediaBaseUrl = "",
}: Props = $props();

// Custom nodes — names match the schema `type` values 1:1 so stored
// JSON round-trips through Tiptap unchanged.

const Sidenote = Node.create({
	name: "sidenote",
	group: "inline",
	inline: true,
	atom: false,
	content: "inline*",
	addAttributes() {
		return { label: { default: "" } };
	},
	parseHTML() {
		return [{ tag: "span.sidenote[data-label]" }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return [
			"span",
			{
				...HTMLAttributes,
				class: "sidenote",
				"data-label": node.attrs.label ?? "",
			},
			["span", { class: "sidenote-label" }, node.attrs.label ?? ""],
			["span", { class: "sidenote-content" }, 0],
		];
	},
});

const Footnote = Node.create({
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

const Pullquote = Node.create({
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

// mediaId → smallest-variant preview URL (populated from the library before
// the editor mounts; uploads add entries synchronously before insertion).
const previewUrls = new Map<string, string>();

function previewUrl(mediaId: string): string {
	const known = previewUrls.get(mediaId);
	if (known) return known;
	const prefix = mediaBaseUrl.replace(/\/+$/, "");
	return `${prefix}/media/${mediaId}/preview`;
}

const FigureView = Node.create({
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
					src: previewUrl(attrs.mediaId ?? ""),
					alt: attrs.alt ?? "",
				},
			],
			...(attrs.caption ? [["figcaption", {}, attrs.caption] as const] : []),
		];
	},
});

let element: HTMLElement | null = $state(null);
let editor: Editor | null = $state(null);
let saveState: "saved" | "saving" | "offline" | "conflict" = $state("saved");
let dirty = $state(false);
let conflictStamp: number | null = $state(null);
let postId: string | null = $state(initialPostId);
let expectedUpdatedAt = $state(initialUpdatedAt);
let serverUpdatedAt = $state(initialUpdatedAt);
let words = $state(0);
let focusMode = $state(false);
let saveTimer: ReturnType<typeof setTimeout> | null = null;

let linkDialog: HTMLDialogElement | null = $state(null);
let linkHref = $state("");
let linkError = $state("");
let sidenoteDialog: HTMLDialogElement | null = $state(null);
let sidenoteLabel = $state("");
let pullquoteDialog: HTMLDialogElement | null = $state(null);
let showDeleteConfirm = $state(false);
let deleteSlug = $state("");
let groupId: string | null = $state(initialGroupId);
let linkTarget = $state("");
let translationBusy = $state(false);
let translationError: string | null = $state(null);
interface LibraryItem {
	id: string;
	altDefault: string;
	width: number;
	height: number;
	variantsJson: string;
	useCount: number;
}

let imageDialog: HTMLDialogElement | null = $state(null);
let library: LibraryItem[] = $state([]);
let libraryError: string | null = $state(null);
let pickerMediaId = $state("");
let pickerAlt = $state("");
let pickerAltTouched = $state(false);
let pickerDecorative = $state(false);
let pickerCaption = $state("");
let pickerLayout = $state("inline");
let pickerBusy = $state(false);
let pickerError: string | null = $state(null);
// Share image (spec 06 §6.4): client-generated 1200×630 PNG uploaded on
// demand. `ogStamp` records title/cover at the last successful upload; any
// drift shows a regenerate hint (never silent overwrite).
let ogStamp: { title: string; cover: string } | null = $state(null);
let ogStatus: string | null = $state(null);
let ogBusy = $state(false);
let liveTitle = $state("");
let liveCover = $state("");
const ogStale = $derived(
	ogStamp !== null &&
		(ogStamp.title !== liveTitle || ogStamp.cover !== liveCover),
);

function snapshotMeta(): { title: string; cover: string } {
	return { title: fieldValue("meta-title"), cover: fieldValue("meta-cover") };
}

async function generateShareImage(): Promise<void> {
	if (postId === null) {
		ogStatus = "Save the post first, then generate its share image.";
		return;
	}
	ogBusy = true;
	ogStatus = "Generating share image…";
	try {
		const meta = snapshotMeta();
		const blob = await generateOgImage(meta.title || "(untitled)");
		const form = new FormData();
		form.append("image", new File([blob], "og.png", { type: "image/png" }));
		const res = await fetch(`/admin/api/posts/${postId}/og`, {
			method: "PUT",
			body: form,
		});
		if (!res.ok) {
			ogStatus = `Share image upload failed (${res.status}).`;
			return;
		}
		ogStamp = meta;
		liveTitle = meta.title;
		liveCover = meta.cover;
		ogStatus = "Share image updated.";
	} catch {
		ogStatus = "Share image generation failed.";
	} finally {
		ogBusy = false;
	}
}

function fieldValue(id: string): string {
	const el = document.getElementById(id) as HTMLInputElement | null;
	return el?.value ?? "";
}

function fieldMultiValues(id: string): string[] {
	const el = document.getElementById(id) as HTMLSelectElement | null;
	if (!el) return [];
	return [...el.selectedOptions].map((o) => o.value);
}

function syncGroupInput(): void {
	const el = document.getElementById("meta-group") as HTMLInputElement | null;
	if (el) el.value = groupId ?? "";
}

function wordCount(text: string): number {
	const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
	let count = 0;
	for (const seg of segmenter.segment(text)) {
		if (seg.isWordLike === true) count++;
	}
	return count;
}

function refreshStats() {
	if (!editor) return;
	words = wordCount(editor.getText());
}

// Same formula as `renderDoc`: words / 200, min 1.
const readingMinutes = $derived(Math.max(1, Math.round(words / 200)));

function markDirty() {
	dirty = true;
	if (saveState !== "conflict") saveState = "saving";
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => void save(false), 2000);
}

function currentDocJson(): string {
	if (!editor) return initialDoc;
	const doc = tiptapToDoc(editor.getJSON());
	return JSON.stringify(doc);
}

async function save(overwrite: boolean): Promise<boolean> {
	if (!editor) return false;
	if (saveTimer) {
		clearTimeout(saveTimer);
		saveTimer = null;
	}
	if (!navigator.onLine) {
		saveState = "offline";
		return false;
	}
	saveState = "saving";
	// Cover selector lives in the page metadata panel (`#meta-cover`); the
	// dead `#meta-published` display input is intentionally not sent (its
	// scheduling behavior is out of scope for the media phase).
	const coverValue = fieldValue("meta-cover");
	const body = {
		locale: fieldValue("meta-locale") || locale,
		slug: fieldValue("meta-slug"),
		title: fieldValue("meta-title"),
		excerpt: fieldValue("meta-excerpt"),
		seoDescription: fieldValue("meta-seo") || null,
		coverMediaId: coverValue === "" ? null : coverValue,
		translationGroupId: groupId,
		tagIds: fieldMultiValues("meta-tags"),
		contentJson: currentDocJson(),
		expectedUpdatedAt: overwrite ? serverUpdatedAt : expectedUpdatedAt,
	};
	try {
		let res: Response;
		if (postId === null) {
			res = await fetch("/admin/api/posts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					locale: fieldValue("meta-locale") || locale,
					slug: body.slug,
					title: body.title,
					excerpt: body.excerpt,
					contentJson: body.contentJson,
					seoDescription: body.seoDescription,
					coverMediaId: body.coverMediaId,
					translationGroupId: body.translationGroupId,
					tagIds: body.tagIds,
				}),
			});
		} else {
			res = await fetch(`/admin/api/posts/${postId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
		}
		if (res.status === 409) {
			const data = (await res.json()) as { currentUpdatedAt?: number };
			conflictStamp = data.currentUpdatedAt ?? null;
			serverUpdatedAt = data.currentUpdatedAt ?? serverUpdatedAt;
			saveState = "conflict";
			return false;
		}
		if (!res.ok) {
			saveState = "saved";
			return false;
		}
		const data = (await res.json()) as {
			post: { id: string; updatedAt: number };
		};
		const wasNew = postId === null;
		postId = data.post.id;
		expectedUpdatedAt = data.post.updatedAt;
		serverUpdatedAt = data.post.updatedAt;
		dirty = false;
		saveState = "saved";
		if (wasNew) {
			// First save created the row: reflect the canonical URL without
			// reloading (refresh-safe, keeps editor state).
			window.history.replaceState(null, "", `/admin/posts/${data.post.id}`);
		}
	} catch {
		saveState = navigator.onLine ? "saved" : "offline";
		return false;
	}
}

const otherLocale = locale === "en" ? "id" : "en";

/** "Create translation": duplicate this document as a new draft in the
 * other locale, sharing a translation group. Generates the group when
 * this post has none (saving it here first). */
async function createTranslation(): Promise<void> {
	if (translationBusy) return;
	translationBusy = true;
	translationError = null;
	try {
		const gid = groupId ?? crypto.randomUUID();
		if (groupId === null) {
			groupId = gid;
			syncGroupInput();
			const ok = await save(false);
			if (!ok) throw new Error("save failed");
		}
		const res = await fetch("/admin/api/posts", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				locale: otherLocale,
				slug: fieldValue("meta-slug"),
				title: fieldValue("meta-title"),
				excerpt: fieldValue("meta-excerpt"),
				contentJson: currentDocJson(),
				translationGroupId: gid,
				tagIds: fieldMultiValues("meta-tags"),
			}),
		});
		if (!res.ok) throw new Error(`create failed (${res.status})`);
		const data = (await res.json()) as { post: { id: string } };
		window.location.href = `/admin/posts/${data.post.id}`;
	} catch (err) {
		translationError =
			err instanceof Error ? err.message : "translation failed";
		translationBusy = false;
	}
}

/** "Link existing": pair with an ungrouped other-locale post by writing
 * the group id to both rows. */
async function linkExisting(): Promise<void> {
	if (translationBusy || linkTarget === "") return;
	translationBusy = true;
	translationError = null;
	try {
		const target = candidates.find((c) => c.id === linkTarget);
		if (!target) throw new Error("post not found");
		const gid = groupId ?? target.groupId ?? crypto.randomUUID();
		const raw = await fetch(`/admin/api/posts/${target.id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				translationGroupId: gid,
				expectedUpdatedAt: target.updatedAt,
			}),
		});
		// Target stamp is unknown; refetch it from the post list on 409.
		if (raw.status === 409)
			throw new Error("target changed — reload and retry");
		if (!raw.ok) throw new Error(`link failed (${raw.status})`);
		groupId = gid;
		syncGroupInput();
		const ok = await save(false);
		if (!ok) throw new Error("save failed");
		window.location.reload();
	} catch (err) {
		translationError = err instanceof Error ? err.message : "link failed";
		translationBusy = false;
	}
}
async function reloadServer() {
	window.location.reload();
}

async function overwriteMine() {
	await save(true);
}

async function publish() {
	const dirtyJson = dirty ? currentDocJson() : undefined;
	if (dirty) {
		const ok = await save(false);
		if (!ok) return;
	}
	if (!postId) return;
	const res = await fetch(`/admin/api/posts/${postId}/publish`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(
			dirtyJson ? { contentJson: dirtyJson, expectedUpdatedAt } : {},
		),
	});
	if (res.ok) window.location.href = "/admin";
}

async function unpublish() {
	if (!postId) return;
	const res = await fetch(`/admin/api/posts/${postId}/unpublish`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: "{}",
	});
	if (res.ok) window.location.href = "/admin";
}

async function remove() {
	if (!postId) return;
	const res = await fetch(`/admin/api/posts/${postId}`, {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: "{}",
	});
	if (res.ok) window.location.href = "/admin";
}

function stripLinkAttrs(html: string): string {
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

function openLinkDialog() {
	linkHref = (editor?.getAttributes("link").href as string) ?? "";
	linkError = "";
	linkDialog?.showModal();
}

function applyLink() {
	if (!editor) return;
	const href = linkHref.trim();
	if (href !== "") {
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
				linkError =
					"Only http(s), mailto, and site-relative links are allowed.";
				return;
			}
		} catch {
			linkError = "Only http(s), mailto, and site-relative links are allowed.";
			return;
		}
		editor.chain().focus().setLink({ href }).run();
	} else {
		editor.chain().focus().unsetLink().run();
	}
	linkDialog?.close();
	markDirty();
}

function insertSidenote() {
	if (!editor || sidenoteLabel.trim() === "") return;
	editor
		.chain()
		.focus()
		.insertContent({
			type: "sidenote",
			attrs: { label: sidenoteLabel.trim() },
			content: [{ type: "text", text: "note" }],
		})
		.run();
	sidenoteDialog?.close();
	sidenoteLabel = "";
	markDirty();
}

function insertPullquote() {
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
	pullquoteDialog?.close();
	markDirty();
}

function insertFootnote() {
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
	markDirty();
}

function beforeUnload(e: BeforeUnloadEvent) {
	if (dirty) e.preventDefault();
}
interface MediaListResponse {
	media?: (Media & { useCount?: number })[];
}

/** Fetch the library; populate preview URLs + picker list. */
async function refreshLibrary(): Promise<void> {
	libraryError = null;
	try {
		const res = await fetch("/admin/api/media");
		if (!res.ok) throw new Error(`library failed (${res.status})`);
		const data = (await res.json()) as MediaListResponse;
		const items = (data.media ?? []).map((m) => ({
			id: m.id,
			altDefault: m.altDefault,
			width: m.width,
			height: m.height,
			variantsJson: m.variantsJson,
			useCount: m.useCount ?? 0,
		}));
		library = items;
		for (const m of data.media ?? []) {
			previewUrls.set(m.id, smallestVariantUrl(m, mediaBaseUrl));
		}
	} catch (err) {
		libraryError = err instanceof Error ? err.message : "library failed";
	}
}

function openImageDialog(): void {
	pickerMediaId = "";
	pickerAlt = "";
	pickerAltTouched = false;
	pickerDecorative = false;
	pickerCaption = "";
	pickerLayout = "inline";
	pickerError = null;
	imageDialog?.showModal();
	void refreshLibrary();
}

function insertFigureAt(
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
	markDirty();
}

function insertFromPicker(): void {
	// Alt is required: free text (touched) or explicit decorative (`alt=""`).
	if (pickerMediaId === "") {
		pickerError = "Choose an image first.";
		return;
	}
	if (!pickerAltTouched && !pickerDecorative) {
		pickerError = "Alt text is required (or tick decorative).";
		return;
	}
	const alt = pickerDecorative ? "" : pickerAlt.trim();
	insertFigureAt(pickerMediaId, alt, pickerCaption.trim(), pickerLayout);
	imageDialog?.close();
}

async function pickerUpload(file: File): Promise<void> {
	pickerBusy = true;
	pickerError = null;
	try {
		const prepared = await fileToVariants(file);
		const { id } = await uploadMedia(prepared, pickerAlt.trim());
		await refreshLibrary();
		pickerMediaId = id;
		markDirty();
	} catch (err) {
		pickerError = err instanceof Error ? err.message : "upload failed";
	} finally {
		pickerBusy = false;
	}
}

/** Pipeline for dropped/pasted files: variants → upload → insert at cursor. */
async function filesToFigures(files: File[]): Promise<void> {
	const images = files.filter((f) => f.type.startsWith("image/"));
	if (images.length === 0 || !editor) return;
	for (const file of images) {
		try {
			const prepared = await fileToVariants(file);
			const { id } = await uploadMedia(prepared, "");
			previewUrls.set(
				id,
				smallestVariantUrl(
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
					mediaBaseUrl,
				),
			);
			// Dropped/pasted images carry no author alt yet: insert with an
			// empty alt so the save renders the default until edited.
			insertFigureAt(id, "", "", "inline");
		} catch {
			saveState = "saved";
		}
	}
}

onMount(() => {
	// Library first so figure previews resolve to real variant URLs on the
	// initial render (same prefix rule as the server renderer).
	void (async () => {
		await refreshLibrary();
		let parsed: unknown;
		try {
			parsed = JSON.parse(initialDoc);
		} catch {
			parsed = { type: "doc", content: [] };
		}
		editor = new Editor({
			element: element as HTMLElement,
			extensions: [
				StarterKit.configure({
					heading: { levels: [2, 3, 4] },
					link: false,
				}),
				LinkExt.configure({
					openOnClick: false,
					HTMLAttributes: { rel: "noopener noreferrer" },
				}),
				Sidenote,
				Footnote,
				Pullquote,
				FigureView,
			],
			content: docToTiptap(tiptapToDoc(parsed)),
			editorProps: {
				transformPastedHTML: (html) => stripLinkAttrs(html),
				handleDrop: (_view, event) => {
					const files = event.dataTransfer?.files;
					if (!files || files.length === 0) return false;
					const images = [...files].filter((f) => f.type.startsWith("image/"));
					if (images.length === 0) return false;
					event.preventDefault();
					void filesToFigures(images);
					return true;
				},
				handlePaste: (_view, event) => {
					const files = event.clipboardData?.files;
					if (!files || files.length === 0) return false;
					const images = [...files].filter((f) => f.type.startsWith("image/"));
					if (images.length === 0) return false;
					event.preventDefault();
					void filesToFigures(images);
					return true;
				},
			},
			onUpdate: () => {
				refreshStats();
				markDirty();
			},
			onCreate: ({ editor: e }) => {
				words = wordCount(e.getText());
			},
		});
		window.addEventListener("beforeunload", beforeUnload);
		syncGroupInput();
		// Slug auto-fills from the title until the author edits it by hand.
		const slugEl = document.getElementById(
			"meta-slug",
		) as HTMLInputElement | null;
		const titleEl = document.getElementById(
			"meta-title",
		) as HTMLInputElement | null;
		if (slugEl && titleEl && slugEl.value === "") {
			const fill = () => {
				if (slugEl.dataset.touched === "1") return;
				slugEl.value = titleEl.value
					.toLowerCase()
					.normalize("NFKD")
					.replaceAll(/[\u0300-\u036f]/g, "")
					.replaceAll(/[^a-z0-9]+/g, "-")
					.replaceAll(/^-+|-+$/g, "")
					.slice(0, 150);
			};
			titleEl.addEventListener("input", fill);
			slugEl.addEventListener("input", () => {
				slugEl.dataset.touched = "1";
			});
		}
		// Share-image staleness: track title/cover edits against the last
		// upload stamp (cover is a select → change; title is text → input).
		const snap = () => {
			const meta = snapshotMeta();
			liveTitle = meta.title;
			liveCover = meta.cover;
		};
		snap();
		for (const id of ["meta-title", "meta-cover"]) {
			const el = document.getElementById(id);
			el?.addEventListener("input", snap);
			el?.addEventListener("change", snap);
		}
	})();
});

onDestroy(() => {
	if (saveTimer) clearTimeout(saveTimer);
	window.removeEventListener("beforeunload", beforeUnload);
	editor?.destroy();
	editor = null;
});
</script>

<div class:focus-mode={focusMode}>
	<div role="toolbar" aria-label="Editor">
		<button type="button" onclick={() => editor?.chain().focus().toggleBold().run()} aria-pressed={editor?.isActive("bold") ?? false} aria-label="Bold"><strong>B</strong></button>
		<button type="button" onclick={() => editor?.chain().focus().toggleItalic().run()} aria-pressed={editor?.isActive("italic") ?? false} aria-label="Italic"><em>I</em></button>
		<button type="button" onclick={() => editor?.chain().focus().toggleCode().run()} aria-pressed={editor?.isActive("code") ?? false} aria-label="Code">{"</>"}</button>
		<button type="button" onclick={openLinkDialog} aria-label="Link">link</button>
		<button type="button" onclick={() => { editor?.chain().focus().unsetLink().run(); markDirty(); }} aria-label="Unlink">unlink</button>
		<button type="button" onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} aria-pressed={editor?.isActive("heading", { level: 2 }) ?? false} aria-label="Heading 2">H2</button>
		<button type="button" onclick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} aria-pressed={editor?.isActive("heading", { level: 3 }) ?? false} aria-label="Heading 3">H3</button>
		<button type="button" onclick={() => editor?.chain().focus().toggleHeading({ level: 4 }).run()} aria-pressed={editor?.isActive("heading", { level: 4 }) ?? false} aria-label="Heading 4">H4</button>
		<button type="button" onclick={() => editor?.chain().focus().toggleBlockquote().run()} aria-pressed={editor?.isActive("blockquote") ?? false} aria-label="Quote">quote</button>
		<button type="button" onclick={() => editor?.chain().focus().toggleBulletList().run()} aria-pressed={editor?.isActive("bulletList") ?? false} aria-label="Bulleted list">bullets</button>
		<button type="button" onclick={() => editor?.chain().focus().toggleOrderedList().run()} aria-pressed={editor?.isActive("orderedList") ?? false} aria-label="Numbered list">ordered</button>
		<button type="button" onclick={() => editor?.chain().focus().toggleCodeBlock().run()} aria-pressed={editor?.isActive("codeBlock") ?? false} aria-label="Code block">code block</button>
		<label>language
			<select
				aria-label="Code block language"
				onchange={(e) => editor?.chain().focus().updateAttributes("codeBlock", { language: (e.target as HTMLSelectElement).value }).run()}
			>
				<option value="">none</option>
				<option value="ts">ts</option>
				<option value="js">js</option>
				<option value="python">python</option>
				<option value="rust">rust</option>
				<option value="sh">sh</option>
			</select>
		</label>
		<button type="button" onclick={() => editor?.chain().focus().setHorizontalRule().run()} aria-label="Horizontal rule">rule</button>
		<button type="button" onclick={() => pullquoteDialog?.showModal()} aria-label="Insert pullquote">pullquote</button>
		<button type="button" onclick={() => sidenoteDialog?.showModal()} aria-label="Insert sidenote">sidenote</button>
		<button type="button" onclick={insertFootnote} aria-label="Insert footnote">footnote</button>
		<button type="button" onclick={openImageDialog} aria-label="Insert image">image</button>
		<button type="button" onclick={() => editor?.chain().focus().undo().run()} aria-label="Undo">undo</button>
		<button type="button" onclick={() => editor?.chain().focus().redo().run()} aria-label="Redo">redo</button>
		<button type="button" onclick={() => { focusMode = !focusMode; }} aria-pressed={focusMode} aria-label="Focus mode">focus</button>
	</div>

	<div class="article-body" bind:this={element}></div>

	<p class="admin-status" role="status">
		{#if saveState === "saving"}saving…
		{:else if saveState === "offline"}offline — will retry
		{:else if saveState === "conflict"}conflict — server has a newer version
		{:else}saved{/if}
		· {words} words · {readingMinutes} min
	</p>

	{#if saveState === "conflict"}
		<div class="admin-banner" role="alert">
			<p>Someone else saved this post (server stamp {conflictStamp}). Your version is intact.</p>
			<button type="button" onclick={reloadServer}>Reload server version</button>
			<button type="button" onclick={overwriteMine}>Overwrite with mine</button>
		</div>
	{/if}

	<div>
		<button type="button" onclick={() => void save(false)}>Save</button>
		<button type="button" onclick={() => void publish()}>Publish</button>
		<button type="button" onclick={() => void unpublish()}>Unpublish</button>
		<button type="button" onclick={() => { showDeleteConfirm = true; }}>Delete</button>
		{#if showDeleteConfirm}
			<label>Type the slug to confirm delete
				<input bind:value={deleteSlug} aria-label="Type the slug to confirm delete" />
			</label>
			<button type="button" disabled={deleteSlug !== fieldValue("meta-slug")} onclick={() => void remove()}>Confirm delete</button>
		{/if}
	</div>

	<section aria-label="Share image">
		<h2>Share image</h2>
		{#if postId === null}
			<p>Save the post first, then generate its share image.</p>
		{:else}
			<button type="button" onclick={() => void generateShareImage()} disabled={ogBusy}>
				{ogBusy ? "Generating…" : "Generate share image"}
			</button>
			{#if ogStale}
				<p class="admin-status" role="status">Title or cover changed since the last share image — regenerate to refresh link previews.</p>
			{/if}
			{#if ogStatus !== null}
				<p class="admin-status" role="status">{ogStatus}</p>
			{/if}
		{/if}
	</section>

	<section aria-label="Translation">
		<h2>Translation</h2>
		{#if groupId === null}
			<p>No linked translation.</p>
			{#if postId !== null}
				<button type="button" onclick={() => void createTranslation()} disabled={translationBusy}>
					Create {otherLocale} translation
				</button>
			{:else}
				<p>Save this post first, then create its translation.</p>
			{/if}
		{:else}
			<p>Linked group: <span class="admin-status">{groupId}</span></p>
		{/if}
		<label>Link existing {otherLocale} post
			<select bind:value={linkTarget} aria-label="Link existing post">
				<option value="">—</option>
				{#each candidates.filter((c) => c.groupId === null) as c (c.id)}
					<option value={c.id}>{c.slug} — {c.title || "(untitled)"}</option>
				{/each}
			</select>
		</label>
		<button type="button" onclick={() => void linkExisting()} disabled={translationBusy || linkTarget === "" || postId === null}>
			Link
		</button>
		{#if translationError}<p class="admin-error">{translationError}</p>{/if}
	</section>

	<dialog bind:this={linkDialog} aria-label="Edit link">
		<form method="dialog">
			<label>URL (http(s), mailto, or site-relative)
				<input bind:value={linkHref} aria-label="Link URL" inputmode="url" />
			</label>
			{#if linkError}<p class="admin-error">{linkError}</p>{/if}
			<button type="button" onclick={applyLink}>Apply</button>
			<button type="submit">Cancel</button>
		</form>
	</dialog>

	<dialog bind:this={sidenoteDialog} aria-label="Insert sidenote">
		<form method="dialog">
			<label>Label
				<input bind:value={sidenoteLabel} aria-label="Sidenote label" />
			</label>
			<button type="button" onclick={insertSidenote}>Insert</button>
			<button type="submit">Cancel</button>
		</form>
	</dialog>

	<dialog bind:this={pullquoteDialog} aria-label="Insert pullquote">
		<form method="dialog">
			<p>Inserts a pullquote block at the cursor.</p>
			<button type="button" onclick={insertPullquote}>Insert</button>
			<button type="submit">Cancel</button>
		</form>
	</dialog>
	<dialog bind:this={imageDialog} aria-label="Insert image">
		<form method="dialog">
			<h2>Insert image</h2>
			{#if libraryError}<p class="admin-error">{libraryError}</p>{/if}
			<label>Choose from library
				<select bind:value={pickerMediaId} aria-label="Choose image from library">
					<option value="">—</option>
					{#each library as item (item.id)}
						<option value={item.id}>{item.id} ({item.width}×{item.height})</option>
					{/each}
				</select>
			</label>
			<label>Upload new
				<input
					type="file"
					accept="image/jpeg,image/png,image/webp"
					aria-label="Upload new image"
					onchange={(e) => {
						const f = (e.target as HTMLInputElement).files?.[0];
						if (f) void pickerUpload(f);
					}}
				/>
			</label>
			{#if pickerBusy}<p class="admin-status">Uploading…</p>{/if}
			<label>Alt text (required)
				<input
					bind:value={pickerAlt}
					aria-label="Image alt text"
					oninput={() => { pickerAltTouched = true; }}
				/>
			</label>
			<label>
				<input type="checkbox" bind:checked={pickerDecorative} aria-label="Decorative image" />
				Decorative (empty alt)
			</label>
			<label>Caption (optional)
				<input bind:value={pickerCaption} aria-label="Image caption" />
			</label>
			<label>Layout
				<select bind:value={pickerLayout} aria-label="Image layout">
					<option value="inline">inline</option>
					<option value="offset">offset</option>
					<option value="wide">wide</option>
					<option value="full">full</option>
					<option value="pair">pair</option>
					<option value="triptych">triptych</option>
				</select>
			</label>
			{#if pickerError}<p class="admin-error">{pickerError}</p>{/if}
			<button
				type="button"
				onclick={insertFromPicker}
				disabled={pickerMediaId === "" || (!pickerAltTouched && !pickerDecorative)}
			>Insert</button>
			<button type="submit">Cancel</button>
		</form>
	</dialog>
</div>

<style>
	.focus-mode :global(.admin-side) {
		display: none;
	}
</style>
