import { eq } from "drizzle-orm";
import type { Env } from "../../lib/env";
import type { ServiceError, ServiceResult } from "../admin/service";
import type { Db } from "../db";
import { media, postMedia, posts } from "../db/schema";
import {
	checkVariants,
	type MediaCheckError,
	parseMediaMeta,
} from "./validate";

// Media library service (spec 05 §5.2). Thin Astro endpoints call these;
// tests call them directly. R2 writes use immutable cache headers; any throw
// after the first put deletes the keys already written (partial-failure
// cleanup). All DB access via bound params.

export interface MediaVariant {
	w: number;
	key: string;
	bytes: number;
	mime: "image/webp";
}

export function parseVariantsJson(raw: string): MediaVariant[] | null {
	let v: unknown;
	try {
		v = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!Array.isArray(v)) return null;
	const out: MediaVariant[] = [];
	for (const item of v) {
		if (typeof item !== "object" || item === null) return null;
		const rec = item as Record<string, unknown>;
		if (
			typeof rec.w !== "number" ||
			typeof rec.key !== "string" ||
			typeof rec.bytes !== "number"
		) {
			return null;
		}
		out.push({
			w: rec.w,
			key: rec.key,
			bytes: rec.bytes,
			mime: "image/webp",
		});
	}
	return out;
}

const CHECK_STATUS: Record<
	MediaCheckError,
	{ code: ServiceError["code"]; status: number }
> = {
	"bad-mimetype": { code: "bad-request", status: 400 },
	"too-large": { code: "too-large", status: 422 },
	"too-many": { code: "too-many", status: 422 },
	"bad-dimensions": { code: "bad-dimensions", status: 422 },
	"width-mismatch": { code: "width-mismatch", status: 422 },
	"aspect-mismatch": { code: "aspect-mismatch", status: 422 },
	"bad-meta": { code: "bad-request", status: 400 },
};

export interface UploadedMedia {
	id: string;
	r2KeyPrefix: string;
	mime: string;
	width: number;
	height: number;
	bytes: number;
	altDefault: string;
	dominantColor: string | null;
	variantsJson: string;
	createdAt: number;
}

const FILE_RE = /^(\d+)\.webp$/;

/** Parse multipart formData: `meta` JSON + variant File parts. */
export async function uploadMediaService(
	db: Db,
	env: Env,
	formData: FormData,
): Promise<ServiceResult<UploadedMedia>> {
	const metaRaw = formData.get("meta");
	if (typeof metaRaw !== "string") {
		return {
			ok: false,
			err: { code: "bad-request", status: 400, detail: "meta" },
		};
	}
	let metaJson: unknown;
	try {
		metaJson = JSON.parse(metaRaw);
	} catch {
		return {
			ok: false,
			err: { code: "bad-request", status: 400, detail: "meta" },
		};
	}
	const meta = parseMediaMeta(metaJson);
	if (meta === null) {
		return {
			ok: false,
			err: { code: "bad-request", status: 400, detail: "meta" },
		};
	}
	// Collect every part except `meta`; each filename must be `<w>.webp`.
	const parts: { w: number; bytes: Uint8Array }[] = [];
	for (const [name, value] of formData.entries()) {
		if (name === "meta") continue;
		if (!(value instanceof File)) {
			return {
				ok: false,
				err: { code: "bad-request", status: 400, detail: name },
			};
		}
		const m = FILE_RE.exec(value.name);
		if (m === null || m[1] === undefined) {
			return {
				ok: false,
				err: { code: "bad-request", status: 400, detail: value.name },
			};
		}
		const buf = new Uint8Array(await value.arrayBuffer());
		parts.push({ w: Number(m[1]), bytes: buf });
	}
	const checked = checkVariants(
		meta,
		parts.map((p) => ({ width: p.w, bytes: p.bytes })),
	);
	if (!checked.ok) {
		const mapped = CHECK_STATUS[checked.code];
		return { ok: false, err: { code: mapped.code, status: mapped.status } };
	}

	const id = crypto.randomUUID();
	const widths = parts.map((p) => p.w).sort((a, b) => a - b);
	const byWidth = new Map(parts.map((p) => [p.w, p.bytes]));
	const keys = widths.map((w) => `media/${id}/${w}.webp`);
	const keysWritten: string[] = [];
	try {
		for (const key of keys) {
			const w = Number(key.split("/").pop()?.split(".")[0]);
			const bytes = byWidth.get(w);
			if (bytes === undefined) throw new Error("width map mismatch");
			await env.MEDIA.put(key, bytes, {
				httpMetadata: {
					contentType: "image/webp",
					cacheControl: "public, max-age=31536000, immutable",
				},
			});
			keysWritten.push(key);
		}
	} catch (err) {
		await Promise.allSettled(keysWritten.map((k) => env.MEDIA.delete(k)));
		throw err;
	}
	const totalBytes = parts.reduce((n, p) => n + p.bytes.length, 0);
	const variantsJson = JSON.stringify(
		widths.map((w) => ({
			w,
			key: `media/${id}/${w}.webp`,
			bytes: byWidth.get(w)?.length ?? 0,
			mime: "image/webp",
		})),
	);
	const row: UploadedMedia = {
		id,
		r2KeyPrefix: `media/${id}/`,
		mime: "image/webp",
		width: meta.sourceWidth,
		height: meta.sourceHeight,
		bytes: totalBytes,
		altDefault: meta.altDefault,
		dominantColor: meta.dominantColor,
		variantsJson,
		createdAt: Date.now(),
	};
	try {
		await db.insert(media).values(row);
	} catch (err) {
		await Promise.allSettled(keysWritten.map((k) => env.MEDIA.delete(k)));
		throw err;
	}
	return { ok: true, value: row };
}

