import { and, eq, inArray } from "drizzle-orm";
import type { Locale } from "../../config/site";
import { NotFoundError, SlugConflictError, TagInUseError } from "./admin";
import type { Db } from "./client";
import { visibilityFilter } from "./posts";
import type { Tag } from "./schema";
import { posts, postTags, tags } from "./schema";
export interface TagWithCount extends Tag {
	postCount: number;
}

// Tag list for a locale; counts include only visible (published, not future) posts.
export async function listTags(
	db: Db,
	locale: Locale,
	now: number = Date.now(),
): Promise<TagWithCount[]> {
	const allTags = await db.select().from(tags);
	const visible = await db
		.select({ id: posts.id })
		.from(posts)
		.where(and(eq(posts.locale, locale), visibilityFilter(now)));
	if (visible.length === 0) {
		return allTags.map((t) => ({ ...t, postCount: 0 }));
	}
	const links = await db
		.select()
		.from(postTags)
		.where(
			inArray(
				postTags.postId,
				visible.map((p) => p.id),
			),
		);
	const counts = new Map<string, number>();
	for (const link of links) {
		counts.set(link.tagId, (counts.get(link.tagId) ?? 0) + 1);
	}
	return allTags.map((t) => ({ ...t, postCount: counts.get(t.id) ?? 0 }));
}

export interface NewTagInput {
	slug: string;
	labelEn: string;
	labelId: string;
}

export interface RenameTagPatch {
	slug?: string;
	labelEn?: string;
	labelId?: string;
}

// Tag CRUD for the admin surface. Slug uniqueness is enforced by the DB;
// violations surface as the shared `SlugConflictError` (409 at the API).
export async function createTag(db: Db, input: NewTagInput): Promise<Tag> {
	const clash = await db.select().from(tags).where(eq(tags.slug, input.slug));
	if (clash.length > 0) throw new SlugConflictError();
	const row: Tag = {
		id: crypto.randomUUID(),
		slug: input.slug,
		labelEn: input.labelEn,
		labelId: input.labelId,
	};
	try {
		await db.insert(tags).values(row);
	} catch {
		throw new SlugConflictError();
	}
	return row;
}

export async function renameTag(
	db: Db,
	id: string,
	patch: RenameTagPatch,
): Promise<Tag> {
	const rows = await db.select().from(tags).where(eq(tags.id, id));
	const current = rows[0];
	if (!current) throw new NotFoundError("Tag");
	if (patch.slug !== undefined && patch.slug !== current.slug) {
		const clash = await db.select().from(tags).where(eq(tags.slug, patch.slug));
		if (clash.some((t) => t.id !== id)) throw new SlugConflictError();
	}
	const next: Tag = {
		...current,
		slug: patch.slug ?? current.slug,
		labelEn: patch.labelEn ?? current.labelEn,
		labelId: patch.labelId ?? current.labelId,
	};
	try {
		await db.update(tags).set(next).where(eq(tags.id, id));
	} catch {
		throw new SlugConflictError();
	}
	return next;
}

/** Delete a tag. Blocked with `TagInUseError` when linked unless `confirm`. */
export async function deleteTag(
	db: Db,
	id: string,
	confirm = false,
): Promise<void> {
	const rows = await db
		.select({ id: tags.id })
		.from(tags)
		.where(eq(tags.id, id));
	if (rows.length === 0) throw new NotFoundError("Tag");
	const links = await db.select().from(postTags).where(eq(postTags.tagId, id));
	if (links.length > 0 && !confirm) throw new TagInUseError(links.length);
	if (links.length > 0) {
		await db.batch([
			db.delete(postTags).where(eq(postTags.tagId, id)),
			db.delete(tags).where(eq(tags.id, id)),
		]);
	} else {
		await db.delete(tags).where(eq(tags.id, id));
	}
}
