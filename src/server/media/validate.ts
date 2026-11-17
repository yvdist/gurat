import { z } from "zod";

// Server media validation (spec 05 §5.1). Pure: no DOM, no Node-only APIs —
// safe on workerd. Sniffs magic bytes (never trusts declared MIME/extension),
// parses dimensions from JPEG-SOF / PNG-IHDR / WebP-VP8/VP8L/VP8X headers,
// and checks upload limits, width match, and aspect consistency.

export type ImageKind = "jpeg" | "png" | "webp";

/** Sniff the image kind from magic bytes; `null` = not an allowed image. */
export function sniffImageKind(bytes: Uint8Array): ImageKind | null {
	if (
		bytes.length >= 3 &&
		bytes[0] === 0xff &&
		bytes[1] === 0xd8 &&
		bytes[2] === 0xff
	) {
		return "jpeg";
	}
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return "png";
	}
	// RIFF....WEBP
	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return "webp";
	}
	return null;
}

function u16be(bytes: Uint8Array, off: number): number {
	return (bytes[off] * 256 + bytes[off + 1]) | 0;
}

function u16le(bytes: Uint8Array, off: number): number {
	return (bytes[off] + bytes[off + 1] * 256) | 0;
}

function u24le(bytes: Uint8Array, off: number): number {
	return bytes[off] + bytes[off + 1] * 256 + bytes[off + 2] * 65536;
}

/** JPEG: scan markers for a Start-Of-Frame segment (baseline/progressive). */
function jpegDimensions(
	bytes: Uint8Array,
): { width: number; height: number } | null {
	// Skip SOI (FF D8).
	let off = 2;
	while (off + 3 < bytes.length) {
		if (bytes[off] !== 0xff) return null;
		const marker = bytes[off + 1];
		off += 2;
		// Standalone markers (no length).
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
		if (off + 2 > bytes.length) return null;
		const len = u16be(bytes, off);
		if (len < 2 || off + len > bytes.length) return null;
		// SOF0/1/2/3/5/6/7/9/10/11/13/14/15 (not DHT/DAC arithmetic).
		const isSof =
			marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xcc;
		if (isSof) {
			if (len < 8) return null;
			const height = u16be(bytes, off + 3);
			const width = u16be(bytes, off + 5);
			return { width, height };
		}
		off += len;
	}
	return null;
}

/** PNG: IHDR is the first chunk after the 8-byte signature. */
function pngDimensions(
	bytes: Uint8Array,
): { width: number; height: number } | null {
	if (bytes.length < 24) return null;
	// Width/height are big-endian u32 at offsets 16/20.
	const width =
		bytes[16] * 16777216 + bytes[17] * 65536 + bytes[18] * 256 + bytes[19];
	const height =
		bytes[20] * 16777216 + bytes[21] * 65536 + bytes[22] * 256 + bytes[23];
	return { width, height };
}

/** WebP: VP8 (lossy), VP8L (lossless), VP8X (extended) inner headers. */
function webpDimensions(
	bytes: Uint8Array,
): { width: number; height: number } | null {
	// RIFF(0-3) size(4-7) WEBP(8-11) FourCC(12-15) chunkSize(16-19) payload(20+).
	if (bytes.length < 12 + 8) return null;
	const fourcc = String.fromCharCode(
		bytes[12],
		bytes[13],
		bytes[14],
		bytes[15],
	);
	if (fourcc === "VP8 ") {
		// Payload: frame tag (3B) + start code 9D 01 2A + 14-bit w/h.
		if (bytes.length < 30) return null;
		if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
			return null;
		}
		const w = u16le(bytes, 26) & 0x3fff;
		const h = u16le(bytes, 28) & 0x3fff;
		return { width: w, height: h };
	}
	if (fourcc === "VP8L") {
		// Payload: 1B signature 0x2F + 4B packed 14-bit w-1/h-1.
		if (bytes.length < 25) return null;
		if (bytes[20] !== 0x2f) return null;
		const b0 = bytes[21];
		const b1 = bytes[22];
		const b2 = bytes[23];
		const b3 = bytes[24];
		const w = 1 + (((b1 & 0x3f) << 8) | b0);
		const h = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
		return { width: w, height: h };
	}
	if (fourcc === "VP8X") {
		// Payload: 1B flags + 3B reserved + 24-bit LE w-1 + 24-bit LE h-1.
		if (bytes.length < 30) return null;
		return { width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) };
	}
	return null;
}

