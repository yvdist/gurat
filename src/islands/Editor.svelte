<script lang="ts">
import { Editor, Node } from "@tiptap/core";
import LinkExt from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import { onDestroy, onMount } from "svelte";
import "../styles/tokens.css";
import "../styles/article.css";
import "../styles/admin.css";
import {
	renderDoc,
	smallestVariantUrl,
	type TocEntry,
} from "../lib/content/render";
import type { Media } from "../server/db/schema";
import { docToTiptap, tiptapToDoc } from "./editorDoc";
import { fileToVariants, uploadMedia } from "./mediaClient";
import { generateOgImage } from "./ogImage";

// Writing-first editor island (plan Step 4). Mounted `client:only` from the
// post pages. All metadata state lives here (`$state`); the Astro wrappers
// pass initial values as props. Save/publish/translation/OG protocols are
// byte-identical to the previous island — only the chrome changed.
// Extension list is unchanged so `editorDoc.ts` round-trips still hold.

interface TranslationCandidate {
	id: string;
	locale: "en" | "id";
	title: string;
	slug: string;
	groupId: string | null;
	updatedAt: number;
}

interface TagOption {
	id: string;
	slug: string;
}

interface MediaOption {
	id: string;
	altDefault: string;
	width: number;
	height: number;
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
	initialTitle?: string;
	initialSlug?: string;
	initialExcerpt?: string;
	initialSeo?: string | null;
	initialCoverId?: string | null;
	initialTagIds?: string[];
	/** Epoch ms, or null when unscheduled. */
	initialPublishedAt?: number | null;
	initialStatus?: "draft" | "published";
	allTags?: TagOption[];
	allMedia?: MediaOption[];
}

const {
	postId: initialPostId,
	initialDoc,
	initialUpdatedAt,
	locale,
	groupId: initialGroupId = null,
	candidates = [],
	mediaBaseUrl = "",
	initialTitle = "",
	initialSlug = "",
	initialExcerpt = "",
	initialSeo = null,
	initialCoverId = null,
	initialTagIds = [],
	initialPublishedAt = null,
	initialStatus = "draft",
	allTags = [],
	allMedia = [],
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
let nowTick = $state(Date.now());
let tickTimer: ReturnType<typeof setInterval> | null = null;

// Island-owned metadata (ids preserved so e2e fill/selectOption keep working).
let metaTitle = $state(initialTitle);
let metaSlug = $state(initialSlug);
let slugTouched = $state(initialSlug !== "");
let metaExcerpt = $state(initialExcerpt);
let metaSeo = $state(initialSeo ?? "");
let seoOverride = $state(initialSeo !== null && initialSeo !== "");
let metaLocale = $state<"en" | "id">(locale);
let metaCover = $state(initialCoverId ?? "");
let metaTags: string[] = $state([...initialTagIds]);
let metaGroup: string | null = $state(initialGroupId);
let status = $state<"draft" | "published">(initialStatus);
let publishedAt = $state<number | null>(initialPublishedAt);
let publishedDirty = $state(false);
// datetime-local display value (local time); kept in sync from publishedAt
// until the author edits it.
let publishedInput = $state(
	initialPublishedAt !== null && initialPublishedAt !== undefined
		? new Date(initialPublishedAt).toISOString().slice(0, 16)
		: "",
);

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
let libraryFull: Media[] = $state([]);
let libraryError: string | null = $state(null);
let pickerMediaId = $state("");
let pickerAlt = $state("");
let pickerAltTouched = $state(false);
let pickerDecorative = $state(false);
let pickerCaption = $state("");
let pickerLayout = $state("inline");
let pickerBusy = $state(false);
let pickerError: string | null = $state(null);
/** insert = figure at cursor; cover = set post cover; pair = two figures. */
let pickerMode: "insert" | "cover" | "pair" = $state("insert");
// Share image (spec 06 §6.4): client-generated 1200×630 PNG uploaded on
// demand. `ogStamp` records title/cover at the last successful upload; any
// drift shows a regenerate hint (never silent overwrite).
let ogStamp: { title: string; cover: string } | null = $state(null);
let ogStatus: string | null = $state(null);
let ogBusy = $state(false);
const ogStale = $derived(
	ogStamp !== null &&
		(ogStamp.title !== metaTitle || ogStamp.cover !== metaCover),
);

async function generateShareImage(): Promise<void> {
	if (postId === null) {
		ogStatus = "Save the post first, then generate its share image.";
		return;
	}
	ogBusy = true;
	ogStatus = "Generating share image…";
	try {
		const meta = { title: metaTitle, cover: metaCover };
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
		ogStatus = "Share image updated.";
	} catch {
		ogStatus = "Share image generation failed.";
	} finally {
		ogBusy = false;
	}
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.normalize("NFKD")
		.replaceAll(/[\u0300-\u036f]/g, "")
		.replaceAll(/[^a-z0-9]+/g, "-")
		.replaceAll(/^-+|-+$/g, "")
		.slice(0, 150);
}

function onTitleInput(value: string): void {
	metaTitle = value;
	if (!slugTouched) metaSlug = slugify(value);
	markDirty();
}

function wordCount(text: string): number {
	const segmenter = new Intl.Segmenter(metaLocale, { granularity: "word" });
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

function relTime(stamp: number, now: number): string {
	const mins = Math.max(0, Math.round((now - stamp) / 60000));
	if (mins < 1) return "JUST NOW";
	if (mins < 60) return `${mins} MIN AGO`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours} HR AGO`;
	return `${Math.round(hours / 24)} DAY${Math.round(hours / 24) === 1 ? "" : "S"} AGO`;
}

const scheduledView = $derived(
	status === "published" && publishedAt !== null && publishedAt > Date.now(),
);
const statusGlyph = $derived(
	status === "published"
		? scheduledView
			? "◐ SCHEDULED"
			: "● PUBLISHED"
		: "○ DRAFT",
);
const statusText = $derived(
	saveState === "saving"
		? "SAVING…"
		: saveState === "offline"
			? "OFFLINE"
			: saveState === "conflict"
				? "CONFLICT"
				: `${statusGlyph} · SAVED ${relTime(serverUpdatedAt, nowTick)}`,
);

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
	const coverValue = metaCover;
	const base = {
		locale: metaLocale,
		slug: metaSlug,
		title: metaTitle,
		excerpt: metaExcerpt,
		seoDescription: seoOverride ? metaSeo || null : null,
		coverMediaId: coverValue === "" ? null : coverValue,
		translationGroupId: groupId,
		tagIds: [...metaTags],
		contentJson: currentDocJson(),
	};
	// `publishedAt` travels ONLY when the DETAILS schedule pill changed it;
	// omitting the key preserves prior behavior (zod optional).
	const scheduled = publishedDirty ? { publishedAt } : {};
	try {
		let res: Response;
		if (postId === null) {
			res = await fetch("/admin/api/posts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...base, ...scheduled }),
			});
		} else {
			res = await fetch(`/admin/api/posts/${postId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					...base,
					...scheduled,
					expectedUpdatedAt: overwrite ? serverUpdatedAt : expectedUpdatedAt,
				}),
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
		publishedDirty = false;
		saveState = "saved";
		if (wasNew) {
			// First save created the row: reflect the canonical URL without
			// reloading (refresh-safe, keeps editor state).
			window.history.replaceState(null, "", `/admin/posts/${data.post.id}`);
		}
		return true;
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
			metaGroup = gid;
			const ok = await save(false);
			if (!ok) throw new Error("save failed");
		}
		const res = await fetch("/admin/api/posts", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				locale: otherLocale,
				slug: metaSlug,
				title: metaTitle,
				excerpt: metaExcerpt,
				contentJson: currentDocJson(),
				translationGroupId: gid,
				tagIds: [...metaTags],
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
		metaGroup = gid;
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

// Pre-publish checklist modal.
let publishDialog: HTMLDialogElement | null = $state(null);
let publishBusy = $state(false);
let publishError: string | null = $state(null);
const checklistTitle = $derived(metaTitle.trim() !== "");
const checklistSlug = $derived(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metaSlug));
const checklistBody = $derived(words > 0);
const checklistCover = $derived(metaCover !== "");
const checklistTranslation = $derived(groupId !== null);
const checklistReady = $derived(
	checklistTitle && checklistSlug && checklistBody,
);

