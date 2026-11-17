import { inArray } from "drizzle-orm";
import { z } from "zod";
import type { Locale } from "../../config/site";
import { RenderError, renderDoc } from "../../lib/content/render";
import type { Doc } from "../../lib/content/schema";
import { validateDoc } from "../../lib/content/schema";
import type { AdminPost, Db, NewPostInput, SavePostPatch, Tag } from "../db";
import {
	ConcurrencyError,
	createPost,
	createTag,
	deletePost,
	deleteTag,
	getPostById,
	listAdminPosts,
	NotFoundError,
	PublishValidationError,
	publishPost,
	renameTag,
	SlugConflictError,
	savePost,
	TagInUseError,
	unpublishPost,
} from "../db";
import { postTags, tags } from "../db/schema";

// Shared admin service: thin Astro endpoints call these; tests call them
// directly (no HTTP layer). Every function returns a `ServiceResult` —
// routes map `ok` to 200 and `err` to the corresponding status code.

export type ServiceErrorCode =
	| "bad-request"
	| "schema"
	| "render"
	| "slug-conflict"
	| "concurrency"
	| "validation"
	| "tag-in-use"
	| "media-unavailable"
	| "media-in-use"
	| "too-large"
	| "too-many"
	| "bad-dimensions"
	| "width-mismatch"
	| "aspect-mismatch"
	| "not-found";

export interface ServiceError {
	code: ServiceErrorCode;
	status: number;
	/** Zod issue path for schema errors; extra detail otherwise. */
	detail?: string;
	currentUpdatedAt?: number;
}

export type ServiceResult<T> =
	| { ok: true; value: T }
	| { ok: false; err: ServiceError };

const LOCALES = ["en", "id"] as const;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const localeSchema = z.enum(LOCALES);
const slugSchema = z.string().regex(SLUG_RE).max(150);
const tagSlugSchema = z.string().regex(TAG_SLUG_RE).max(64);

const newPostSchema = z
	.object({
		locale: localeSchema,
		slug: slugSchema,
		title: z.string().min(1).max(300),
		excerpt: z.string().max(500).default(""),
		contentJson: z.string().min(1).max(200_000),
		seoDescription: z.string().max(320).nullable().optional(),
		translationGroupId: z.string().nullable().optional(),
		tagIds: z.array(z.string()).max(20).default([]),
		coverMediaId: z.string().nullable().optional(),
	})
	.strict();

const savePatchSchema = z
	.object({
		expectedUpdatedAt: z.number(),
		locale: localeSchema.optional(),
		slug: slugSchema.optional(),
		title: z.string().min(1).max(300).optional(),
		excerpt: z.string().max(500).optional(),
		contentJson: z.string().min(1).max(200_000).optional(),
		seoDescription: z.string().max(320).nullable().optional(),
		translationGroupId: z.string().nullable().optional(),
		tagIds: z.array(z.string()).max(20).optional(),
		coverMediaId: z.string().nullable().optional(),
	})
	.strict();

const newTagSchema = z
	.object({
		slug: tagSlugSchema,
		labelEn: z.string().min(1).max(120),
		labelId: z.string().min(1).max(120),
	})
	.strict();

const renameTagSchema = z
	.object({
		slug: tagSlugSchema.optional(),
		labelEn: z.string().min(1).max(120).optional(),
		labelId: z.string().min(1).max(120).optional(),
	})
	.strict();

export type NewPostBody = z.infer<typeof newPostSchema>;
export type SavePatchBody = z.infer<typeof savePatchSchema>;

function zodIssues(err: z.ZodError): string {
	const first = err.issues[0];
	if (!first) return "";
	return first.path.map(String).join(".");
}

function mapRepoError(err: unknown, currentUpdatedAt?: number): ServiceError {
	if (err instanceof SlugConflictError)
		return { code: "slug-conflict", status: 409 };
	if (err instanceof ConcurrencyError)
		return { code: "concurrency", status: 409, currentUpdatedAt };
	if (err instanceof PublishValidationError)
		return { code: "validation", status: 422, detail: err.field };
	if (err instanceof TagInUseError)
		return { code: "tag-in-use", status: 409, detail: String(err.useCount) };
	if (err instanceof NotFoundError) return { code: "not-found", status: 404 };
	throw err;
}

export interface RenderedContent {
	contentJson: string;
	contentHtml: string;
	tocJson: string;
	readingMinutes: number;
}

/**
 * Spec 04 §4.4 save flow: JSON.parse → validateDoc → renderDoc.
 * Phase 4 has no media rows: empty media map (unknown mediaIds fail loudly).
 */
