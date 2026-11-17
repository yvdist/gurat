import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
	getPublishedPostBySlug,
	getTranslations,
	listPublishedPosts,
	listTags,
} from "../src/server/db";
import { createDb } from "../src/server/db/client";
import { posts, postTags, tags } from "../src/server/db/schema";

const DAY = 86_400_000;
const NOW = 1_769_000_000_000;

function doc(title: string): string {
	return JSON.stringify({
		type: "doc",
		content: [
			{
				type: "heading",
				attrs: { level: 1 },
				content: [{ type: "text", text: title }],
			},
			{ type: "paragraph", content: [{ type: "text", text: "Body." }] },
		],
	});
}

// Fresh fixture per test: wipes all tables (FK order), inserts a fixed set.
// Timestamps are fixed (NOW) so visibility assertions are deterministic.
async function fixture() {
	const db = createDb(env.DB);
	await db.delete(postTags);
	await db.delete(posts);
	await db.delete(tags);

	await db.insert(tags).values([
		{ id: "t-essays", slug: "essays", labelEn: "Essays", labelId: "Esai" },
		{ id: "t-notes", slug: "notes", labelEn: "Notes", labelId: "Catatan" },
	]);
	await db.insert(posts).values([
		{
			id: "p-en-1",
			locale: "en",
			translationGroupId: "g-1",
			slug: "first",
			title: "First",
			status: "published",
			publishedAt: NOW - 3 * DAY,
			contentJson: doc("First"),
			createdAt: NOW - 3 * DAY,
			updatedAt: NOW - 3 * DAY,
		},
		{
			id: "p-id-1",
			locale: "id",
			translationGroupId: "g-1",
			slug: "pertama",
			title: "Pertama",
			status: "published",
			publishedAt: NOW - 3 * DAY,
			contentJson: doc("Pertama"),
			createdAt: NOW - 3 * DAY,
			updatedAt: NOW - 3 * DAY,
		},
		{
			id: "p-en-2",
			locale: "en",
			translationGroupId: null,
			slug: "second",
			title: "Second",
			status: "published",
			publishedAt: NOW - 1 * DAY,
			contentJson: doc("Second"),
			createdAt: NOW - 1 * DAY,
			updatedAt: NOW - 1 * DAY,
		},
		{
			id: "p-en-draft",
			locale: "en",
			translationGroupId: null,
			slug: "draft",
			title: "Draft",
			status: "draft",
			publishedAt: null,
			contentJson: doc("Draft"),
			createdAt: NOW - 1 * DAY,
			updatedAt: NOW - 1 * DAY,
		},
		{
			id: "p-en-future",
			locale: "en",
			translationGroupId: null,
			slug: "future",
			title: "Future",
			status: "published",
			publishedAt: NOW + 7 * DAY,
			contentJson: doc("Future"),
			createdAt: NOW - 1 * DAY,
			updatedAt: NOW - 1 * DAY,
		},
	]);
	await db.insert(postTags).values([
		{ postId: "p-en-1", tagId: "t-essays" },
		{ postId: "p-en-2", tagId: "t-essays" },
		{ postId: "p-en-2", tagId: "t-notes" },
		{ postId: "p-en-draft", tagId: "t-notes" },
		{ postId: "p-en-future", tagId: "t-notes" },
	]);
	return db;
}

describe("public repositories (real local D1)", () => {
	beforeEach(async () => {
		await fixture();
	});

	it("excludes drafts and future-dated posts from all public queries", async () => {
		const db = createDb(env.DB);
		const { items } = await listPublishedPosts(db, { locale: "en" }, NOW);
		expect(items.map((p) => p.slug).sort()).toEqual(["first", "second"]);

		expect(await getPublishedPostBySlug(db, "en", "draft", NOW)).toBeNull();
		expect(await getPublishedPostBySlug(db, "en", "future", NOW)).toBeNull();

		const tagsEn = await listTags(db, "en", NOW);
		const notes = tagsEn.find((t) => t.slug === "notes");
		// t-notes links p-en-2 (visible) + draft + future (invisible) => count 1
		expect(notes?.postCount).toBe(1);
	});

	it("paginates stably across inserts with opaque cursors", async () => {
		const db = createDb(env.DB);
		const first = await listPublishedPosts(db, { locale: "en", limit: 1 }, NOW);
		expect(first.items).toHaveLength(1);
		expect(first.nextCursor).not.toBeNull();

		// Insert a newer post mid-pagination; cursor still resumes after "first".
		await db.insert(posts).values({
			id: "p-en-new",
			locale: "en",
			translationGroupId: null,
			slug: "newest",
			title: "Newest",
			status: "published",
			publishedAt: NOW,
			contentJson: doc("Newest"),
			createdAt: NOW,
			updatedAt: NOW,
		});
		const second = await listPublishedPosts(
			db,
			{ locale: "en", limit: 1, cursor: first.nextCursor ?? undefined },
			NOW,
		);
		expect(second.items.map((p) => p.slug)).toEqual(["first"]);
		expect(second.nextCursor).toBeNull();
	});

	it("enforces UNIQUE(locale, slug)", async () => {
		const db = createDb(env.DB);
		await expect(
			db.insert(posts).values({
				id: "p-en-dup",
				locale: "en",
				translationGroupId: null,
				slug: "first",
				title: "Dup",
				status: "published",
				publishedAt: NOW,
				contentJson: doc("Dup"),
				createdAt: NOW,
				updatedAt: NOW,
			}),
		).rejects.toThrow();
	});

	it("enforces translation-group uniqueness per locale", async () => {
		const db = createDb(env.DB);
		// Same group + same locale as p-en-1 must fail…
		await expect(
			db.insert(posts).values({
				id: "p-en-dup-group",
				locale: "en",
				translationGroupId: "g-1",
				slug: "other-slug",
				title: "Dup group",
				status: "draft",
				publishedAt: null,
				contentJson: doc("Dup"),
				createdAt: NOW,
				updatedAt: NOW,
			}),
		).rejects.toThrow();
		// …but the same group in a *third* row of the other locale must also fail.
		await expect(
			db.insert(posts).values({
				id: "p-id-dup-group",
				locale: "id",
				translationGroupId: "g-1",
				slug: "lain",
				title: "Lain",
				status: "draft",
				publishedAt: null,
				contentJson: doc("Lain"),
				createdAt: NOW,
				updatedAt: NOW,
			}),
		).rejects.toThrow();
	});

	it("returns tags and translation alternates on single-post fetch", async () => {
		const db = createDb(env.DB);
		const post = await getPublishedPostBySlug(db, "en", "first", NOW);
		expect(post?.tags.map((t) => t.slug)).toEqual(["essays"]);
		expect(post?.alternates).toEqual([{ locale: "id", slug: "pertama" }]);

		const translations = await getTranslations(db, "g-1", "p-en-1", NOW);
		expect(translations).toEqual([{ locale: "id", slug: "pertama" }]);
		expect(await getTranslations(db, null, undefined, NOW)).toEqual([]);
	});
});

