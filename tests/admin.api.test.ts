import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	createPostService,
	createTagService,
	deletePostService,
	deleteTagService,
	publishPostService,
	renameTagService,
	savePostService,
	unpublishPostService,
} from "../src/server/admin/service";
import { getPublishedPostBySlug } from "../src/server/db";
import { createDb } from "../src/server/db/client";
import { posts, postTags, tags } from "../src/server/db/schema";

function doc(title = "Hello"): string {
	return JSON.stringify({
		type: "doc",
		content: [
			{
				type: "heading",
				attrs: { level: 2 },
				content: [{ type: "text", text: title }],
			},
			{
				type: "paragraph",
				content: [{ type: "text", text: "Body text here." }],
			},
		],
	});
}

async function fixture() {
	const db = createDb(env.DB);
	await db.delete(postTags);
	await db.delete(posts);
	await db.delete(tags);
	await db
		.insert(tags)
		.values([
			{ id: "t-essays", slug: "essays", labelEn: "Essays", labelId: "Esai" },
		]);
	return db;
}

function newPost(overrides: Record<string, unknown> = {}) {
	return {
		locale: "en",
		slug: "hello",
		title: "Hello",
		excerpt: "Excerpt",
		contentJson: doc(),
		tagIds: ["t-essays"],
		...overrides,
	};
}

describe("admin service", () => {
	beforeEach(fixture);

	it("creates a draft with rendered html, then publishes it visible", async () => {
		const db = createDb(env.DB);
		const created = await createPostService(db, newPost());
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		expect(created.value.status).toBe("draft");
		expect(created.value.contentHtml).toContain("<h2");
		expect(created.value.readingMinutes).toBe(1);

		const published = await publishPostService(db, created.value.id, {});
		expect(published.ok).toBe(true);

		const visible = await getPublishedPostBySlug(db, "en", "hello");
		expect(visible?.id).toBe(created.value.id);

		const unpublished = await unpublishPostService(db, created.value.id);
		expect(unpublished.ok).toBe(true);
		expect(await getPublishedPostBySlug(db, "en", "hello")).toBeNull();
	});

	it("reports schema path for invalid content", async () => {
		const db = createDb(env.DB);
		const bad = JSON.stringify({
			type: "doc",
			content: [{ type: "mystery", content: [] }],
		});
		const result = await createPostService(db, newPost({ contentJson: bad }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.err.code).toBe("schema");
		expect(result.err.detail).not.toBe("");
	});

	it("rejects duplicate slugs with 409", async () => {
		const db = createDb(env.DB);
		expect((await createPostService(db, newPost())).ok).toBe(true);
		const dup = await createPostService(db, newPost({ title: "Other" }));
		expect(dup.ok).toBe(false);
		if (dup.ok) return;
		expect(dup.err).toMatchObject({ code: "slug-conflict", status: 409 });
		// Same slug in the other locale is fine.
		expect((await createPostService(db, newPost({ locale: "id" }))).ok).toBe(
			true,
		);
	});

	it("concurrency 409 carries the live stamp; reload wins", async () => {
		const db = createDb(env.DB);
		const created = await createPostService(db, newPost());
		if (!created.ok) return;
		const stale = created.value.updatedAt;

		const first = await savePostService(db, created.value.id, {
			expectedUpdatedAt: stale,
			title: "First wins",
		});
		expect(first.ok).toBe(true);
		if (!first.ok) return;

		const second = await savePostService(db, created.value.id, {
			expectedUpdatedAt: stale,
			title: "Stale loses",
		});
		expect(second.ok).toBe(false);
		if (second.ok) return;
		expect(second.err.code).toBe("concurrency");
		expect(second.err.currentUpdatedAt).toBe(first.value.updatedAt);

		// Reload with the fresh stamp wins.
		const third = await savePostService(db, created.value.id, {
			expectedUpdatedAt: second.err.currentUpdatedAt ?? 0,
			title: "Reload wins",
		});
		expect(third.ok).toBe(true);
	});

	it("publish validates required fields with 422", async () => {
		const db = createDb(env.DB);
		// Empty-content doc passes create? No: schema-ok but empty blocks
		// fail at renderContent. Build via repo with blank title instead.
		const created = await createPostService(db, newPost());
		if (!created.ok) return;
		await db
			.update(posts)
			.set({ title: "  " })
			.where(eq(posts.id, created.value.id));
		const result = await publishPostService(db, created.value.id, {});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.err).toMatchObject({ code: "validation", status: 422 });
	});

	it("rejects non-null coverMediaId with 422", async () => {
		const db = createDb(env.DB);
		const result = await createPostService(
			db,
			newPost({ coverMediaId: "m-1" }),
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.err.code).toBe("media-unavailable");
	});

	it("tag delete blocked in use, then confirmed", async () => {
		const db = createDb(env.DB);
		const created = await createPostService(db, newPost());
		expect(created.ok).toBe(true);

		const blocked = await deleteTagService(db, "t-essays", {});
		expect(blocked.ok).toBe(false);
		if (blocked.ok) return;
		expect(blocked.err).toMatchObject({ code: "tag-in-use", status: 409 });

		const confirmed = await deleteTagService(db, "t-essays", { confirm: true });
		expect(confirmed.ok).toBe(true);

		const renamed = await renameTagService(db, "t-missing", { slug: "x" });
		expect(renamed.ok).toBe(false);
		if (renamed.ok) return;
		expect(renamed.err.code).toBe("not-found");

		const tag = await createTagService(db, {
			slug: "notes",
			labelEn: "Notes",
			labelId: "Catatan",
		});
		expect(tag.ok).toBe(true);
		const dup = await createTagService(db, {
			slug: "notes",
			labelEn: "N",
			labelId: "C",
		});
		expect(dup.ok).toBe(false);
		if (dup.ok) return;
		expect(dup.err.code).toBe("slug-conflict");
	});

	it("deletes a post and its links", async () => {
		const db = createDb(env.DB);
		const created = await createPostService(db, newPost());
		if (!created.ok) return;
		expect((await deletePostService(db, created.value.id)).ok).toBe(true);
		const gone = await deletePostService(db, created.value.id);
		expect(gone.ok).toBe(false);
	});
});