function openPublishDialog(): void {
	publishError = null;
	publishDialog?.showModal();
}

async function confirmPublish(): Promise<void> {
	if (publishBusy || !checklistReady) return;
	publishBusy = true;
	publishError = null;
	try {
		const dirtyJson = dirty ? currentDocJson() : undefined;
		if (dirty) {
			const ok = await save(false);
			if (!ok) throw new Error("save failed — resolve the conflict first");
		}
		if (!postId) throw new Error("save the post first");
		const res = await fetch(`/admin/api/posts/${postId}/publish`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(
				dirtyJson ? { contentJson: dirtyJson, expectedUpdatedAt } : {},
			),
		});
		if (!res.ok) throw new Error(`publish failed (${res.status})`);
		const data = (await res.json()) as {
			post: { id: string; updatedAt: number; publishedAt?: number | null };
		};
		expectedUpdatedAt = data.post.updatedAt;
		serverUpdatedAt = data.post.updatedAt;
		if (data.post.publishedAt !== undefined)
			publishedAt = data.post.publishedAt;
		dirty = false;
		status = "published";
		publishDialog?.close();
	} catch (err) {
		publishError = err instanceof Error ? err.message : "publish failed";
	} finally {
		publishBusy = false;
	}
}

async function unpublish() {
	if (!postId) return;
	const res = await fetch(`/admin/api/posts/${postId}/unpublish`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: "{}",
	});
	if (!res.ok) return;
	const data = (await res.json()) as { post: { updatedAt: number } };
	expectedUpdatedAt = data.post.updatedAt;
	serverUpdatedAt = data.post.updatedAt;
	dirty = false;
	status = "draft";
}

