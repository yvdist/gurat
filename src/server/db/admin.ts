import { and, desc, eq, inArray } from "drizzle-orm";
import type { Locale } from "../../config/site";
import type { Db } from "./client";
import type { Post, Tag } from "./schema";
import { postMedia, posts, postTags, tags } from "./schema";
// Admin write path (spec 04 §4.4). All mutations run in a single Drizzle
// transaction per call; timestamps are server-side `Date.now()`, never
// client-supplied. Reads here are by-id any-status (admin-only); public code
// keeps using visibility-filtered getters — no other file writes
// post-visibility SQL.

export class ConcurrencyError extends Error {
	constructor() {
		super("Post was modified by another session");
		this.name = "ConcurrencyError";
	}
}

export class SlugConflictError extends Error {
	constructor() {
		super("Slug is already in use for this locale");
		this.name = "SlugConflictError";
	}
}

export class PublishValidationError extends Error {
	readonly field: string;

	constructor(field: string) {
		super(`Cannot publish: ${field} is required`);
		this.name = "PublishValidationError";
		this.field = field;
	}
}

export class TagInUseError extends Error {
	readonly useCount: number;

	constructor(useCount: number) {
		super(`Tag is used by ${useCount} post(s)`);
		this.name = "TagInUseError";
		this.useCount = useCount;
	}
}

export class NotFoundError extends Error {
	constructor(what: string) {
		super(`${what} not found`);
		this.name = "NotFoundError";
	}
}

export interface NewPostInput {
	locale: Locale;
	slug: string;
	title: string;
	excerpt?: string;
	contentJson: string;
	/** Pre-rendered on the save path; stored verbatim on create. */
	contentHtml?: string;
	tocJson?: string;
	readingMinutes?: number;
	seoDescription?: string | null;
	translationGroupId?: string | null;
	tagIds?: string[];
	coverMediaId?: string | null;
	/** Full post_media id set (figures ∪ cover); inserted in the same batch. */
	mediaIds?: string[];
}

export interface SavePostPatch {
	locale?: Locale;
	slug?: string;
	title?: string;
	excerpt?: string;
	contentJson?: string;
	/** Pre-rendered on the save path; stored verbatim when supplied. */
	contentHtml?: string;
	tocJson?: string;
	readingMinutes?: number;
	translationGroupId?: string | null;
	tagIds?: string[];
	coverMediaId?: string | null;
	/** Full post_media id set; when defined, replaces existing links in-batch. */
	mediaIds?: string[];
	seoDescription?: string | null;
}

export interface AdminPost extends Post {
	tags: Tag[];
}

function isUniqueViolation(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return (
		msg.includes("UNIQUE constraint failed") ||
		msg.includes("unique") ||
		// D1 / SQLite error text for UNIQUE violations.
		msg.includes("SQLITE_CONSTRAINT_UNIQUE")
	);
}

function toAdminPost(row: Post, tagRows: Tag[]): AdminPost {
	return { ...row, tags: tagRows };
}

async function tagsForPost(db: Db, postId: string): Promise<Tag[]> {
	const links = await db
		.select()
		.from(postTags)
		.where(eq(postTags.postId, postId));
	if (links.length === 0) return [];
	const rows = await db
		.select()
		.from(tags)
		.where(
			inArray(
				tags.id,
				links.map((l) => l.tagId),
			),
		);
	// Preserve link order for stable output.
	const byId = new Map(rows.map((t) => [t.id, t]));
	return links
		.map((l) => byId.get(l.tagId))
		.filter((t): t is Tag => t !== undefined);
}

function checkSlugAvailable(rows: Post[], id: string, locale: Locale): void {
	if (rows.some((r) => r.locale === locale && r.id !== id)) {
		throw new SlugConflictError();
	}
}

