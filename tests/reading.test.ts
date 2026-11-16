import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { type Locale, SITE } from "../src/config/site";
import { detectLocaleFromPath, formatPostDate, t } from "../src/i18n";
import { groupByYear, rootHreflangs } from "../src/lib/archive";
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

// Route-level contracts for the reader pages: visibility 404s in both
// locales (draft/future/wrong-locale return null from the repo, which pages
// turn into 404), cursor pagination passthrough, hreflang symmetry between
// locales, and localized 404 detection. Pages themselves are thin wrappers
// over these repo + helper calls, so asserting the contracts here covers
// the route behavior end to end at the data layer.
function doc(title: string): string {
	return JSON.stringify({
		type: "doc",
		content: [
			{
				type: "heading",
				attrs: { level: 2 },
				content: [{ type: "text", text: title }],
			},
			{ type: "paragraph", content: [{ type: "text", text: "Body." }] },
		],
	});
}

async function fixture() {
	const db = createDb(env.DB);
	await db.delete(postTags);
	await db.delete(posts);
	await db.delete(tags);

	await db.insert(tags).values([
		{ id: "t-essays", slug: "essays", labelEn: "Essays", labelId: "Esai" },
		{ id: "t-notes", slug: "notes", labelEn: "Notes", labelId: "Catatan" },
	]);
	// 25 EN posts for cursor-pagination tests, plus the bilingual pair and
	// the invisible rows.
	const enPosts = Array.from({ length: 25 }, (_, i) => ({
		id: `p-en-${i}`,
		locale: "en",
		translationGroupId: null,
		slug: `en-${i}`,
		title: `EN ${i}`,
		status: "published",
		publishedAt: NOW - (i + 1) * DAY,
		contentJson: doc(`EN ${i}`),
		contentHtml: "<p>Body.</p>",
		tocJson: "[]",
		readingMinutes: 1,
		createdAt: NOW - (i + 1) * DAY,
		updatedAt: NOW - (i + 1) * DAY,
	}));
	// D1 caps bound parameters per statement: insert the generated rows in
	// small batches, then the fixed rows.
	for (let i = 0; i < enPosts.length; i += 4) {
		await db.insert(posts).values(enPosts.slice(i, i + 4));
	}
	await db.insert(posts).values([
		{
			id: "p-en-pair",
			locale: "en",
			translationGroupId: "g-pair",
			slug: "pair-en",
			title: "Pair EN",
			status: "published",
			publishedAt: NOW - 30 * DAY,
			contentJson: doc("Pair EN"),
			contentHtml: "<p>Body.</p>",
			tocJson: "[]",
			readingMinutes: 1,
			createdAt: NOW - 30 * DAY,
			updatedAt: NOW - 30 * DAY,
		},
		{
			id: "p-id-pair",
			locale: "id",
			translationGroupId: "g-pair",
			slug: "pair-id",
			title: "Pair ID",
			status: "published",
			publishedAt: NOW - 30 * DAY,
			contentJson: doc("Pair ID"),
			contentHtml: "<p>Body.</p>",
			tocJson: "[]",
			readingMinutes: 1,
			createdAt: NOW - 30 * DAY,
			updatedAt: NOW - 30 * DAY,
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
			contentHtml: "<p>Draft.</p>",
			tocJson: "[]",
			readingMinutes: 1,
			createdAt: NOW - 1 * DAY,
			updatedAt: NOW - 1 * DAY,
		},
		{
			id: "p-id-future",
			locale: "id",
			translationGroupId: null,
			slug: "future",
			title: "Future",
			status: "published",
			publishedAt: NOW + 7 * DAY,
			contentJson: doc("Future"),
			contentHtml: "<p>Future.</p>",
			tocJson: "[]",
			readingMinutes: 1,
			createdAt: NOW - 1 * DAY,
			updatedAt: NOW - 1 * DAY,
		},
	]);
	await db.insert(postTags).values([
		{ postId: "p-en-pair", tagId: "t-essays" },
		{ postId: "p-id-pair", tagId: "t-essays" },
		{ postId: "p-en-draft", tagId: "t-notes" },
		{ postId: "p-id-future", tagId: "t-notes" },
	]);
	return db;
}