async function remove() {
	if (!postId) return;
	const res = await fetch(`/admin/api/posts/${postId}`, {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: "{}",
	});
	if (res.ok) window.location.href = "/admin/posts";
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

function bubbleLinkOpen(): void {
	linkHref = (editor?.getAttributes("link").href as string) ?? "";
	linkError = "";
	showLinkPopover = true;
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
	showLinkPopover = false;
	refreshSelection();
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

function togglePullquote(): void {
	if (!editor) return;
	if (editor.isActive("pullquote")) {
		editor.chain().focus().lift("pullquote").run();
	} else {
		// Wrap the current block in a pullquote.
		editor.chain().focus().wrapIn("pullquote").run();
	}
	refreshSelection();
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
		libraryFull = data.media ?? [];
		for (const m of data.media ?? []) {
			previewUrls.set(m.id, smallestVariantUrl(m, mediaBaseUrl));
		}
	} catch (err) {
		libraryError = err instanceof Error ? err.message : "library failed";
	}
}

function openImageDialog(mode: "insert" | "cover" | "pair" = "insert"): void {
	pickerMode = mode;
	pickerMediaId = "";
	pickerAlt = "";
	pickerAltTouched = false;
	pickerDecorative = false;
	pickerCaption = "";
	pickerLayout = mode === "pair" ? "pair" : "inline";
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
	if (pickerMediaId === "") {
		pickerError = "Choose an image first.";
		return;
	}
	if (pickerMode === "cover") {
		metaCover = pickerMediaId;
		imageDialog?.close();
		markDirty();
		return;
	}
	if (!pickerAltTouched && !pickerDecorative) {
		pickerError = "Alt text is required (or tick decorative).";
		return;
	}
	const alt = pickerDecorative ? "" : pickerAlt.trim();
	if (pickerMode === "pair") {
		// Two consecutive pair-layout figures so `groupFigures` renders the
		// pair treatment.
		insertFigureAt(pickerMediaId, alt, pickerCaption.trim(), "pair");
		insertFigureAt(pickerMediaId, alt, "", "pair");
	} else {
		insertFigureAt(pickerMediaId, alt, pickerCaption.trim(), pickerLayout);
	}
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

// Selection-driven floating UI (custom Svelte over coordsAtPos, no new deps).
let selTick = $state(0);
let bubblePos: { x: number; y: number } | null = $state(null);
let bubbleForFigure = $state(false);
let showLinkPopover = $state(false);
let selectedFig: {
	mediaId: string;
	alt: string;
	caption: string;
	layout: string;
} | null = $state(null);

function refreshSelection(): void {
	selTick++;
	if (!editor) {
		bubblePos = null;
		selectedFig = null;
		return;
	}
	try {
		const sel = editor.state.selection as unknown as {
			empty: boolean;
			from: number;
			node?: { type: { name: string }; attrs: Record<string, string> };
		};
		if (!sel.empty && !showLinkPopover) {
			const coords = editor.view.coordsAtPos(sel.from);
			bubblePos = { x: (coords.left + coords.right) / 2, y: coords.top };
			bubbleForFigure = false;
		} else {
			bubblePos = null;
			bubbleForFigure = false;
		}
		const node = sel.node;
		if (node && node.type.name === "figure") {
			const coords = editor.view.coordsAtPos(sel.from);
			bubblePos = { x: (coords.left + coords.right) / 2, y: coords.top };
			bubbleForFigure = true;
			selectedFig = {
				mediaId: node.attrs.mediaId ?? "",
				alt: node.attrs.alt ?? "",
				caption: node.attrs.caption ?? "",
				layout: node.attrs.layout ?? "inline",
			};
		} else {
			selectedFig = null;
		}
	} catch {
		bubblePos = null;
		selectedFig = null;
	}
}

function setFigureLayout(layout: string): void {
	editor?.chain().focus().updateAttributes("figure", { layout }).run();
	if (selectedFig) selectedFig = { ...selectedFig, layout };
	markDirty();
}

function setFigureCaption(caption: string): void {
	editor?.chain().focus().updateAttributes("figure", { caption }).run();
	if (selectedFig) selectedFig = { ...selectedFig, caption };
	markDirty();
}

// Slash menu: custom keydown `/` combobox issuing the same insert commands.
interface SlashItem {
	id: string;
	label: string;
	run: () => void;
}
let slashOpen = $state(false);
let slashFrom = $state(0);
let slashQuery = $state("");
let slashIndex = $state(0);
let slashPos: { x: number; y: number } | null = $state(null);
let slashArmed = false;

function slashItems(): SlashItem[] {
	return [
		{
			id: "img-inline",
			label: "Image · inline",
			run: () => openImageDialog("insert"),
		},
		{
			id: "img-full",
			label: "Image · full-bleed",
			run: () => {
				openImageDialog("insert");
				pickerLayout = "full";
			},
		},
		{
			id: "img-pair",
			label: "Image · pair",
			run: () => openImageDialog("pair"),
		},
		{
			id: "divider",
			label: "Divider · gurat line",
			run: () => {
				editor?.chain().focus().setHorizontalRule().run();
				markDirty();
			},
		},
		{
			id: "sidenote",
			label: "Sidenote",
			run: () => sidenoteDialog?.showModal(),
		},
	];
}

const slashFiltered = $derived(
	slashItems().filter((item) =>
		item.label.toLowerCase().includes(slashQuery.toLowerCase()),
	),
);

function openSlashMenu(): void {
	if (!editor) return;
	slashOpen = true;
	slashQuery = "";
	slashIndex = 0;
	try {
		const coords = editor.view.coordsAtPos(editor.state.selection.from);
		slashPos = { x: coords.left, y: coords.bottom };
	} catch {
		slashPos = null;
	}
}

function closeSlashMenu(): void {
	slashOpen = false;
	slashQuery = "";
	slashIndex = 0;
	slashPos = null;
}

function deleteSlashText(): void {
	if (!editor) return;
	try {
		const to = editor.state.selection.from;
		if (to > slashFrom)
			editor.chain().focus().deleteRange({ from: slashFrom, to }).run();
	} catch {
		/* selection already moved; insert anyway */
	}
}

function pickSlashItem(item: SlashItem): void {
	deleteSlashText();
	closeSlashMenu();
	editor?.chain().focus().run();
	item.run();
}

function syncSlashQuery(): void {
	if (!editor || !slashOpen) return;
	try {
		const to = editor.state.selection.from;
		if (to <= slashFrom) {
			closeSlashMenu();
			return;
		}
		const text = editor.state.doc.textBetween(slashFrom + 1, to, " ");
		if (text.includes(" ") || text.includes("\n")) {
			closeSlashMenu();
			return;
		}
		slashQuery = text;
		slashIndex = 0;
	} catch {
		closeSlashMenu();
	}
}

// DETAILS slide-over.
let detailsOpen = $state(false);
let detailsEl: HTMLElement | null = $state(null);
let tagPickerOpen = $state(false);
let tagFilter = $state("");
let seoEditing = $state(false);
const tagSuggestions = $derived(
	allTags.filter(
		(t) =>
			!metaTags.includes(t.id) &&
			t.slug.toLowerCase().includes(tagFilter.toLowerCase()),
	),
);
const detailsPrevFocus: { el: Element | null } = { el: null };

function openDetails(): void {
	detailsPrevFocus.el = document.activeElement;
	detailsOpen = true;
	requestAnimationFrame(() => {
		detailsEl
			?.querySelector<HTMLElement>("button, input, select, textarea")
			?.focus();
	});
}

function closeDetails(): void {
	detailsOpen = false;
	tagPickerOpen = false;
	(detailsPrevFocus.el as HTMLElement | null)?.focus?.();
}

function trapDetailsTab(e: KeyboardEvent): void {
	if (e.key !== "Tab" || !detailsEl) return;
	const items = [
		...detailsEl.querySelectorAll<HTMLElement>(
			'button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
		),
	].filter((el) => el.offsetParent !== null);
	if (items.length === 0) return;
	const first = items[0];
	const last = items[items.length - 1];
	if (e.shiftKey && document.activeElement === first) {
		e.preventDefault();
		last.focus();
	} else if (!e.shiftKey && document.activeElement === last) {
		e.preventDefault();
		first.focus();
	}
}

function setScheduleMode(mode: "now" | "schedule"): void {
	if (mode === "now") {
		publishedAt = null;
		publishedInput = "";
	} else if (publishedAt === null) {
		// Default to one hour out, formatted for datetime-local.
		const d = new Date(Date.now() + 3600000);
		publishedInput = d.toISOString().slice(0, 16);
		publishedAt = d.getTime();
	}
	publishedDirty = true;
	markDirty();
}

function onPublishedInput(value: string): void {
	publishedInput = value;
	publishedAt = value === "" ? null : new Date(value).getTime();
	publishedDirty = true;
	markDirty();
}

function addTag(id: string): void {
	if (!metaTags.includes(id)) {
		metaTags = [...metaTags, id];
		markDirty();
	}
	tagFilter = "";
}

function removeTag(id: string): void {
	metaTags = metaTags.filter((t) => t !== id);
	markDirty();
}

function tagSlug(id: string): string {
	return allTags.find((t) => t.id === id)?.slug ?? id;
}

// PREVIEW mode: client-side renderDoc into the public article container.
let previewOpen = $state(false);
let previewWidth: "desktop" | "mobile" = $state("desktop");
let previewTick = $state(0);
let previewHtml = $state("");
let previewToc: TocEntry[] = $state([]);
let previewError: string | null = $state(null);

function refreshPreview(): void {
	previewError = null;
	if (!editor) {
		previewHtml = "";
		previewToc = [];
		return;
	}
	try {
		const media = new Map<string, Media>();
		for (const m of libraryFull) media.set(m.id, m);
		const doc = tiptapToDoc(editor.getJSON());
		const result = renderDoc(doc, {
			locale: metaLocale,
			media,
			baseUrl: mediaBaseUrl,
			coverMediaId: metaCover === "" ? null : metaCover,
		});
		previewHtml = result.html;
		previewToc = result.toc;
	} catch (err) {
		previewHtml = "";
		previewToc = [];
		previewError = err instanceof Error ? err.message : "preview failed";
	}
}

function togglePreview(): void {
	previewOpen = !previewOpen;
	if (previewOpen) {
		previewTick++;
		refreshPreview();
	}
}

function toggleFocus(): void {
	focusMode = !focusMode;
	document.body.dataset.focus = focusMode ? "true" : "false";
}

function coverSrc(): string {
	if (metaCover === "") return "";
	const lib = library.find((m) => m.id === metaCover);
	if (lib) {
		try {
			const full = libraryFull.find((m) => m.id === metaCover);
			if (full) return smallestVariantUrl(full, mediaBaseUrl);
		} catch {
			/* fall through to the id preview */
		}
		return previewUrl(metaCover);
	}
	if (allMedia.some((m) => m.id === metaCover)) return previewUrl(metaCover);
	return "";
}

function globalKeydown(e: KeyboardEvent): void {
	const target = e.target as HTMLElement | null;
	const inField =
		target !== null &&
		(target.tagName === "INPUT" ||
			target.tagName === "TEXTAREA" ||
			target.tagName === "SELECT" ||
			target.isContentEditable);
	if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
		e.preventDefault();
		togglePreview();
		return;
	}
	if (e.key === "Escape") {
		if (slashOpen) {
			closeSlashMenu();
			return;
		}
		if (showLinkPopover) {
			showLinkPopover = false;
			return;
		}
		if (detailsOpen) {
			closeDetails();
			return;
		}
		return;
	}
	if (inField || slashOpen) return;
	if (e.key.toLowerCase() === "f" && !e.metaKey && !e.ctrlKey && !e.altKey) {
		toggleFocus();
	} else if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
		e.preventDefault();
		openSlashMenu();
		editor?.chain().focus().run();
	}
}