export async function createPost(
	db: Db,
	input: NewPostInput,
): Promise<AdminPost> {
	const now = Date.now();
	const id = crypto.randomUUID();
	const row: Post = {
		id,
		locale: input.locale,
		translationGroupId: input.translationGroupId ?? null,
		slug: input.slug,
		title: input.title,
		excerpt: input.excerpt ?? "",
		status: "draft",
		publishedAt: null,
		contentJson: input.contentJson,
		contentHtml: input.contentHtml ?? "",
		tocJson: input.tocJson ?? "[]",
		readingMinutes: input.readingMinutes ?? 1,
		coverMediaId: input.coverMediaId ?? null,
		seoDescription: input.seoDescription ?? null,
		ogImageKey: null,
		createdAt: now,
		updatedAt: now,
	};
	// Pre-check for a friendly 409; the UNIQUE(locale, slug) index is the
	// backstop (mapped below) under races.
	const existing = await db
		.select()
		.from(posts)
		.where(eq(posts.slug, input.slug));
	checkSlugAvailable(existing, id, input.locale);
	try {
		// `db.batch` (D1-native) instead of BEGIN/COMMIT: the workerd test
		// isolate rejects interactive transactions.
		await db.batch([
			db.insert(posts).values(row),
			...(input.tagIds && input.tagIds.length > 0
				? [
						db
							.insert(postTags)
							.values(input.tagIds.map((tagId) => ({ postId: id, tagId }))),
					]
				: []),
			...(input.mediaIds && input.mediaIds.length > 0
				? [
						db
							.insert(postMedia)
							.values(
								input.mediaIds.map((mediaId) => ({ postId: id, mediaId })),
							),
					]
				: []),
		]);
	} catch (err) {
		if (isUniqueViolation(err)) throw new SlugConflictError();
		throw err;
	}
	return toAdminPost(row, await tagsForPost(db, id));
}

/** Admin-only by-id fetch (any status). Public code uses visibility-filtered getters. */
export async function getPostById(db: Db, id: string): Promise<AdminPost> {
	const rows = await db.select().from(posts).where(eq(posts.id, id));
	const row = rows[0];
	if (!row) throw new NotFoundError("Post");
	return toAdminPost(row, await tagsForPost(db, id));
}

export async function savePost(
	db: Db,
	id: string,
	patch: SavePostPatch,
	expectedUpdatedAt: number,
): Promise<AdminPost> {
	const rows = await db.select().from(posts).where(eq(posts.id, id));
	const current = rows[0];
	if (!current) throw new NotFoundError("Post");
	if (current.updatedAt !== expectedUpdatedAt) throw new ConcurrencyError();

	if (patch.slug !== undefined && patch.slug !== current.slug) {
		const locale = patch.locale ?? (current.locale as Locale);
		const clash = await db
			.select()
			.from(posts)
			.where(eq(posts.slug, patch.slug));
		checkSlugAvailable(clash, id, locale);
	}

	const now = Date.now();
	const next: Post = {
		...current,
		locale: patch.locale ?? current.locale,
		slug: patch.slug ?? current.slug,
		title: patch.title ?? current.title,
		excerpt: patch.excerpt ?? current.excerpt,
		contentJson: patch.contentJson ?? current.contentJson,
		contentHtml: patch.contentHtml ?? current.contentHtml,
		tocJson: patch.tocJson ?? current.tocJson,
		readingMinutes: patch.readingMinutes ?? current.readingMinutes,
		coverMediaId:
			patch.coverMediaId === undefined
				? current.coverMediaId
				: patch.coverMediaId,
		seoDescription:
			patch.seoDescription === undefined
				? current.seoDescription
				: patch.seoDescription,
		translationGroupId:
			patch.translationGroupId === undefined
				? current.translationGroupId
				: patch.translationGroupId,
		updatedAt: now,
	};
	try {
		await db.batch([
			db.update(posts).set(next).where(eq(posts.id, id)),
			...(patch.tagIds !== undefined
				? [
						db.delete(postTags).where(eq(postTags.postId, id)),
						...(patch.tagIds.length > 0
							? [
									db
										.insert(postTags)
										.values(
											patch.tagIds.map((tagId) => ({ postId: id, tagId })),
										),
								]
							: []),
					]
				: []),
			// Media sync: when the save resolved a fresh id set, replace links.
			...(patch.mediaIds !== undefined
				? [
						db.delete(postMedia).where(eq(postMedia.postId, id)),
						...(patch.mediaIds.length > 0
							? [
									db.insert(postMedia).values(
										patch.mediaIds.map((mediaId) => ({
											postId: id,
											mediaId,
										})),
									),
								]
							: []),
					]
				: []),
		]);
	} catch (err) {
		if (isUniqueViolation(err)) throw new SlugConflictError();
		throw err;
	}
	return toAdminPost(next, await tagsForPost(db, id));
}

