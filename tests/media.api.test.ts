import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/lib/env";
import { createDb } from "../src/server/db/client";
import {
	media,
	postMedia,
	posts,
	postTags,
	tags,
} from "../src/server/db/schema";
import {
	deleteMediaService,
	listMediaService,
	renameMediaService,
	uploadMediaService,
} from "../src/server/media/service";

// In-memory R2 stand-in: records put options (cacheControl assertion) and
// supports get/delete. The real bucket binding exists in wrangler.jsonc, but
// the fake keeps failure injection (throwing put) trivial.
function fakeBucket(failOnPutIndex: number | null = null) {
	const store = new Map<string, { bytes: Uint8Array; options: unknown }>();
	let puts = 0;
	return {
		store,
		bucket: {
			put: async (key: string, value: Uint8Array, options?: unknown) => {
				if (failOnPutIndex !== null && puts === failOnPutIndex) {
					throw new Error("R2 put failed");
				}
				puts += 1;
				store.set(key, { bytes: value.slice(), options });
				return null;
			},
			get: async (key: string) => {
				const hit = store.get(key);
				if (!hit) return null;
				return { key, ...hit };
			},
			delete: async (key: string | string[]) => {
				for (const k of Array.isArray(key) ? key : [key]) store.delete(k);
			},
		} as unknown as Env["MEDIA"],
	};
}

function testEnv(bucket: Env["MEDIA"]): Env {
	return {
		DB: env.DB,
		MEDIA: bucket,
		SITE_URL: "https://gurat.yvdist.com",
		ACCESS_TEAM_DOMAIN: "",
		ACCESS_AUD: "",
		ADMIN_EMAILS: "",
		MEDIA_BASE_URL: "",
	};
}

/** Minimal lossy WebP with 14-bit w/h header. */
function webp(w: number, h: number): Uint8Array {
	return new Uint8Array([
		0x52,
		0x49,
		0x46,
		0x46,
		0x1a,
		0,
		0,
		0,
		0x57,
		0x45,
		0x42,
		0x50,
		0x56,
		0x50,
		0x38,
		0x20,
		0x0e,
		0,
		0,
		0,
		0x10,
		0x20,
		0x00,
		0x9d,
		0x01,
		0x2a,
		w & 0xff,
		(w >> 8) & 0x3f,
		h & 0xff,
		(h >> 8) & 0x3f,
	]);
}

function form(
	meta: Record<string, unknown>,
	files: { name: string; bytes: Uint8Array; type?: string }[],
): FormData {
	const fd = new FormData();
	fd.set("meta", JSON.stringify(meta));
	for (const f of files) {
		fd.set(
			f.name,
			new File([f.bytes as unknown as BlobPart], f.name, {
				type: f.type ?? "image/webp",
			}),
		);
	}
	return fd;
}

const META = {
	sourceWidth: 960,
	sourceHeight: 480,
	sourceBytes: 1000,
	sourceMime: "image/jpeg",
	altDefault: "Alt",
	dominantColor: "#112233",
};

beforeEach(async () => {
	const db = createDb(env.DB);
	await db.delete(postMedia);
	await db.delete(postTags);
	await db.delete(posts);
	await db.delete(tags);
	await db.delete(media);
});

