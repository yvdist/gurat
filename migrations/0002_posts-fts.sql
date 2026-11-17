-- Phase 6 search index (spec 06 §6.6). FTS5 virtual table kept in sync on
-- save/publish/unpublish/delete; rows exist for status='published' posts
-- (any published_at — the search route applies the visibility rule at query
-- time so scheduled posts never leak and need no cron to appear).
-- `post_id` is UNINDEXED: stored for the join-back, never full-text matched.
CREATE VIRTUAL TABLE `posts_fts` USING fts5(`title`, `excerpt`, `plain_text`, `locale`, `post_id` UNINDEXED);