onMount(() => {
	// Adopt legacy page-level meta inputs when the new props are empty
	// (back-compat while the Astro wrappers migrate to island props).
	const adopt = (id: string): string => {
		const el = document.getElementById(id) as
			| HTMLInputElement
			| HTMLTextAreaElement
			| HTMLSelectElement
			| null;
		return el?.value ?? "";
	};
	if (metaTitle === "") {
		const v = adopt("meta-title");
		if (v !== "") metaTitle = v;
	}
	if (metaSlug === "") {
		const v = adopt("meta-slug");
		if (v !== "") {
			metaSlug = v;
			slugTouched = true;
		}
	}
	if (metaExcerpt === "") {
		const v = adopt("meta-excerpt");
		if (v !== "") metaExcerpt = v;
	}
	if (metaSeo === "") {
		const v = adopt("meta-seo");
		if (v !== "") {
			metaSeo = v;
			seoOverride = true;
		}
	}
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
				handleKeyDown: (_view, event) => {
					if (slashOpen) {
						const list = slashFiltered;
						if (event.key === "ArrowDown") {
							event.preventDefault();
							slashIndex =
								list.length === 0 ? 0 : (slashIndex + 1) % list.length;
							return true;
						}
						if (event.key === "ArrowUp") {
							event.preventDefault();
							slashIndex =
								list.length === 0
									? 0
									: (slashIndex - 1 + list.length) % list.length;
							return true;
						}
						if (event.key === "Enter") {
							const item = list[slashIndex];
							if (item) {
								event.preventDefault();
								pickSlashItem(item);
								return true;
							}
						}
						if (event.key === "Escape") {
							event.preventDefault();
							closeSlashMenu();
							return true;
						}
						return false;
					}
					if (event.key === "/") {
						slashArmed = true;
						try {
							slashFrom = editor?.state.selection.from ?? 0;
						} catch {
							slashFrom = 0;
						}
					}
					return false;
				},
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
			onUpdate: ({ editor: e }) => {
				refreshStats();
				if (slashArmed) {
					slashArmed = false;
					try {
						slashFrom = e.state.selection.from - 1;
					} catch {
						slashFrom = 0;
					}
					openSlashMenu();
				} else if (slashOpen) {
					syncSlashQuery();
				}
				refreshSelection();
				if (previewOpen) refreshPreview();
				markDirty();
			},
			onSelectionUpdate: () => {
				refreshSelection();
			},
			onCreate: ({ editor: e }) => {
				words = wordCount(e.getText());
			},
		});
		window.addEventListener("beforeunload", beforeUnload);
		window.addEventListener("keydown", globalKeydown);
		tickTimer = setInterval(() => {
			nowTick = Date.now();
		}, 30000);
		nowTick = Date.now();
	})();
});

onDestroy(() => {
	if (saveTimer) clearTimeout(saveTimer);
	if (tickTimer) clearInterval(tickTimer);
	window.removeEventListener("beforeunload", beforeUnload);
	window.removeEventListener("keydown", globalKeydown);
	if (focusMode) delete document.body.dataset.focus;
	editor?.destroy();
	editor = null;
});
</script>

