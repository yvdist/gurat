CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`r2_key_prefix` text NOT NULL,
	`mime` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`bytes` integer NOT NULL,
	`alt_default` text DEFAULT '' NOT NULL,
	`dominant_color` text,
	`variants_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_r2_key_prefix_unique` ON `media` (`r2_key_prefix`);--> statement-breakpoint
CREATE TABLE `post_media` (
	`post_id` text NOT NULL,
	`media_id` text NOT NULL,
	PRIMARY KEY(`post_id`, `media_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `post_tags` (
	`post_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`post_id`, `tag_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`locale` text NOT NULL,
	`translation_group_id` text,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`excerpt` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` integer,
	`content_json` text NOT NULL,
	`content_html` text DEFAULT '' NOT NULL,
	`toc_json` text DEFAULT '[]' NOT NULL,
	`reading_minutes` integer DEFAULT 1 NOT NULL,
	`cover_media_id` text,
	`seo_description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`cover_media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "posts_locale_check" CHECK("posts"."locale" IN ('en','id')),
	CONSTRAINT "posts_status_check" CHECK("posts"."status" IN ('draft','published'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posts_locale_slug_unique` ON `posts` (`locale`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `posts_translation_unique` ON `posts` (`translation_group_id`,`locale`) WHERE "posts"."translation_group_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `posts_feed_idx` ON `posts` (`locale`,`status`,`published_at`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`label_en` text NOT NULL,
	`label_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_slug_unique` ON `tags` (`slug`);