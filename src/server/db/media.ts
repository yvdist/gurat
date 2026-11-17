import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { media, type Media } from "./schema";

// Public media reads (cover slot). Visibility rule does not apply: covers
// render only for posts that already passed the visibility filter.
export async function getMediaById(db: Db, id: string): Promise<Media | null> {
	const rows = await db.select().from(media).where(eq(media.id, id));
	return rows[0] ?? null;
}