export async function publishPost(
	db: Db,
	id: string,
	publishedAt?: number,
): Promise<AdminPost> {
	const rows = await db.select().from(posts).where(eq(posts.id, id));
	const current = rows[0];
	if (!current) throw new NotFoundError("Post");
	// Cheap repo-level re-check (the route validates fully: non-empty
	// title/slug and `validateDoc`-parsed content with ≥ 1 block).
	if (!current.title.trim()) throw new PublishValidationError("title");
	if (!current.slug.trim()) throw new PublishValidationError("slug");
	const now = Date.now();
	const next: Post = {
		...current,
		status: "published",
		publishedAt: publishedAt ?? current.publishedAt ?? now,
		updatedAt: now,
	};
	await db.update(posts).set(next).where(eq(posts.id, id));
	return toAdminPost(next, await tagsForPost(db, id));
}

export async function unpublishPost(db: Db, id: string): Promise<AdminPost> {
	const rows = await db.select().from(posts).where(eq(posts.id, id));
	const current = rows[0];
	if (!current) throw new NotFoundError("Post");
	// `publishedAt` history is retained; invisibility comes from status alone.
	const next: Post = { ...current, status: "draft", updatedAt: Date.now() };
	await db.update(posts).set(next).where(eq(posts.id, id));
	return toAdminPost(next, await tagsForPost(db, id));
}

export async function deletePost(db: Db, id: string): Promise<void> {
	const rows = await db
		.select({ id: posts.id })
		.from(posts)
		.where(eq(posts.id, id));
	if (rows.length === 0) throw new NotFoundError("Post");
	await db.batch([
		db.delete(postMedia).where(eq(postMedia.postId, id)),
		db.delete(postTags).where(eq(postTags.postId, id)),
		db.delete(posts).where(eq(posts.id, id)),
	]);
}

export interface AdminListOptions {
	status?: "draft" | "published";
	locale?: Locale;
	tagId?: string;
	q?: string;
	limit?: number;
}

const ADMIN_LIST_LIMIT = 200;

/** Posts table backing (admin-only): `updatedAt DESC`, no cursor needed. */
export async function listAdminPosts(
	db: Db,
	options: AdminListOptions = {},
): Promise<AdminPost[]> {
	const filters = [];
	if (options.status) filters.push(eq(posts.status, options.status));
	if (options.locale) filters.push(eq(posts.locale, options.locale));
	let candidates = await db
		.select()
		.from(posts)
		.where(filters.length > 0 ? and(...filters) : undefined)
		.orderBy(desc(posts.updatedAt))
		.limit(
			Math.min(
				Math.max(options.limit ?? ADMIN_LIST_LIMIT, 1),
				ADMIN_LIST_LIMIT,
			),
		);
	if (options.tagId) {
		const links = await db
			.select()
			.from(postTags)
			.where(eq(postTags.tagId, options.tagId));
		const ids = new Set(links.map((l) => l.postId));
		candidates = candidates.filter((p) => ids.has(p.id));
	}
	if (options.q) {
		const needle = options.q.toLowerCase();
		candidates = candidates.filter(
			(p) =>
				p.title.toLowerCase().includes(needle) ||
				p.slug.toLowerCase().includes(needle),
		);
	}
	const out: AdminPost[] = [];
	for (const row of candidates) {
		out.push(toAdminPost(row, await tagsForPost(db, row.id)));
	}
	return out;
}