<div class="ed" class:ed-focus={focusMode} class:ed-preview={previewOpen}>
	<!-- Sticky top bar -->
	<header class="ed-top">
		<a class="ed-back" href="/admin/posts">← ALL POSTS</a>
		<p class="ed-status" role="status" aria-live="polite">{statusText}</p>
		<div class="ed-top-actions">
			<button
				type="button"
				class="ed-btn ed-btn-ghost"
				aria-pressed={previewOpen}
				onclick={togglePreview}
			>
				PREVIEW
			</button>
			<button
				type="button"
				class="ed-btn ed-btn-ghost"
				aria-expanded={detailsOpen}
				onclick={() => (detailsOpen ? closeDetails() : openDetails())}
			>
				DETAILS
			</button>
			<button
				type="button"
				class="ed-btn ed-btn-solid"
				onclick={openPublishDialog}
			>
				Publish
			</button>
		</div>
	</header>

	{#if saveState === "conflict"}
		<div class="ed-conflict" role="alert">
			<p>
				Someone else saved this post (server stamp {conflictStamp}). Your
				version is intact.
			</p>
			<button type="button" class="ed-btn ed-btn-ghost" onclick={reloadServer}>
				Reload server version
			</button>
			<button type="button" class="ed-btn ed-btn-solid" onclick={overwriteMine}>
				Overwrite with mine
			</button>
		</div>
	{/if}

	<div class="ed-main">
		<!-- Centered writing column -->
		<main class="ed-canvas">
			{#if !previewOpen}
				{#if metaCover !== ""}
					<figure class="ed-cover">
						{#if coverSrc() !== ""}
							<img src={coverSrc()} alt="" />
						{/if}
						<figcaption>
							<button
								type="button"
								class="ed-btn ed-btn-ghost"
								onclick={() => openImageDialog("cover")}
							>
								[CHANGE COVER]
							</button>
						</figcaption>
					</figure>
				{:else}
					<p class="ed-cover-empty">
						<button
							type="button"
							class="ed-btn ed-btn-ghost"
							onclick={() => openImageDialog("cover")}
						>
							[ADD COVER]
						</button>
					</p>
				{/if}
				<label class="ed-title-label" for="meta-title">Title</label>
				<input
					id="meta-title"
					class="ed-title"
					value={metaTitle}
					maxlength={300}
					placeholder="Untitled"
					autocomplete="off"
					oninput={(e) => onTitleInput((e.target as HTMLInputElement).value)}
				/>
				<textarea
					id="meta-excerpt"
					class="ed-subtitle"
					value={metaExcerpt}
					maxlength={500}
					rows={2}
					placeholder="A one-line summary…"
					aria-label="Excerpt"
					oninput={(e) => {
						metaExcerpt = (e.target as HTMLTextAreaElement).value;
						markDirty();
					}}
				/>
				<div class="article-body ed-body" bind:this={element}></div>
				{#if selectedFig !== null}
					<div class="ed-caption-row">
						<label for="ed-figcaption">Caption</label>
						<input
							id="ed-figcaption"
							value={selectedFig.caption}
							placeholder="ADD A CAPTION…"
							maxlength={300}
							autocomplete="off"
							oninput={(e) =>
								setFigureCaption((e.target as HTMLInputElement).value)}
						/>
					</div>
				{/if}
			{:else}
				<div class="ed-preview-bar" role="toolbar" aria-label="Preview width">
					<button
						type="button"
						class="ed-btn ed-btn-ghost"
						aria-pressed={previewWidth === "desktop"}
						onclick={() => (previewWidth = "desktop")}
					>
						DESKTOP
					</button>
					<button
						type="button"
						class="ed-btn ed-btn-ghost"
						aria-pressed={previewWidth === "mobile"}
						onclick={() => (previewWidth = "mobile")}
					>
						MOBILE
					</button>
				</div>
				{#if previewToc.length > 0}
					<nav class="ed-preview-toc" aria-label="Table of contents">
						<ul>
							{#each previewToc as entry (entry.id)}
								<li><a href={`#${entry.id}`}>{entry.text}</a></li>
							{/each}
						</ul>
					</nav>
				{/if}
				{#if previewError !== null}
					<p class="ed-error" role="status">{previewError}</p>
				{:else}
					<div
						class="article-body ed-preview-doc"
						class:ed-preview-mobile={previewWidth === "mobile"}
					>
						<h1 class="ed-preview-title">{metaTitle || "(untitled)"}</h1>
						{@html previewHtml}
					</div>
				{/if}
			{/if}
		</main>

		<!-- DETAILS slide-over -->
		{#if detailsOpen}
			<aside
				class="ed-details"
				aria-label="Post details"
				bind:this={detailsEl}
				onkeydown={trapDetailsTab}
			>
				<div class="ed-details-head">
					<h2>DETAILS</h2>
					<button
						type="button"
						class="ed-btn ed-btn-ghost"
						aria-expanded={detailsOpen}
						onclick={closeDetails}
					>
						CLOSE ✕
					</button>
				</div>

				<section aria-label="Language">
					<h3>LANGUAGE</h3>
					<div role="group" aria-label="Language">
						<button
							type="button"
							class="ed-pill"
							aria-pressed={metaLocale === "en"}
							onclick={() => {
								metaLocale = "en";
								markDirty();
							}}
						>
							en
						</button>
						<button
							type="button"
							class="ed-pill"
							aria-pressed={metaLocale === "id"}
							onclick={() => {
								metaLocale = "id";
								markDirty();
							}}
						>
							id
						</button>
					</div>
					<select
						id="meta-locale"
						aria-label="Locale"
						class="ed-visually-hidden"
						tabindex="-1"
						value={metaLocale}
						onchange={(e) => {
							metaLocale = (e.target as HTMLSelectElement).value as "en" | "id";
							markDirty();
						}}
					>
						<option value="en">en</option>
						<option value="id">id</option>
					</select>
					{#if groupId === null}
						<p class="ed-muted">
							{otherLocale.toUpperCase()} version: not created.
							{#if postId !== null}
								<button
									type="button"
									class="ed-link"
									disabled={translationBusy}
									onclick={() => void createTranslation()}
								>
									create translation
								</button>
							{/if}
						</p>
					{:else}
						<p class="ed-muted">Linked group: {groupId}</p>
					{/if}
					<label class="ed-field">
						<span>Link existing {otherLocale} post</span>
						<select
							aria-label="Link existing post"
							value={linkTarget}
							onchange={(e) => {
								linkTarget = (e.target as HTMLSelectElement).value;
							}}
						>
							<option value="">—</option>
							{#each candidates.filter((c) => c.groupId === null) as c (c.id)}
								<option value={c.id}>{c.slug} — {c.title || "(untitled)"}</option>
							{/each}
						</select>
					</label>
					<button
						type="button"
						class="ed-btn ed-btn-ghost"
						disabled={translationBusy || linkTarget === "" || postId === null}
						onclick={() => void linkExisting()}
					>
						Link
					</button>
					{#if translationError}<p class="ed-error">{translationError}</p>{/if}
				</section>

				<section aria-label="Slug">
					<h3>SLUG</h3>
					<label class="ed-field">
						<span class="ed-visually-hidden">Slug</span>
						<input
							id="meta-slug"
							value={metaSlug}
							maxlength={150}
							autocomplete="off"
							oninput={(e) => {
								metaSlug = (e.target as HTMLInputElement).value;
								slugTouched = true;
								markDirty();
							}}
						/>
					</label>
					{#if status === "published"}
						<p class="ed-warn" role="note">
							Published post: changing the slug breaks existing links (no
							redirect manager).
						</p>
					{/if}
				</section>

				<section aria-label="Excerpt">
					<h3>EXCERPT</h3>
					<textarea
						value={metaExcerpt}
						maxlength={500}
						rows={3}
						aria-label="Excerpt"
						oninput={(e) => {
							metaExcerpt = (e.target as HTMLTextAreaElement).value;
							markDirty();
						}}
					/>
				</section>

				<section aria-label="Tags">
					<h3>TAGS</h3>
					<ul class="ed-chips">
						{#each metaTags as id (id)}
							<li class="ed-chip">
								<span>{tagSlug(id)}</span>
								<button
									type="button"
									aria-label={`Remove tag ${tagSlug(id)}`}
									onclick={() => removeTag(id)}
								>
									×
								</button>
							</li>
						{/each}
					</ul>
					<button
						type="button"
						class="ed-btn ed-btn-ghost"
						aria-expanded={tagPickerOpen}
						onclick={() => (tagPickerOpen = !tagPickerOpen)}
					>
						+ add
					</button>
					{#if tagPickerOpen}
						<label class="ed-field">
							<span class="ed-visually-hidden">Filter tags</span>
							<input
								value={tagFilter}
								placeholder="filter tags…"
								aria-label="Filter tags"
								autocomplete="off"
								oninput={(e) => {
									tagFilter = (e.target as HTMLInputElement).value;
								}}
							/>
						</label>
						<ul role="listbox" aria-label="Available tags" class="ed-taglist">
							{#each tagSuggestions as t (t.id)}
								<li
									role="option"
									aria-selected="false"
									tabindex="0"
									onclick={() => addTag(t.id)}
									onkeydown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											addTag(t.id);
										}
									}}
								>
									{t.slug}
								</li>
							{:else}
								<li class="ed-muted">No matching tags.</li>
							{/each}
						</ul>
					{/if}
					<select
						id="meta-tags"
						multiple
						aria-label="Tags"
						class="ed-visually-hidden"
						tabindex="-1"
						onchange={(e) => {
							metaTags = [...(e.target as HTMLSelectElement).selectedOptions].map(
								(o) => o.value,
							);
							markDirty();
						}}
					>
						{#each allTags as t (t.id)}
							<option value={t.id} selected={metaTags.includes(t.id)}>
								{t.slug}
							</option>
						{/each}
					</select>
				</section>

				<section aria-label="Publish schedule">
					<h3>PUBLISH</h3>
					<div role="group" aria-label="Publish timing">
						<button
							type="button"
							class="ed-pill"
							aria-pressed={publishedAt === null}
							onclick={() => setScheduleMode("now")}
						>
							now
						</button>
						<button
							type="button"
							class="ed-pill"
							aria-pressed={publishedAt !== null}
							onclick={() => setScheduleMode("schedule")}
						>
							schedule
						</button>
					</div>
					<label class="ed-field">
						<span>Published at (future = scheduled)</span>
						<input
							id="meta-published"
							type="datetime-local"
							value={publishedInput}
							oninput={(e) =>
								onPublishedInput((e.target as HTMLInputElement).value)}
						/>
					</label>
				</section>

				<section aria-label="SEO description">
					<h3>SEO DESCRIPTION</h3>
					{#if !seoOverride}
						<p class="ed-muted">
							uses the excerpt ·
							<button
								type="button"
								class="ed-link"
								onclick={() => {
									seoOverride = true;
									metaSeo = metaExcerpt;
									markDirty();
								}}
							>
								edit
							</button>
						</p>
					{:else}
						<textarea
							id="meta-seo"
							value={metaSeo}
							maxlength={320}
							rows={3}
							aria-label="SEO description"
							oninput={(e) => {
								metaSeo = (e.target as HTMLTextAreaElement).value;
								markDirty();
							}}
						/>
					{/if}
				</section>

				<section aria-label="Cover image">
					<h3>COVER</h3>
					<label class="ed-field">
						<span class="ed-visually-hidden">Cover image</span>
						<select
							id="meta-cover"
							aria-label="Cover image"
							value={metaCover}
							onchange={(e) => {
								metaCover = (e.target as HTMLSelectElement).value;
								markDirty();
							}}
						>
							<option value="">—</option>
							{#each library as item (item.id)}
								<option value={item.id}>
									{item.id} ({item.width}×{item.height})
								</option>
							{/each}
							{#each allMedia.filter((m) => !library.some((l) => l.id === m.id)) as m (m.id)}
								<option value={m.id}>{m.id} ({m.width}×{m.height})</option>
							{/each}
						</select>
					</label>
					<button
						type="button"
						class="ed-btn ed-btn-ghost"
						onclick={() => openImageDialog("cover")}
					>
						[CHANGE COVER]
					</button>
				</section>

				<input id="meta-group" type="hidden" value={metaGroup ?? ""} />

				<section aria-label="Share image">
					<h3>SHARE IMAGE</h3>
					{#if postId === null}
						<p class="ed-muted">Save the post first, then generate its share image.</p>
					{:else}
						<button
							type="button"
							class="ed-btn ed-btn-ghost"
							onclick={() => void generateShareImage()}
							disabled={ogBusy}
						>
							{ogBusy ? "Generating…" : "Generate share image"}
						</button>
						{#if ogStale}
							<p class="ed-warn" role="status">
								Title or cover changed since the last share image — regenerate
								to refresh link previews.
							</p>
						{/if}
						{#if ogStatus !== null}
							<p class="ed-muted" role="status">{ogStatus}</p>
						{/if}
					{/if}
				</section>

				<section aria-label="Danger zone">
					<h3>DANGER</h3>
					<div class="ed-row">
						{#if status === "published"}
							<button
								type="button"
								class="ed-btn ed-btn-ghost"
								onclick={() => void unpublish()}
							>
								Unpublish
							</button>
						{/if}
						<button
							type="button"
							class="ed-btn ed-btn-ghost"
							onclick={() => {
								showDeleteConfirm = true;
							}}
						>
							Delete
						</button>
					</div>
					{#if showDeleteConfirm}
						<label class="ed-field">
							<span>Type the slug to confirm delete</span>
							<input
								bind:value={deleteSlug}
								aria-label="Type the slug to confirm delete"
								autocomplete="off"
							/>
						</label>
						<button
							type="button"
							class="ed-btn ed-btn-ghost"
							disabled={deleteSlug !== metaSlug}
							onclick={() => void remove()}
						>
							Confirm delete
						</button>
					{/if}
				</section>
			</aside>
		{/if}
	</div>

	<!-- Bottom status bar -->
	<footer class="ed-bottom">
		<span>{words} WORDS · {readingMinutes} MIN READ</span>
		<span class="ed-bottom-actions">
			<button
				type="button"
				class="ed-link"
				aria-pressed={focusMode}
				onclick={toggleFocus}
			>
				F FOCUS
			</button>
			<button
				type="button"
				class="ed-link"
				onclick={() => {
					openSlashMenu();
					editor?.chain().focus().run();
				}}
			>
				/ INSERT
			</button>
			<button type="button" class="ed-link" onclick={togglePreview}>
				⌘P PREVIEW
			</button>
		</span>
	</footer>

	<!-- Floating bubble menu (text selection + figure switcher) -->
	{#if bubblePos !== null && !previewOpen}
		<div
			class="ed-bubble"
			role="toolbar"
			aria-label={bubbleForFigure ? "Figure layout" : "Formatting"}
			style={`left: ${bubblePos.x}px; top: ${bubblePos.y}px;`}
		>
			{#if bubbleForFigure}
				{#each ["inline", "wide", "full", "pair"] as layout (layout)}
					<button
						type="button"
						class="ed-bubble-btn"
						aria-pressed={selectedFig?.layout === layout}
						onclick={() => setFigureLayout(layout)}
					>
						{layout.toUpperCase()}
					</button>
				{/each}
			{:else}
				<button
					type="button"
					class="ed-bubble-btn"
					aria-pressed={editor?.isActive("bold") ?? false}
					aria-label="Bold"
					onclick={() => {
						editor?.chain().focus().toggleBold().run();
						refreshSelection();
						markDirty();
					}}
				>
					<strong>B</strong>
				</button>
				<button
					type="button"
					class="ed-bubble-btn"
					aria-pressed={editor?.isActive("italic") ?? false}
					aria-label="Italic"
					onclick={() => {
						editor?.chain().focus().toggleItalic().run();
						refreshSelection();
						markDirty();
					}}
				>
					<em>I</em>
				</button>
				<button
					type="button"
					class="ed-bubble-btn"
					aria-label="Link"
					onclick={bubbleLinkOpen}
				>
					link
				</button>
				<button
					type="button"
					class="ed-bubble-btn"
					aria-pressed={editor?.isActive("heading", { level: 2 }) ?? false}
					aria-label="Heading 2"
					onclick={() => {
						editor?.chain().focus().toggleHeading({ level: 2 }).run();
						refreshSelection();
						markDirty();
					}}
				>
					H2
				</button>
				<button
					type="button"
					class="ed-bubble-btn"
					aria-pressed={editor?.isActive("pullquote") ?? false}
					aria-label="Pullquote"
					onclick={togglePullquote}
				>
					“ ”
				</button>
			{/if}
			{#if showLinkPopover}
				<form
					class="ed-link-pop"
					onsubmit={(e) => {
						e.preventDefault();
						applyLink();
					}}
				>
					<label>
						<span class="ed-visually-hidden">Link URL</span>
						<input
							value={linkHref}
							placeholder="https://…"
							aria-label="Link URL"
							inputmode="url"
							autocomplete="off"
							oninput={(e) => {
								linkHref = (e.target as HTMLInputElement).value;
							}}
						/>
					</label>
					{#if linkError}<p class="ed-error">{linkError}</p>{/if}
					<button type="submit" class="ed-bubble-btn">Apply</button>
					<button
						type="button"
						class="ed-bubble-btn"
						onclick={() => {
							showLinkPopover = false;
						}}
					>
						Cancel
					</button>
				</form>
			{/if}
		</div>
	{/if}

	<!-- Slash combobox -->
	{#if slashOpen && !previewOpen}
		<div
			class="ed-slash"
			role="listbox"
			aria-label="Insert"
			style={slashPos !== null
				? `left: ${slashPos.x}px; top: ${slashPos.y}px;`
				: undefined}
		>
			{#each slashFiltered as item, i (item.id)}
				<button
					type="button"
					role="option"
					aria-selected={i === slashIndex}
					class="ed-slash-item"
					class:ed-slash-active={i === slashIndex}
					onclick={() => pickSlashItem(item)}
					onmouseenter={() => (slashIndex = i)}
				>
					{item.label}
				</button>
			{:else}
				<p class="ed-muted">No matches — Esc to dismiss.</p>
			{/each}
		</div>
	{/if}

	<!-- Dialog-based pickers (restyled only; flows unchanged) -->
	<dialog bind:this={linkDialog} aria-label="Edit link">
		<form method="dialog">
			<label>URL (http(s), mailto, or site-relative)
				<input bind:value={linkHref} aria-label="Link URL" inputmode="url" />
			</label>
			{#if linkError}<p class="ed-error">{linkError}</p>{/if}
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
			{#if libraryError}<p class="ed-error">{libraryError}</p>{/if}
			<label>Choose from library
				<select bind:value={pickerMediaId} aria-label="Choose image from library">
					<option value="">—</option>
					{#each library as item (item.id)}
						<option value={item.id}>{item.id} ({item.width}×{item.height})</option>
					{/each}
					{#each allMedia.filter((m) => !library.some((l) => l.id === m.id)) as m (m.id)}
						<option value={m.id}>{m.id} ({m.width}×{m.height})</option>
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
			{#if pickerBusy}<p class="ed-muted">Uploading…</p>{/if}
			<label>Alt text (required)
				<input
					bind:value={pickerAlt}
					aria-label="Image alt text"
					oninput={() => {
						pickerAltTouched = true;
					}}
				/>
			</label>
			<label>
				<input
					type="checkbox"
					bind:checked={pickerDecorative}
					aria-label="Decorative image"
				/>
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
			{#if pickerError}<p class="ed-error">{pickerError}</p>{/if}
			<button
				type="button"
				onclick={insertFromPicker}
				disabled={pickerMediaId === "" ||
					(pickerMode === "insert" && !pickerAltTouched && !pickerDecorative) ||
					(pickerMode === "pair" && !pickerAltTouched && !pickerDecorative)}
			>
				Insert
			</button>
			<button type="submit">Cancel</button>
		</form>
	</dialog>

	<!-- Pre-publish checklist -->
	<dialog bind:this={publishDialog} aria-label="Publish checklist">
		<form method="dialog">
			<h2>Publish checklist</h2>
			<ul class="ed-checklist">
				<li aria-label={checklistTitle ? "Title present" : "Title missing"}>
					{checklistTitle ? "✓" : "✕"} Title present
				</li>
				<li aria-label={checklistSlug ? "Slug valid" : "Slug invalid"}>
					{checklistSlug ? "✓" : "✕"} Slug valid
				</li>
				<li aria-label={checklistBody ? "Body non-empty" : "Body empty"}>
					{checklistBody ? "✓" : "✕"} Content non-empty
				</li>
				<li>
					{checklistCover ? "✓" : "!"} Cover image{checklistCover
						? " set"
						: " missing (warning only)"}
				</li>
				<li>
					{checklistTranslation ? "✓" : "!"} Translation counterpart{checklistTranslation
						? " linked"
						: " not linked yet"}
				</li>
			</ul>
			{#if publishError}<p class="ed-error">{publishError}</p>{/if}
			<button
				type="button"
				disabled={!checklistReady || publishBusy}
				onclick={() => void confirmPublish()}
			>
				{publishBusy ? "Publishing…" : "Confirm publish"}
			</button>
			<button type="submit">Cancel</button>
		</form>
	</dialog>
</div>

<style>
	.ed {
		display: flex;
		flex-direction: column;
		min-height: 100%;
		background: var(--bg);
		color: var(--ink);
		color-scheme: light dark;
	}
	.ed-top {
		position: sticky;
		top: 0;
		z-index: 30;
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.6rem 1rem;
		border-bottom: 1px solid var(--line);
		background: var(--bg);
	}
	.ed-back {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		letter-spacing: 0.08em;
		color: var(--ink);
		text-decoration: none;
		white-space: nowrap;
	}
	.ed-status {
		flex: 1;
		text-align: center;
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		letter-spacing: 0.08em;
		color: var(--muted);
		margin: 0;
	}
	.ed-top-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.ed-btn {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		letter-spacing: 0.08em;
		padding: 0.45rem 0.9rem;
		border: 1px solid var(--ink);
		background: transparent;
		color: var(--ink);
		cursor: pointer;
	}
	.ed-btn-solid {
		background: var(--ink);
		color: var(--bg);
	}
	.ed-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.ed-btn-ghost[aria-pressed="true"],
	.ed-btn-ghost[aria-expanded="true"] {
		background: var(--ink);
		color: var(--bg);
	}
	.ed-conflict {
		border-bottom: 1px solid var(--error, currentColor);
		padding: 0.75rem 1rem;
	}
	.ed-main {
		display: flex;
		align-items: stretch;
		justify-content: center;
		flex: 1;
		position: relative;
	}
	.ed-canvas {
		width: min(100%, calc(68ch + 2rem));
		min-width: 0;
		padding: 2rem 1rem 6rem;
	}
	.ed-cover img {
		width: 100%;
		height: auto;
		display: block;
	}
	.ed-cover-empty {
		margin: 0 0 1rem;
	}
	.ed-title-label {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
	.ed-title {
		width: 100%;
		border: none;
		background: transparent;
		color: var(--ink);
		font-family: var(--font-serif, serif);
		font-size: clamp(2rem, 5vw, 3rem);
		font-weight: 500;
		line-height: 1.1;
		padding: 0;
		margin: 0 0 0.5rem;
	}
	.ed-title:focus {
		outline: 1px solid var(--rule, currentColor);
		outline-offset: 4px;
	}
	.ed-subtitle {
		width: 100%;
		border: none;
		background: transparent;
		color: var(--muted);
		font-family: var(--font-serif, serif);
		font-style: italic;
		font-size: 1.15rem;
		resize: vertical;
		padding: 0;
		margin: 0 0 2rem;
	}
	.ed-subtitle:focus {
		outline: 1px solid var(--rule, currentColor);
		outline-offset: 4px;
	}
	.ed-body :global(.tiptap:focus) {
		outline: none;
	}
	.ed-caption-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-top: 0.5rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
	}
	.ed-caption-row input {
		flex: 1;
		font: inherit;
		background: transparent;
		color: var(--ink);
		border: none;
		border-bottom: 1px solid var(--line);
		padding: 0.25rem 0;
	}
	.ed-details {
		width: min(22rem, 90vw);
		flex-shrink: 0;
		border-left: 1px solid var(--line);
		background: var(--surface, var(--bg));
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		max-height: calc(100vh - 3.5rem);
		overflow-y: auto;
		position: sticky;
		top: 3.5rem;
	}
	.ed-details h2 {
		font-family: var(--font-mono, monospace);
		font-size: 0.8rem;
		letter-spacing: 0.1em;
		margin: 0;
	}
	.ed-details h3 {
		font-family: var(--font-mono, monospace);
		font-size: 0.7rem;
		letter-spacing: 0.1em;
		color: var(--muted);
		margin: 0 0 0.5rem;
	}
	.ed-details-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.ed-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		margin-top: 0.5rem;
	}
	.ed-field input,
	.ed-field select,
	.ed-field textarea,
	.ed-details input,
	.ed-details select,
	.ed-details textarea {
		font-family: var(--font-mono, monospace);
		font-size: 0.8rem;
		background: var(--bg);
		color: var(--ink);
		border: 1px solid var(--line);
		padding: 0.4rem 0.5rem;
		max-width: 100%;
	}
	.ed-pill {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		padding: 0.3rem 0.8rem;
		border: 1px solid var(--ink);
		background: transparent;
		color: var(--ink);
		cursor: pointer;
		margin-right: 0.4rem;
	}
	.ed-pill[aria-pressed="true"] {
		background: var(--ink);
		color: var(--bg);
	}
	.ed-muted {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		color: var(--muted);
	}
	.ed-warn {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		border: 1px solid var(--ink);
		padding: 0.5rem;
	}
	.ed-error {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		color: var(--error, inherit);
	}
	.ed-link {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
	.ed-chips {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		padding: 0;
		margin: 0 0 0.5rem;
	}
	.ed-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		border: 1px solid var(--ink);
		padding: 0.2rem 0.4rem 0.2rem 0.6rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
	}
	.ed-chip button {
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
		padding: 0 0.2rem;
	}
	.ed-taglist {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
		border: 1px solid var(--line);
		max-height: 10rem;
		overflow-y: auto;
	}
	.ed-taglist li[role="option"] {
		padding: 0.4rem 0.6rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.8rem;
		cursor: pointer;
	}
	.ed-taglist li[role="option"]:hover,
	.ed-taglist li[role="option"]:focus {
		background: var(--ink);
		color: var(--bg);
		outline: none;
	}
	.ed-row {
		display: flex;
		gap: 0.5rem;
	}
	.ed-checklist {
		list-style: none;
		padding: 0;
		font-family: var(--font-mono, monospace);
		font-size: 0.8rem;
	}
	.ed-checklist li {
		padding: 0.25rem 0;
	}
	.ed-bottom {
		position: sticky;
		bottom: 0;
		z-index: 30;
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.5rem 1rem;
		border-top: 1px solid var(--line);
		background: var(--bg);
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	.ed-bottom-actions {
		display: flex;
		gap: 1rem;
	}
	.ed-bottom .ed-link {
		font: inherit;
		letter-spacing: inherit;
	}
	.ed-bubble {
		position: fixed;
		z-index: 50;
		transform: translate(-50%, calc(-100% - 8px));
		display: flex;
		gap: 0.15rem;
		background: var(--ink);
		color: var(--bg);
		padding: 0.25rem;
		border: 1px solid var(--ink);
	}
	.ed-bubble-btn {
		background: transparent;
		border: none;
		color: inherit;
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		padding: 0.35rem 0.55rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.ed-bubble-btn:hover,
	.ed-bubble-btn:focus-visible {
		outline: 1px solid currentColor;
	}
	.ed-bubble-btn[aria-pressed="true"] {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.ed-link-pop {
		display: flex;
		gap: 0.25rem;
		align-items: center;
		padding-left: 0.25rem;
	}
	.ed-link-pop input {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		background: var(--bg);
		color: var(--ink);
		border: 1px solid var(--line);
		padding: 0.3rem 0.4rem;
		width: 12rem;
	}
	.ed-slash {
		position: fixed;
		z-index: 50;
		background: var(--bg);
		border: 1px solid var(--ink);
		min-width: 14rem;
		padding: 0.25rem;
	}
	.ed-slash-item {
		display: block;
		width: 100%;
		text-align: left;
		background: transparent;
		border: none;
		color: var(--ink);
		font-family: var(--font-mono, monospace);
		font-size: 0.8rem;
		padding: 0.45rem 0.6rem;
		cursor: pointer;
	}
	.ed-slash-active {
		background: var(--ink);
		color: var(--bg);
	}
	.ed-slash-item:focus-visible {
		outline: 2px solid var(--rule, currentColor);
		outline-offset: -2px;
	}
	.ed-preview-bar {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.ed-preview-doc {
		max-width: 68ch;
	}
	.ed-preview-mobile {
		max-width: 390px;
		margin-inline: auto;
		border: 1px solid var(--line);
		padding: 1rem;
	}
	.ed-preview-title {
		font-family: var(--font-serif, serif);
	}
	.ed-preview-toc ul {
		list-style: none;
		padding: 0;
		font-family: var(--font-mono, monospace);
		font-size: 0.8rem;
	}
	.ed-visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
	/* Legacy compat selects keep their ids for e2e but must never paint:
	   clip alone still reserves a listbox in some engines, so pin them
	   off-screen without pointer events. */
	select.ed-visually-hidden {
		position: fixed;
		top: 0;
		left: 0;
		opacity: 0;
		pointer-events: none;
	}
	/* Narrow screens: DETAILS becomes a right-side overlay so the canvas
	   keeps full width (drawer + canvas side-by-side crushes both at 390px). */
	@media (max-width: 900px) {
		.ed-main {
			display: block;
		}
		.ed-details {
			position: fixed;
			top: 0;
			right: 0;
			bottom: 0;
			z-index: 30;
			max-height: none;
			width: min(22rem, 92vw);
			box-shadow: -8px 0 24px rgb(0 0 0 / 0.25);
		}
	}
	.ed-focus :global(.admin-side),
	dialog {
		background: var(--bg);
		color: var(--ink);
		border: 1px solid var(--ink);
		padding: 1.25rem;
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.4);
	}
	dialog label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.75rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.8rem;
	}
	dialog input,
	dialog select {
		font: inherit;
		background: var(--bg);
		color: var(--ink);
		border: 1px solid var(--line);
		padding: 0.4rem 0.5rem;
	}
	dialog button {
		font-family: var(--font-mono, monospace);
		font-size: 0.8rem;
		margin-right: 0.5rem;
	}
</style>
