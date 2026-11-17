import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Mirrors spec 01 §1.3 SQL exactly. Table creation order: media, tags, posts,
// post_tags, post_media. All timestamps are UTC epoch milliseconds (INTEGER).
// content_html / toc_json are Phase 2-owned (db:rerender); stored verbatim here.

export const media = sqliteTable("media", {
	id: text("id").primaryKey(),
	r2KeyPrefix: text("r2_key_prefix").notNull().unique(),
	mime: text("mime").notNull(),
	width: integer("width").notNull(),
	height: integer("height").notNull(),
	bytes: integer("bytes").notNull(),
	altDefault: text("alt_default").notNull().default(""),
	dominantColor: text("dominant_color"),
	variantsJson: text("variants_json").notNull().default("[]"),
	createdAt: integer("created_at").notNull(),
});

export const tags = sqliteTable("tags", {
	id: text("id").primaryKey(),
	slug: text("slug").notNull().unique(),
	labelEn: text("label_en").notNull(),
	labelId: text("label_id").notNull(),
});

export const posts = sqliteTable(
	"posts",
	{
		id: text("id").primaryKey(),
		locale: text("locale").notNull(),
		translationGroupId: text("translation_group_id"),
		slug: text("slug").notNull(),
		title: text("title").notNull(),
		excerpt: text("excerpt").notNull().default(""),
		status: text("status").notNull().default("draft"),
		publishedAt: integer("published_at"),
		contentJson: text("content_json").notNull(),
		contentHtml: text("content_html").notNull().default(""),
		tocJson: text("toc_json").notNull().default("[]"),
		readingMinutes: integer("reading_minutes").notNull().default(1),
		coverMediaId: text("cover_media_id").references(() => media.id, {
			onDelete: "set null",
		}),
		seoDescription: text("seo_description"),
		// Phase 6: client-generated share image key (`og/<postId>.png` in the
		// media bucket). Null = fall back to the static og-default.png.
		ogImageKey: text("og_image_key"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(t) => [
		check("posts_locale_check", sql`${t.locale} IN ('en','id')`),
		check("posts_status_check", sql`${t.status} IN ('draft','published')`),
		uniqueIndex("posts_locale_slug_unique").on(t.locale, t.slug),
		uniqueIndex("posts_translation_unique")
			.on(t.translationGroupId, t.locale)
			.where(sql`${t.translationGroupId} IS NOT NULL`),
		index("posts_feed_idx").on(t.locale, t.status, t.publishedAt),
	],
);

export const postTags = sqliteTable(
	"post_tags",
	{
		postId: text("post_id")
			.notNull()
			.references(() => posts.id, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }),
	},
	(t) => [primaryKey({ columns: [t.postId, t.tagId] })],
);

export const postMedia = sqliteTable(
	"post_media",
	{
		postId: text("post_id")
			.notNull()
			.references(() => posts.id, { onDelete: "cascade" }),
		mediaId: text("media_id")
			.notNull()
			.references(() => media.id, { onDelete: "restrict" }),
	},
	(t) => [primaryKey({ columns: [t.postId, t.mediaId] })],
);

export type Media = typeof media.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type PostTag = typeof postTags.$inferSelect;
export type PostMedia = typeof postMedia.$inferSelect;