export interface MediaWithUse extends UploadedMedia {
	useCount: number;
	posts: string[];
}

/** All media rows with per-item post reference counts (admin library). */
export async function listMediaService(db: Db): Promise<MediaWithUse[]> {
	const rows = await db.select().from(media);
	const links = await db.select().from(postMedia);
	const byMedia = new Map<string, string[]>();
	for (const link of links) {
		const list = byMedia.get(link.mediaId) ?? [];
		list.push(link.postId);
		byMedia.set(link.mediaId, list);
	}
	return rows.map((r) => {
		const posts = byMedia.get(r.id) ?? [];
		return {
			id: r.id,
			r2KeyPrefix: r.r2KeyPrefix,
			mime: r.mime,
			width: r.width,
			height: r.height,
			bytes: r.bytes,
			altDefault: r.altDefault,
			dominantColor: r.dominantColor,
			variantsJson: r.variantsJson,
			createdAt: r.createdAt,
			useCount: posts.length,
			posts,
		};
	});
}

export async function renameMediaService(
	db: Db,
	id: string,
	body: unknown,
): Promise<ServiceResult<UploadedMedia>> {
	const alt =
		typeof body === "object" && body !== null
			? (body as Record<string, unknown>).altDefault
			: undefined;
	if (typeof alt !== "string" || alt.length > 200) {
		return {
			ok: false,
			err: { code: "bad-request", status: 400, detail: "altDefault" },
		};
	}
	const rows = await db.select().from(media).where(eq(media.id, id));
	const row = rows[0];
	if (!row) return { ok: false, err: { code: "not-found", status: 404 } };
	await db.update(media).set({ altDefault: alt }).where(eq(media.id, id));
	return {
		ok: true,
		value: {
			id: row.id,
			r2KeyPrefix: row.r2KeyPrefix,
			mime: row.mime,
			width: row.width,
			height: row.height,
			bytes: row.bytes,
			altDefault: alt,
			dominantColor: row.dominantColor,
			variantsJson: row.variantsJson,
			createdAt: row.createdAt,
		},
	};
}

export async function deleteMediaService(
	db: Db,
	env: Env,
	id: string,
): Promise<ServiceResult<{ deleted: true }>> {
	const refs = await db
		.select()
		.from(postMedia)
		.where(eq(postMedia.mediaId, id));
	if (refs.length > 0) {
		return {
			ok: false,
			err: {
				code: "media-in-use",
				status: 409,
				detail: refs.map((r) => r.postId).join(","),
			},
		};
	}
	const rows = await db.select().from(media).where(eq(media.id, id));
	const row = rows[0];
	if (!row) return { ok: false, err: { code: "not-found", status: 404 } };
	const variants = parseVariantsJson(row.variantsJson) ?? [];
	await db.delete(media).where(eq(media.id, id));
	await Promise.allSettled(variants.map((v) => env.MEDIA.delete(v.key)));
	return { ok: true, value: { deleted: true } };
}

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
export const OG_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readU32BE(bytes: Uint8Array, offset: number): number {
	const b0 = bytes[offset] ?? Number.NaN;
	const b1 = bytes[offset + 1] ?? Number.NaN;
	const b2 = bytes[offset + 2] ?? Number.NaN;
	const b3 = bytes[offset + 3] ?? Number.NaN;
	return b0 * 0x1000000 + b1 * 0x10000 + b2 * 0x100 + b3;
}

/** PNG magic + IHDR dimensions; null when the buffer is not a PNG. */
export function parsePngDimensions(
	bytes: Uint8Array,
): { width: number; height: number } | null {
	if (bytes.length < 33) return null;
	for (let i = 0; i < PNG_MAGIC.length; i++) {
		if (bytes[i] !== PNG_MAGIC[i]) return null;
	}
	// IHDR must be the first chunk: length(4) + "IHDR"(4) + width(4) + height(4).
	if (
		bytes[12] !== 0x49 ||
		bytes[13] !== 0x48 ||
		bytes[14] !== 0x44 ||
		bytes[15] !== 0x52
	) {
		return null;
	}
	return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) };
}

/**
 * Per-post share image (spec 06 §6.4). Validates a client-generated PNG
 * (≤2 MiB, magic + 1200×630 IHDR), writes `og/<postId>.png` to R2 with
 * immutable cache headers, then records the key. Same partial-failure
 * cleanup as `uploadMediaService`: a failed DB update deletes the R2 key.
 * `updatedAt` is untouched so OG refreshes never move feed/sitemap dates.
 */
export async function uploadOgImageService(
	db: Db,
	env: Env,
	postId: string,
	bytes: Uint8Array,
): Promise<ServiceResult<{ key: string }>> {
	const rows = await db
		.select({ id: posts.id })
		.from(posts)
		.where(eq(posts.id, postId));
	if (rows.length === 0)
		return { ok: false, err: { code: "not-found", status: 404 } };
	if (bytes.length > OG_IMAGE_MAX_BYTES) {
		return { ok: false, err: { code: "too-large", status: 422 } };
	}
	const dims = parsePngDimensions(bytes);
	if (
		dims === null ||
		dims.width !== OG_IMAGE_WIDTH ||
		dims.height !== OG_IMAGE_HEIGHT
	) {
		return { ok: false, err: { code: "bad-dimensions", status: 422 } };
	}
	const key = `og/${postId}.png`;
	await env.MEDIA.put(key, bytes, {
		httpMetadata: {
			contentType: "image/png",
			cacheControl: "public, max-age=31536000, immutable",
		},
	});
	try {
		await db.update(posts).set({ ogImageKey: key }).where(eq(posts.id, postId));
	} catch (err) {
		await env.MEDIA.delete(key);
		throw err;
	}
	return { ok: true, value: { key } };
}
