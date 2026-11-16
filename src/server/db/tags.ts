import { and, eq, inArray } from "drizzle-orm";
import type { Locale } from "../../config/site";
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