describe("getRelatedPosts (real local D1)", () => {
	beforeEach(async () => {
		await fixture();
	});

	it("returns visible tag-sharers, self excluded, newest first", async () => {
		const { getRelatedPosts } = await import("../src/server/db");
		const db = createDb(env.DB);
		// p-en-2 shares t-essays with p-en-1 and t-notes with the draft/future
		// posts (both invisible) — only p-en-1 qualifies.
		const related = await getRelatedPosts(
			db,
			{ locale: "en", postId: "p-en-2", tagIds: ["t-essays", "t-notes"] },
			NOW,
		);
		expect(related).toEqual([{ id: "p-en-1", slug: "first", title: "First" }]);
	});

	it("returns empty for untagged posts and invisible-only neighborhoods", async () => {
		const { getRelatedPosts } = await import("../src/server/db");
		const db = createDb(env.DB);
		expect(
			await getRelatedPosts(
				db,
				{ locale: "en", postId: "p-en-1", tagIds: [] },
				NOW,
			),
		).toEqual([]);
		// t-notes links p-en-2 to the draft + future posts only.
		expect(
			await getRelatedPosts(
				db,
				{ locale: "en", postId: "p-en-2", tagIds: ["t-notes"] },
				NOW,
			),
		).toEqual([]);
	});

	it("caps results at 3, newest first", async () => {
		const { getRelatedPosts } = await import("../src/server/db");
		const db = createDb(env.DB);
		for (let i = 0; i < 4; i++) {
			await db.insert(posts).values({
				id: `p-en-extra-${i}`,
				locale: "en",
				translationGroupId: null,
				slug: `extra-${i}`,
				title: `Extra ${i}`,
				status: "published",
				publishedAt: NOW - i * DAY,
				contentJson: doc(`Extra ${i}`),
				createdAt: NOW - i * DAY,
				updatedAt: NOW - i * DAY,
			});
			await db
				.insert(postTags)
				.values({ postId: `p-en-extra-${i}`, tagId: "t-essays" });
		}
		const related = await getRelatedPosts(
			db,
			{ locale: "en", postId: "p-en-1", tagIds: ["t-essays"] },
			NOW,
		);
		// "second" (fixture, NOW-1d) also shares t-essays; id ASC breaks the
		// NOW-1d tie ahead of extra-1.
		expect(related.map((r) => r.slug)).toEqual([
			"extra-0",
			"second",
			"extra-1",
		]);
	});
});

describe("post search (real local D1 FTS5)", () => {
	beforeEach(async () => {
		await fixture();
	});

	it("indexes on publish and removes on unpublish", async () => {
		const { createPostService, publishPostService, unpublishPostService } =
			await import("../src/server/admin/service");
		const { searchPosts, toMatchQuery } = await import(
			"../src/server/search/fts"
		);
		const db = createDb(env.DB);
		const created = await createPostService(db, {
			locale: "en",
			slug: "searchable",
			title: "Searchable post",
			excerpt: "",
			contentJson: JSON.stringify({
				type: "doc",
				content: [
					{
						type: "heading",
						attrs: { level: 2 },
						content: [{ type: "text", text: "Zebra stripes" }],
					},
					{ type: "paragraph", content: [{ type: "text", text: "Body." }] },
				],
			}),
			tagIds: [],
		});
		if (!created.ok) throw new Error("create failed");
		const match = toMatchQuery("zebra");
		if (match === null) throw new Error("match failed");
		// Draft: invisible to search.
		expect(await searchPosts(db, { locale: "en", match, now: NOW })).toEqual(
			[],
		);
		const published = await publishPostService(db, created.value.id, {
			publishedAt: NOW - DAY,
		});
		if (!published.ok) throw new Error("publish failed");
		const hits = await searchPosts(db, { locale: "en", match, now: NOW });
		expect(hits.map((h) => h.slug)).toEqual(["searchable"]);
		// Other locale never matches.
		expect(await searchPosts(db, { locale: "id", match, now: NOW })).toEqual(
			[],
		);
		const unpublished = await unpublishPostService(db, created.value.id);
		if (!unpublished.ok) throw new Error("unpublish failed");
		expect(await searchPosts(db, { locale: "en", match, now: NOW })).toEqual(
			[],
		);
	});
});