export function renderContent(
	contentJson: string,
	locale: Locale,
): RenderedContent | ServiceError {
	let parsed: unknown;
	try {
		parsed = JSON.parse(contentJson);
	} catch {
		return { code: "schema", status: 422, detail: "" };
	}
	let doc: Doc;
	try {
		doc = validateDoc(parsed);
	} catch (err) {
		if (err instanceof z.ZodError)
			return { code: "schema", status: 422, detail: zodIssues(err) };
		throw err;
	}
	if (doc.content.length === 0)
		return { code: "schema", status: 422, detail: "content" };
	try {
		const rendered = renderDoc(doc, { locale, media: new Map(), baseUrl: "" });
		return {
			contentJson,
			contentHtml: rendered.html,
			tocJson: JSON.stringify(rendered.toc),
			readingMinutes: rendered.readingMinutes,
		};
	} catch (err) {
		if (err instanceof RenderError)
			return { code: "render", status: 422, detail: err.path };
		throw err;
	}
}

async function tagsExist(db: Db, tagIds: string[]): Promise<boolean> {
	if (tagIds.length === 0) return true;
	const rows = await db
		.select({ id: tags.id })
		.from(tags)
		.where(inArray(tags.id, tagIds));
	return rows.length === tagIds.length;
}

function checkCoverMedia(
	coverMediaId: string | null | undefined,
): ServiceError | null {
	// Phase 5 owns media rows: any non-null cover is rejected until then.
	if (coverMediaId !== undefined && coverMediaId !== null) {
		return { code: "media-unavailable", status: 422 };
	}
	return null;
}
export interface ListPostsQuery {
	status?: "draft" | "published";
	locale?: Locale;
	tagId?: string;
	q?: string;
	limit?: number;
}

const listQuerySchema = z
	.object({
		status: z.enum(["draft", "published"]).optional(),
		locale: localeSchema.optional(),
		tagId: z.string().optional(),
		q: z.string().max(200).optional(),
		limit: z.coerce.number().int().min(1).max(200).optional(),
	})
	.strict();

export function parseListQuery(
	params: URLSearchParams,
): ListPostsQuery | ServiceError {
	const parsed = listQuerySchema.safeParse(Object.fromEntries(params));
	if (!parsed.success)
		return {
			code: "bad-request",
			status: 400,
			detail: zodIssues(parsed.error),
		};
	return parsed.data;
}

export async function listPostsService(
	db: Db,
	query: ListPostsQuery,
): Promise<AdminPost[]> {
	return listAdminPosts(db, query);
}

export async function createPostService(
	db: Db,
	body: unknown,
): Promise<ServiceResult<AdminPost>> {
	const parsed = newPostSchema.safeParse(body);
	if (!parsed.success)
		return {
			ok: false,
			err: {
				code: "bad-request",
				status: 400,
				detail: zodIssues(parsed.error),
			},
		};
	const input = parsed.data;
	const mediaErr = checkCoverMedia(input.coverMediaId);
	if (mediaErr) return { ok: false, err: mediaErr };
	if (!(await tagsExist(db, input.tagIds)))
		return {
			ok: false,
			err: { code: "bad-request", status: 400, detail: "tagIds" },
		};
	const rendered = renderContent(input.contentJson, input.locale);
	if ("code" in rendered) return { ok: false, err: rendered };
	const repoInput: NewPostInput = {
		locale: input.locale,
		slug: input.slug,
		title: input.title,
		excerpt: input.excerpt,
		contentJson: rendered.contentJson,
		contentHtml: rendered.contentHtml,
		tocJson: rendered.tocJson,
		readingMinutes: rendered.readingMinutes,
		seoDescription: input.seoDescription,
		translationGroupId: input.translationGroupId,
		tagIds: input.tagIds,
		coverMediaId: input.coverMediaId ?? null,
	};
	try {
		return { ok: true, value: await createPost(db, repoInput) };
	} catch (err) {
		return { ok: false, err: mapRepoError(err) };
	}
}

