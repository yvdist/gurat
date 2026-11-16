import { and, asc, desc, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Locale } from "../../config/site";
import type { Db } from "./client";
import type { Post, Tag } from "./schema";
import { posts, postTags, tags } from "./schema";

// Visibility rule — the single source of truth for public queries:
// a post is public iff status = 'published' AND published_at <= now.
// Scheduled publishing falls out for free (future published_at is invisible).
// No caller outside src/server/db/ writes post-visibility SQL.
export function visibilityFilter(now: number) {
	return and(
		eq(posts.status, "published"),
		sql`${posts.publishedAt} <= ${now}`,
	);
}

export interface PublishedPost extends Post {
	tags: Tag[];
}

export interface PostWithTags extends Post {
	tags: Tag[];
	alternates: { locale: Locale; slug: string }[];
}

const cursorPayloadSchema = z.object({
	publishedAt: z.number(),
	id: z.string(),
});

type CursorPayload = z.infer<typeof cursorPayloadSchema>;

function encodeCursor(payload: CursorPayload): string {
	const bytes = new TextEncoder().encode(JSON.stringify(payload));
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

function decodeCursor(cursor: string): CursorPayload | null {
	try {
		const padded = cursor.replaceAll("-", "+").replaceAll("_", "/");
		const bin = atob(padded);
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
		const result = cursorPayloadSchema.safeParse(parsed);
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}

export interface ListPostsOptions {
	locale: Locale;
	tagSlug?: string;
	limit?: number;
	cursor?: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function clampLimit(limit?: number): number {
	if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
	return Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
}

async function tagsForPosts(
	db: Db,
	postIds: string[],
): Promise<Map<string, Tag[]>> {
	if (postIds.length === 0) return new Map();
	const rows = await db
		.select({ postId: postTags.postId, tag: tags })
		.from(postTags)
		.innerJoin(tags, eq(postTags.tagId, tags.id))
		.where(inArray(postTags.postId, postIds));
	const byPost = new Map<string, Tag[]>();
	for (const row of rows) {
		const list = byPost.get(row.postId) ?? [];
		list.push(row.tag);
		byPost.set(row.postId, list);
	}
	return byPost;
}

export async function listPublishedPosts(
	db: Db,
	options: ListPostsOptions,
	now: number = Date.now(),
): Promise<{ items: PublishedPost[]; nextCursor: string | null }> {
	const limit = clampLimit(options.limit);
	const conditions = [eq(posts.locale, options.locale), visibilityFilter(now)];

	if (options.tagSlug !== undefined) {
		const tagRows = await db
			.select()
			.from(tags)
			.where(eq(tags.slug, options.tagSlug))
			.limit(1);
		const [tag] = tagRows;
		if (tag === undefined) return { items: [], nextCursor: null };
		const tagged = await db
			.select({ postId: postTags.postId })
			.from(postTags)
			.where(eq(postTags.tagId, tag.id));
		const ids = tagged.map((r) => r.postId);
		if (ids.length === 0) return { items: [], nextCursor: null };
		conditions.push(inArray(posts.id, ids));
	}

	if (options.cursor !== undefined) {
		const cursor = decodeCursor(options.cursor);
		if (cursor === null) throw new Error("Invalid pagination cursor");
		const cursorFilter = or(
			lt(posts.publishedAt, cursor.publishedAt),
			and(eq(posts.publishedAt, cursor.publishedAt), gt(posts.id, cursor.id)),
		);
		if (cursorFilter !== undefined) conditions.push(cursorFilter);
	}

	const rows = await db
		.select()
		.from(posts)
		.where(and(...conditions))
		.orderBy(desc(posts.publishedAt), asc(posts.id))
		.limit(limit + 1);

	const hasMore = rows.length > limit;
	const page = hasMore ? rows.slice(0, limit) : rows;
	const tagMap = await tagsForPosts(
		db,
		page.map((p) => p.id),
	);
	const items: PublishedPost[] = page.map((p) => ({
		...p,
		tags: tagMap.get(p.id) ?? [],
	}));
	const last = page[page.length - 1];
	const nextCursor =
		hasMore && last?.publishedAt != null
			? encodeCursor({ publishedAt: last.publishedAt, id: last.id })
			: null;
	return { items, nextCursor };
}

export async function getPublishedPostBySlug(
	db: Db,
	locale: Locale,
	slug: string,
	now: number = Date.now(),
): Promise<PostWithTags | null> {
	const rows = await db
		.select()
		.from(posts)
		.where(
			and(
				eq(posts.locale, locale),
				eq(posts.slug, slug),
				visibilityFilter(now),
			),
		)
		.limit(1);
	const post = rows[0];
	if (!post) return null;
	const tagMap = await tagsForPosts(db, [post.id]);
	const alternates = await getTranslations(
		db,
		post.translationGroupId,
		post.id,
		now,
	);
	return { ...post, tags: tagMap.get(post.id) ?? [], alternates };
}

// Published + visible translations sharing a group, excluding the source post.
export async function getTranslations(
	db: Db,
	groupId: string | null,
	excludePostId?: string,
	now: number = Date.now(),
): Promise<{ locale: Locale; slug: string }[]> {
	if (groupId === null) return [];
	const conditions = [
		eq(posts.translationGroupId, groupId),
		visibilityFilter(now),
	];
	if (excludePostId !== undefined) {
		conditions.push(ne(posts.id, excludePostId));
	}
	const rows = await db
		.select({ locale: posts.locale, slug: posts.slug })
		.from(posts)
		.where(and(...conditions));
	return rows.filter(
		(r): r is { locale: Locale; slug: string } =>
			r.locale === "en" || r.locale === "id",
	);
}