/** Parse intrinsic dimensions from the container header. */
export function parseDimensions(
	kind: ImageKind,
	bytes: Uint8Array,
): { width: number; height: number } | null {
	const dims =
		kind === "jpeg"
			? jpegDimensions(bytes)
			: kind === "png"
				? pngDimensions(bytes)
				: webpDimensions(bytes);
	if (dims === null) return null;
	// Reject absurd sizes (spec §5.1 "dimension sanity checks").
	if (!Number.isInteger(dims.width) || !Number.isInteger(dims.height))
		return null;
	if (dims.width < 1 || dims.height < 1) return null;
	if (dims.width > 8000 || dims.height > 8000) return null;
	if (dims.width * dims.height > 64_000_000) return null;
	return dims;
}

// Limits (spec §5.1, exact).
export const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
export const MAX_VARIANT_BYTES = 3 * 1024 * 1024;
export const MAX_VARIANTS = 8;

const mediaMetaSchema = z
	.object({
		sourceWidth: z.number().int().min(1).max(8000),
		sourceHeight: z.number().int().min(1).max(8000),
		sourceBytes: z.number().int().min(1).max(MAX_SOURCE_BYTES),
		sourceMime: z.enum(["image/jpeg", "image/png", "image/webp"]),
		altDefault: z.string().max(200).default(""),
		dominantColor: z
			.string()
			.regex(/^#[0-9a-fA-F]{6}$/)
			.nullable()
			.default(null),
	})
	.strict();

export type MediaMeta = z.infer<typeof mediaMetaSchema>;

export function parseMediaMeta(json: unknown): MediaMeta | null {
	const parsed = mediaMetaSchema.safeParse(json);
	return parsed.success ? parsed.data : null;
}

export interface VariantInput {
	width: number;
	bytes: Uint8Array;
}

export type MediaCheckError =
	| "bad-mimetype"
	| "too-large"
	| "too-many"
	| "bad-dimensions"
	| "width-mismatch"
	| "aspect-mismatch"
	| "bad-meta";

export interface VariantCheck {
	width: number;
	height: number;
}

/**
 * Check variant files against the metadata. Returns the per-variant height
 * list on success (for the service to persist), else the error code. Every
 * variant must sniff as WebP (spec: only derived WebP variants are stored).
 */
export function checkVariants(
	meta: MediaMeta,
	variants: VariantInput[],
):
	| { ok: true; heights: VariantCheck[] }
	| { ok: false; code: MediaCheckError } {
	if (variants.length === 0 || variants.length > MAX_VARIANTS) {
		return { ok: false, code: "too-many" };
	}
	const seen = new Set<number>();
	const heights: VariantCheck[] = [];
	for (const v of variants) {
		if (
			!Number.isInteger(v.width) ||
			v.width < 1 ||
			v.width > meta.sourceWidth
		) {
			return { ok: false, code: "width-mismatch" };
		}
		if (seen.has(v.width)) return { ok: false, code: "width-mismatch" };
		seen.add(v.width);
		if (v.bytes.length === 0 || v.bytes.length > MAX_VARIANT_BYTES) {
			return { ok: false, code: "too-large" };
		}
		if (sniffImageKind(v.bytes) !== "webp") {
			return { ok: false, code: "bad-mimetype" };
		}
		const dims = parseDimensions("webp", v.bytes);
		if (dims === null) return { ok: false, code: "bad-dimensions" };
		if (dims.width !== v.width) return { ok: false, code: "width-mismatch" };
		// Aspect within ±0.02 of the source (spec step 2).
		const sourceAspect = meta.sourceWidth / meta.sourceHeight;
		const variantAspect = dims.width / dims.height;
		if (Math.abs(variantAspect - sourceAspect) > 0.02) {
			return { ok: false, code: "aspect-mismatch" };
		}
		heights.push({ width: v.width, height: dims.height });
	}
	return { ok: true, heights };
}