export async function savePostService(
	db: Db,
	id: string,
	body: unknown,
): Promise<ServiceResult<AdminPost>> {
	const parsed = savePatchSchema.safeParse(body);
	if (!parsed.success)
		return {
			ok: false,
			err: {
				code: "bad-request",
				status: 400,
				detail: zodIssues(parsed.error),
			},
		};
	const { expectedUpdatedAt, ...patch } = parsed.data;
	const mediaErr = checkCoverMedia(patch.coverMediaId);
	if (mediaErr) return { ok: false, err: mediaErr };
	if (patch.tagIds !== undefined && !(await tagsExist(db, patch.tagIds)))
		return {
			ok: false,
			err: { code: "bad-request", status: 400, detail: "tagIds" },
		};
	let rendered: RenderedContent | undefined;
	if (patch.contentJson !== undefined) {
		let current: AdminPost;
		try {
			current = await getPostById(db, id);
		} catch (err) {
			return { ok: false, err: mapRepoError(err) };
		}
		const locale = patch.locale ?? (current.locale as Locale);
		const r = renderContent(patch.contentJson, locale);
		if ("code" in r) return { ok: false, err: r };
		rendered = r;
	}
	const repoPatch: SavePostPatch = {
		...patch,
		...(rendered
			? {
					contentJson: rendered.contentJson,
					contentHtml: rendered.contentHtml,
					tocJson: rendered.tocJson,
					readingMinutes: rendered.readingMinutes,
				}
			: {}),
	};
	try {
		return {
			ok: true,
			value: await savePost(db, id, repoPatch, expectedUpdatedAt),
		};
	} catch (err) {
		if (err instanceof ConcurrencyError) {
			// Report the live stamp so the UI can offer reload/overwrite.
			const live = await getPostById(db, id).catch(() => null);
			return {
				ok: false,
				err: mapRepoError(err, live?.updatedAt),
			};
		}
		return { ok: false, err: mapRepoError(err) };
	}
}

const publishBodySchema = z
	.object({
		publishedAt: z.number().optional(),
		contentJson: z.string().min(1).max(200_000).optional(),
		expectedUpdatedAt: z.number().optional(),
	})
	.strict();

export async function publishPostService(
	db: Db,
	id: string,
	body: unknown,
): Promise<ServiceResult<AdminPost>> {
	const parsed = publishBodySchema.safeParse(body);
	if (!parsed.success)
		return {
			ok: false,
			err: {
				code: "bad-request",
				status: 400,
				detail: zodIssues(parsed.error),
			},
		};
	// Dirty-editor single click: save first so stale HTML never publishes.
	if (
		parsed.data.contentJson !== undefined &&
		parsed.data.expectedUpdatedAt !== undefined
	) {
		const saved = await savePostService(db, id, {
			contentJson: parsed.data.contentJson,
			expectedUpdatedAt: parsed.data.expectedUpdatedAt,
		});
		if (!saved.ok) return saved;
	}
	try {
		return {
			ok: true,
			value: await publishPost(db, id, parsed.data.publishedAt),
		};
	} catch (err) {
		return { ok: false, err: mapRepoError(err) };
	}
}

export async function unpublishPostService(
	db: Db,
	id: string,
): Promise<ServiceResult<AdminPost>> {
	try {
		return { ok: true, value: await unpublishPost(db, id) };
	} catch (err) {
		return { ok: false, err: mapRepoError(err) };
	}
}

export async function deletePostService(
	db: Db,
	id: string,
): Promise<ServiceResult<null>> {
	try {
		await deletePost(db, id);
		return { ok: true, value: null };
	} catch (err) {
		return { ok: false, err: mapRepoError(err) };
	}
}

export async function createTagService(
	db: Db,
	body: unknown,
): Promise<ServiceResult<Tag>> {
	const parsed = newTagSchema.safeParse(body);
	if (!parsed.success)
		return {
			ok: false,
			err: {
				code: "bad-request",
				status: 400,
				detail: zodIssues(parsed.error),
			},
		};
	try {
		return { ok: true, value: await createTag(db, parsed.data) };
	} catch (err) {
		return { ok: false, err: mapRepoError(err) };
	}
}

export async function renameTagService(
	db: Db,
	id: string,
	body: unknown,
): Promise<ServiceResult<Tag>> {
	const parsed = renameTagSchema.safeParse(body);
	if (!parsed.success)
		return {
			ok: false,
			err: {
				code: "bad-request",
				status: 400,
				detail: zodIssues(parsed.error),
			},
		};
	try {
		return { ok: true, value: await renameTag(db, id, parsed.data) };
	} catch (err) {
		return { ok: false, err: mapRepoError(err) };
	}
}

export async function deleteTagService(
	db: Db,
	id: string,
	body: unknown,
): Promise<ServiceResult<null>> {
	const parsed = z
		.object({ confirm: z.boolean().optional() })
		.strict()
		.safeParse(body ?? {});
	if (!parsed.success)
		return { ok: false, err: { code: "bad-request", status: 400 } };
	try {
		await deleteTag(db, id, parsed.data.confirm ?? false);
		return { ok: true, value: null };
	} catch (err) {
		return { ok: false, err: mapRepoError(err) };
	}
}

/** All tags with total (any-status) post counts, for the admin tags page. */
export async function listAllTagsService(
	db: Db,
): Promise<(Tag & { useCount: number })[]> {
	const allTags = await db.select().from(tags);
	const links = await db.select().from(postTags);
	const counts = new Map<string, number>();
	for (const link of links) {
		counts.set(link.tagId, (counts.get(link.tagId) ?? 0) + 1);
	}
	return allTags.map((t) => ({ ...t, useCount: counts.get(t.id) ?? 0 }));
}