describe("reader routes (real local D1)", () => {
	beforeEach(async () => {
		await fixture();
	});

	it("returns null for draft, future, and wrong-locale slugs in both locales", async () => {
		const db = createDb(env.DB);
		expect(await getPublishedPostBySlug(db, "en", "draft", NOW)).toBeNull();
		expect(await getPublishedPostBySlug(db, "en", "pair-id", NOW)).toBeNull();
		expect(await getPublishedPostBySlug(db, "id", "future", NOW)).toBeNull();
		expect(await getPublishedPostBySlug(db, "id", "pair-en", NOW)).toBeNull();
		expect(await getPublishedPostBySlug(db, "en", "nope", NOW)).toBeNull();
		expect(await getPublishedPostBySlug(db, "id", "nope", NOW)).toBeNull();
	});

	it("resolves the translation link or falls back to the other locale home", async () => {
		const db = createDb(env.DB);
		const post = await getPublishedPostBySlug(db, "en", "pair-en", NOW);
		expect(post).not.toBeNull();
		const alternates = await getTranslations(
			db,
			post?.translationGroupId ?? null,
			post?.id,
			NOW,
		);
		expect(alternates).toEqual([{ locale: "id", slug: "pair-id" }]);
		const solo = await getPublishedPostBySlug(db, "en", "en-0", NOW);
		expect(
			await getTranslations(
				db,
				solo?.translationGroupId ?? null,
				solo?.id,
				NOW,
			),
		).toEqual([]);
	});

	it("pages with ?cursor= across the full set without overlap", async () => {
		const db = createDb(env.DB);
		const first = await listPublishedPosts(
			db,
			{ locale: "en", limit: 20 },
			NOW,
		);
		expect(first.items).toHaveLength(20);
		expect(first.nextCursor).not.toBeNull();
		const second = await listPublishedPosts(
			db,
			{ locale: "en", limit: 20, cursor: first.nextCursor ?? undefined },
			NOW,
		);
		const firstIds = new Set(first.items.map((p) => p.id));
		for (const item of second.items) {
			expect(firstIds.has(item.id)).toBe(false);
		}
		expect(first.items.length + second.items.length).toBe(26);
	});

	it("keeps tag counts visible-only and 404s unknown tag slugs", async () => {
		const db = createDb(env.DB);
		const enTags = await listTags(db, "en", NOW);
		const notes = enTags.find((tag) => tag.slug === "notes");
		expect(notes?.postCount).toBe(0);
		const essays = enTags.find((tag) => tag.slug === "essays");
		expect(essays?.postCount).toBe(1);
		const tagged = await listPublishedPosts(
			db,
			{ locale: "en", tagSlug: "nope" },
			NOW,
		);
		expect(tagged).toEqual({ items: [], nextCursor: null });
	});

	it("builds symmetric hreflangs for a locale-rooted path", () => {
		expect(rootHreflangs("/")).toEqual([
			{ locale: "en", href: "/" },
			{ locale: "id", href: "/id" },
		]);
		expect(rootHreflangs("/writing")).toEqual([
			{ locale: "en", href: "/writing" },
			{ locale: "id", href: "/id/writing" },
		]);
	});

	it("detects the 404 locale from the URL prefix in both locales", () => {
		expect(detectLocaleFromPath("/id/writing/missing")).toBe("id");
		expect(detectLocaleFromPath("/writing/missing")).toBe("en");
		expect(t("id", "notfound.title")).not.toBe(t("en", "notfound.title"));
	});

	it("groups archives by year in the configured timezone", () => {
		const db = createDb(env.DB);
		return listPublishedPosts(db, { locale: "en", limit: 50 }, NOW).then(
			({ items }) => {
				const groups = groupByYear(items);
				expect(groups.length).toBeGreaterThan(0);
				const years = groups.map((g) => g.year);
				const sorted = [...years].sort((a, b) => (a < b ? 1 : -1));
				expect(years).toEqual(sorted);
				const total = groups.reduce((n, g) => n + g.posts.length, 0);
				expect(total).toBe(items.length);
			},
		);
	});

	it("formats post dates in the configured timezone and locale", () => {
		// 2026-11-05T18:30:00Z is 2026-11-06 01:30 in Asia/Jakarta: the
		// formatted date must follow the display timezone, not UTC.
		const stamp = Date.UTC(2026, 10, 5, 18, 30);
		expect(formatPostDate(stamp, "en")).toContain("Nov 6, 2026");
		expect(formatPostDate(stamp, "id")).toContain("6 Nov 2026");
	});
});

describe("i18n reader strings", () => {
	it("resolves every locale from SITE.locales", () => {
		for (const locale of SITE.locales) {
			const l: Locale = locale;
			expect(t(l, "site.intro").length).toBeGreaterThan(0);
			expect(t(l, "notfound.body").length).toBeGreaterThan(0);
		}
	});
});
