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

// Post numbering (Phase 3, plan step 6): reverse-chronological index per
// locale over visible posts — the same ordering as the feed
// (publishedAt DESC, id ASC). No. 001 is the newest visible post
// (count of newer visible posts + 1); older posts count upward.
// Zero-padded 3 at the call site (String(n).padStart(3, "0")).
export async function getPostNo(
	db: Db,
	locale: Locale,
	// Kept for the plan's (publishedAt, id) cursor signature; ranking needs
	// only the id (same convention as admin.ts `_publishedAt`).
	_publishedAt: number | null,
	id: string,
	now: number = Date.now(),
): Promise<number> {
	// No. 001 is the newest visible post (rank-by-index over the feed
	// ordering); older posts count upward.
	const rows = await db
		.select({ id: posts.id })
		.from(posts)
		.where(and(eq(posts.locale, locale), visibilityFilter(now)))
		.orderBy(desc(posts.publishedAt), asc(posts.id));
	const index = rows.findIndex((row) => row.id === id);
	return index === -1 ? 1 : index + 1;
}

// Batched numbering for card lists (never a per-card N+1): one query
// returning id → number for the given post ids.
export async function getPostNos(
	db: Db,
	locale: Locale,
	ids: string[],
	now: number = Date.now(),
): Promise<Map<string, number>> {
	const result = new Map<string, number>();
	if (ids.length === 0) return result;
	const visible = await db
		.select({ id: posts.id, publishedAt: posts.publishedAt })
		.from(posts)
		.where(and(eq(posts.locale, locale), visibilityFilter(now)))
		.orderBy(desc(posts.publishedAt), asc(posts.id));
	visible.forEach((row, i) => {
		if (ids.includes(row.id)) result.set(row.id, i + 1);
	});
	return result;
}

// Adjacent posts for prev/next (spec §A4): same ordering as the feed.
// Returns { prev, next } nullable — prev is the older post, next the newer.
export async function getAdjacentPosts(
	db: Db,
	locale: Locale,
	// Same cursor-signature convention as getPostNo above.
	_publishedAt: number | null,
	id: string,
	now: number = Date.now(),
): Promise<{
	prev: {
		id: string;
		slug: string;
		title: string;
		coverMediaId: string | null;
	} | null;
	next: {
		id: string;
		slug: string;
		title: string;
		coverMediaId: string | null;
	} | null;
}> {
	const visible = await db
		.select({
			id: posts.id,
			slug: posts.slug,
			title: posts.title,
			coverMediaId: posts.coverMediaId,
			publishedAt: posts.publishedAt,
		})
		.from(posts)
		.where(and(eq(posts.locale, locale), visibilityFilter(now)))
		.orderBy(desc(posts.publishedAt), asc(posts.id));
	const index = visible.findIndex((row) => row.id === id);
	if (index === -1) return { prev: null, next: null };
	const prev = index + 1 < visible.length ? visible[index + 1] : undefined;
	const next = index - 1 >= 0 ? visible[index - 1] : undefined;
	return {
		prev:
			prev === undefined
				? null
				: {
						id: prev.id,
						slug: prev.slug,
						title: prev.title,
						coverMediaId: prev.coverMediaId,
					},
		next:
			next === undefined
				? null
				: {
						id: next.id,
						slug: next.slug,
						title: next.title,
						coverMediaId: next.coverMediaId,
					},
	};
}

export interface RelatedPost {
	id: string;
	slug: string;
	title: string;
	coverMediaId: string | null;
}

// Related posts (spec 06 §6.5): visible posts sharing ≥1 tag, self excluded,
// newest first (same ordering as the feed). Bound params only.
export async function getRelatedPosts(
	db: Db,
	options: {
		locale: Locale;
		postId: string;
		tagIds: string[];
		limit?: number;
	},
	now: number = Date.now(),
): Promise<RelatedPost[]> {
	const limit = Math.min(Math.max(options.limit ?? 3, 1), 3);
	if (options.tagIds.length === 0) return [];
	const tagged = await db
		.select({ postId: postTags.postId })
		.from(postTags)
		.where(inArray(postTags.tagId, options.tagIds));
	const ids = [...new Set(tagged.map((r) => r.postId))].filter(
		(id) => id !== options.postId,
	);
	if (ids.length === 0) return [];
	const rows = await db
		.select({
			id: posts.id,
			slug: posts.slug,
			title: posts.title,
			coverMediaId: posts.coverMediaId,
		})
		.from(posts)
		.where(
			and(
				eq(posts.locale, options.locale),
				visibilityFilter(now),
				inArray(posts.id, ids),
			),
		)
		.orderBy(desc(posts.publishedAt), asc(posts.id))
		.limit(limit);
	return rows;
}
