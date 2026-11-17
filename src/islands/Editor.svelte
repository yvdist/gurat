<script lang="ts">
import { Editor, Node } from "@tiptap/core";
import LinkExt from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import { onDestroy, onMount } from "svelte";
import "../styles/tokens.css";
import "../styles/article.css";
import "../styles/admin.css";
import { docToTiptap, tiptapToDoc } from "./editorDoc";

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
}

const {
	postId: initialPostId,
	initialDoc,
	initialUpdatedAt,
	locale,
	groupId: initialGroupId = null,
	candidates = [],
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

// Phase 5 owns media: insert is DISABLED (no toolbar button). Existing
// figure nodes render read-only and round-trip byte-identical.
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
					src: `/media/${attrs.mediaId ?? ""}/placeholder`,
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
	const body = {
		locale: fieldValue("meta-locale") || locale,
		slug: fieldValue("meta-slug"),
		title: fieldValue("meta-title"),
		excerpt: fieldValue("meta-excerpt"),
		seoDescription: fieldValue("meta-seo") || null,
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

onMount(() => {
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
</div>

<style>
	.focus-mode :global(.admin-side) {
		display: none;
	}
</style>
