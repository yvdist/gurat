import { eq, sql } from "drizzle-orm";
import type { Locale } from "../../config/site";
import { renderDoc } from "../../lib/content/render";
import { validateDoc } from "../../lib/content/schema";
import type { Db } from "../db/client";
import { visibilityFilter } from "../db/posts";
import { media, posts } from "../db/schema";

// Search index (spec 06 §6.6): FTS5 virtual table, raw SQL (drizzle-kit
// cannot model virtual tables, so no schema.ts entry — same bound-parameter
// discipline as everywhere else: values only ever ride `${}` bindings).
export interface FtsRow {
	postId: string;
	locale: Locale;
	title: string;
	excerpt: string;
	plainText: string;
}

const MAX_QUERY_CHARS = 100;
const MAX_TERMS = 10;
const MAX_TERM_CHARS = 30;
export const SEARCH_LIMIT = 20;

/**
 * User query → safe FTS5 conjunction. Each whitespace-separated term is
 * double-quote wrapped (neutralizing `"`, `*`, `AND`/`OR`/`NOT`, parens),
 * capped in length and count; over-long input truncates. Null = no terms.
 */
export function toMatchQuery(q: string): string | null {
	const terms = q
		.trim()
		.slice(0, MAX_QUERY_CHARS)
		.split(/\s+/)
		.map((t) => t.replaceAll('"', "").slice(0, MAX_TERM_CHARS))
		.filter((t) => t.length > 0)
		.slice(0, MAX_TERMS);
	if (terms.length === 0) return null;
	return terms.map((t) => `"${t}"`).join(" ");
}

export async function upsertPostFts(db: Db, row: FtsRow): Promise<void> {
	await db.run(sql`DELETE FROM posts_fts WHERE post_id = ${row.postId}`);
	await db.run(
		sql`INSERT INTO posts_fts (title, excerpt, plain_text, locale, post_id) VALUES (${row.title}, ${row.excerpt}, ${row.plainText}, ${row.locale}, ${row.postId})`,
	);
}

export async function deletePostFts(db: Db, postId: string): Promise<void> {
	await db.run(sql`DELETE FROM posts_fts WHERE post_id = ${postId}`);
}

/** Full rebuild (rerender backfill). Caller batches; DELETE then INSERTs. */
export async function clearPostFts(db: Db): Promise<void> {
	await db.run(sql`DELETE FROM posts_fts`);
}

/** Render stored contentJson to plain text (publish path without fresh render). */
async function renderStoredPlainText(
	db: Db,
	contentJson: string,
	locale: Locale,
	baseUrl: string,
): Promise<string> {
	try {
		const parsed: unknown = JSON.parse(contentJson);
		const doc = validateDoc(parsed);
		if (doc === null) return "";
		const mediaRows = await db.select().from(media);
		const rendered = renderDoc(doc, {
			locale,
			media: new Map(mediaRows.map((m) => [m.id, m])),
			baseUrl,
		});
		return rendered.plainText;
	} catch {
		return "";
	}
}

export interface SyncPostFtsInput {
	id: string;
	locale: Locale;
	title: string;
	excerpt: string;
	status: string;
	plainText?: string;
	contentJson?: string;
	baseUrl?: string;
}

/**
 * Keep the FTS row consistent with a saved/published/unpublished/deleted
 * post. Rows exist for `status = 'published'` posts only (any published_at —
 * the query applies the visibility rule); everything else deletes the row.
 * `plainText` rides along when the caller just rendered (create/save);
 * otherwise the stored contentJson is re-rendered (publish) or the row is
 * left title/excerpt-only when nothing renderable exists.
 */
export async function syncPostFts(
	db: Db,
	input: SyncPostFtsInput,
): Promise<void> {
	if (input.status !== "published") {
		await deletePostFts(db, input.id);
		return;
	}
	let plainText = input.plainText;
	if (plainText === undefined) {
		if (input.contentJson !== undefined) {
			plainText = await renderStoredPlainText(
				db,
				input.contentJson,
				input.locale,
				input.baseUrl ?? "",
			);
		} else {
			const existing = await db.all<{ plain_text: string }>(
				sql`SELECT plain_text FROM posts_fts WHERE post_id = ${input.id} LIMIT 1`,
			);
			plainText = existing[0]?.plain_text ?? "";
		}
	}
	await upsertPostFts(db, {
		postId: input.id,
		locale: input.locale,
		title: input.title,
		excerpt: input.excerpt,
		plainText,
	});
}

export interface SearchHit {
	id: string;
	slug: string;
	title: string;
	excerpt: string;
	publishedAt: number | null;
}

/**
 * Ranked full-text search over public posts. The posts join re-applies the
 * visibility rule at query time (same predicate as `visibilityFilter`) so
 * scheduled posts never leak even if sync raced them.
 */
export async function searchPosts(
	db: Db,
	input: { locale: Locale; match: string; now: number; limit?: number },
): Promise<SearchHit[]> {
	const limit = Math.min(
		Math.max(input.limit ?? SEARCH_LIMIT, 1),
		SEARCH_LIMIT,
	);
	const rows = await db.all<{
		id: string;
		slug: string;
		title: string;
		excerpt: string;
		published_at: number | null;
	}>(sql`
		SELECT posts.id AS id, posts.slug AS slug, posts.title AS title, posts.excerpt AS excerpt, posts.published_at AS published_at
		FROM posts_fts JOIN posts ON posts.id = posts_fts.post_id
		WHERE posts_fts MATCH ${input.match}
		AND ${eq(posts.locale, input.locale)}
		AND ${visibilityFilter(input.now)}
		ORDER BY posts.published_at DESC, posts.id ASC
		LIMIT ${limit}`);
	return rows.map((r) => ({
		id: r.id,
		slug: r.slug,
		title: r.title,
		excerpt: r.excerpt,
		publishedAt: r.published_at,
	}));
}