describe("media api", () => {
	it("happy upload: 201, R2 keys exist with immutable headers, row shape", async () => {
		const db = createDb(env.DB);
		const { store, bucket } = fakeBucket();
		const result = await uploadMediaService(
			db,
			testEnv(bucket),
			form(META, [
				{ name: "480.webp", bytes: webp(480, 240) },
				{ name: "960.webp", bytes: webp(960, 480) },
			]),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(store.size).toBe(2);
		for (const entry of store.values()) {
			expect(entry.options).toMatchObject({
				httpMetadata: {
					contentType: "image/webp",
					cacheControl: "public, max-age=31536000, immutable",
				},
			});
		}
		expect(result.value.mime).toBe("image/webp");
		expect(result.value.width).toBe(960);
		expect(JSON.parse(result.value.variantsJson)).toHaveLength(2);
		// get() round-trips through the stored keys.
		for (const key of store.keys()) {
			expect(await bucket.get(key)).not.toBeNull();
		}
	});

	it("SVG/disguised upload rejected with zero R2 keys left", async () => {
		const db = createDb(env.DB);
		const { store, bucket } = fakeBucket();
		const svg = new TextEncoder().encode("<svg></svg>");
		const result = await uploadMediaService(
			db,
			testEnv(bucket),
			form(META, [{ name: "480.webp", bytes: svg }]),
		);
		expect(result.ok).toBe(false);
		expect(store.size).toBe(0);
	});

	it("partial-failure cleanup: put throws on 2nd key, 0 keys remain", async () => {
		const db = createDb(env.DB);
		const { store, bucket } = fakeBucket(1);
		await expect(
			uploadMediaService(
				db,
				testEnv(bucket),
				form(META, [
					{ name: "480.webp", bytes: webp(480, 240) },
					{ name: "960.webp", bytes: webp(960, 480) },
				]),
			),
		).rejects.toThrow("R2 put failed");
		expect(store.size).toBe(0);
	});

	it("rename alt, delete referenced 409, delete unreferenced removes row + R2", async () => {
		const db = createDb(env.DB);
		const { store, bucket } = fakeBucket();
		const up = await uploadMediaService(
			db,
			testEnv(bucket),
			form(META, [{ name: "960.webp", bytes: webp(960, 480) }]),
		);
		expect(up.ok).toBe(true);
		if (!up.ok) return;
		const id = up.value.id;

		const renamed = await renameMediaService(db, id, { altDefault: "New alt" });
		expect(renamed.ok && renamed.ok ? renamed.value.altDefault : null).toBe(
			"New alt",
		);

		// Reference it from a post.
		await db.insert(posts).values({
			id: "p-1",
			locale: "en",
			translationGroupId: null,
			slug: "s",
			title: "t",
			excerpt: "e",
			status: "draft",
			publishedAt: null,
			contentJson: "{}",
			contentHtml: "",
			tocJson: "[]",
			readingMinutes: 1,
			coverMediaId: null,
			seoDescription: null,
			createdAt: 0,
			updatedAt: 0,
		});
		await db.insert(postMedia).values({ postId: "p-1", mediaId: id });
		const blocked = await deleteMediaService(db, testEnv(bucket), id);
		expect(blocked.ok).toBe(false);
		if (blocked.ok) return;
		expect(blocked.err.code).toBe("media-in-use");
		expect(blocked.err.status).toBe(409);
		// Row + R2 intact after refused delete.
		expect((await db.select().from(media)).length).toBe(1);
		expect(store.size).toBe(1);

		// Unreference, then delete succeeds with row + R2 gone.
		await db.delete(postMedia);
		const gone = await deleteMediaService(db, testEnv(bucket), id);
		expect(gone).toEqual({ ok: true, value: { deleted: true } });
		expect(await db.select().from(media)).toEqual([]);
		expect(store.size).toBe(0);
	});

	it("list returns useCount", async () => {
		const db = createDb(env.DB);
		const { bucket } = fakeBucket();
		const up = await uploadMediaService(
			db,
			testEnv(bucket),
			form(META, [{ name: "960.webp", bytes: webp(960, 480) }]),
		);
		expect(up.ok).toBe(true);
		const listed = await listMediaService(db);
		expect(listed).toHaveLength(1);
		expect(listed[0]?.useCount).toBe(0);
	});
});

describe("media api (spy variant)", () => {
	it("delete calls R2 delete per variant key", async () => {
		const db = createDb(env.DB);
		const { bucket } = fakeBucket();
		const spy = vi.spyOn(bucket, "delete");
		const up = await uploadMediaService(
			db,
			testEnv(bucket),
			form(META, [
				{ name: "480.webp", bytes: webp(480, 240) },
				{ name: "960.webp", bytes: webp(960, 480) },
			]),
		);
		expect(up.ok).toBe(true);
		if (!up.ok) return;
		await deleteMediaService(db, testEnv(bucket), up.value.id);
		expect(spy).toHaveBeenCalledTimes(2);
	});
});
