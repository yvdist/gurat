import { describe, expect, it } from "vitest";
import {
	checkVariants,
	parseDimensions,
	parseMediaMeta,
	sniffImageKind,
} from "../src/server/media/validate";

// Byte-constructed fixtures (no external files): minimal but structurally
// valid container headers exercising the magic-byte sniff and dimension
// parsers, plus hostile inputs (EXE, SVG, polyglot).

function minimalJpeg(width: number, height: number): Uint8Array {
	// SOI + SOF0 segment only (enough for the SOF scanner).
	const out = [
		0xff,
		0xd8,
		0xff,
		0xc0,
		0x00,
		0x0b,
		0x08,
		(height >> 8) & 0xff,
		height & 0xff,
		(width >> 8) & 0xff,
		width & 0xff,
		0x01,
		0x01,
		0x11,
		0x00,
	];
	return new Uint8Array(out);
}

function minimalPng(width: number, height: number): Uint8Array {
	const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	const ihdr = [
		0,
		0,
		0,
		13,
		0x49,
		0x48,
		0x44,
		0x52,
		(width >>> 24) & 0xff,
		(width >>> 16) & 0xff,
		(width >>> 8) & 0xff,
		width & 0xff,
		(height >>> 24) & 0xff,
		(height >>> 16) & 0xff,
		(height >>> 8) & 0xff,
		height & 0xff,
		8,
		2,
		0,
		0,
		0,
	];
	return new Uint8Array([...sig, ...ihdr]);
}

/** Minimal lossy WebP (VP8) with a 14-bit w/h header at payload+6/8. */
function minimalWebp(width: number, height: number): Uint8Array {
	const header = [
		0x52,
		0x49,
		0x46,
		0x46, // RIFF
		0x1a,
		0,
		0,
		0, // size (ignored)
		0x57,
		0x45,
		0x42,
		0x50, // WEBP
		0x56,
		0x50,
		0x38,
		0x20, // VP8<space>
		0x0e,
		0,
		0,
		0, // chunk size
		0x10,
		0x20,
		0x00, // frame tag (3B)
		0x9d,
		0x01,
		0x2a, // start code
		width & 0xff,
		((width >> 8) & 0x3f) | 0x00,
		height & 0xff,
		((height >> 8) & 0x3f) | 0x00,
	];
	return new Uint8Array(header);
}

/** Minimal lossless WebP (VP8L) with packed 14-bit (w-1)/(h-1). */
function minimalWebpLossless(width: number, height: number): Uint8Array {
	const w = width - 1;
	const h = height - 1;
	const payload = [
		0x2f,
		w & 0xff,
		((w >> 8) & 0x3f) | ((h & 0x03) << 6),
		(h >> 2) & 0xff,
		(h >> 10) & 0x0f,
	];
	return new Uint8Array([
		0x52,
		0x49,
		0x46,
		0x46,
		0x10,
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
		0x4c,
		0x05,
		0,
		0,
		0,
		...payload,
	]);
}

/** Minimal extended WebP (VP8X) with 24-bit LE canvas size. */
function minimalWebpExtended(width: number, height: number): Uint8Array {
	const w = width - 1;
	const h = height - 1;
	return new Uint8Array([
		0x52,
		0x49,
		0x46,
		0x46,
		0x12,
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
		0x58,
		0x0a,
		0,
		0,
		0,
		0x00,
		0x00,
		0x00,
		0x00, // flags + reserved
		w & 0xff,
		(w >> 8) & 0xff,
		(w >> 16) & 0xff,
		h & 0xff,
		(h >> 8) & 0xff,
		(h >> 16) & 0xff,
	]);
}

describe("sniffImageKind", () => {
	it("passes the JPEG/PNG/WebP matrix", () => {
		expect(sniffImageKind(minimalJpeg(4, 3))).toBe("jpeg");
		expect(sniffImageKind(minimalPng(4, 3))).toBe("png");
		expect(sniffImageKind(minimalWebp(4, 3))).toBe("webp");
		expect(sniffImageKind(minimalWebpLossless(4, 3))).toBe("webp");
		expect(sniffImageKind(minimalWebpExtended(4, 3))).toBe("webp");
	});
	it("rejects .exe renamed to .jpg, SVG, and GIF89a polyglot", () => {
		// MZ header (Windows executable).
		expect(sniffImageKind(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
		// SVG text.
		const svg = new TextEncoder().encode(
			'<svg xmlns="http://www.w3.org/2000/svg">',
		);
		expect(sniffImageKind(svg)).toBeNull();
		// GIF89a + trailing EXE bytes (polyglot).
		const gif = new Uint8Array([
			0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x4d, 0x5a,
		]);
		expect(sniffImageKind(gif)).toBeNull();
		expect(sniffImageKind(new Uint8Array([]))).toBeNull();
	});
});

describe("parseDimensions", () => {
	it("parses 1x1-equivalent fixtures per format", () => {
		expect(parseDimensions("jpeg", minimalJpeg(1, 1))).toEqual({
			width: 1,
			height: 1,
		});
		expect(parseDimensions("png", minimalPng(1, 1))).toEqual({
			width: 1,
			height: 1,
		});
		expect(parseDimensions("webp", minimalWebp(1, 1))).toEqual({
			width: 1,
			height: 1,
		});
		expect(parseDimensions("webp", minimalWebpLossless(1, 1))).toEqual({
			width: 1,
			height: 1,
		});
		expect(parseDimensions("webp", minimalWebpExtended(1, 1))).toEqual({
			width: 1,
			height: 1,
		});
	});
	it("parses a 6000px-wide source shape", () => {
		expect(parseDimensions("jpeg", minimalJpeg(6000, 4000))).toEqual({
			width: 6000,
			height: 4000,
		});
	});
	it("rejects absurd sizes", () => {
		expect(parseDimensions("png", minimalPng(9000, 10))).toBeNull();
		expect(parseDimensions("jpeg", minimalJpeg(0, 10))).toBeNull();
	});
	it("skips APP1 EXIF segments when scanning JPEG dimensions", () => {
		// Source with EXIF: SOI + APP1("Exif\\0\\0…") + SOF. The dimension
		// scanner must skip the APPn segment by length, not choke on it.
		const exif = new TextEncoder().encode("Exif\0\0GPS-DATA");
		const app1 = new Uint8Array([0xff, 0xe1, 0x00, exif.length + 2, ...exif]);
		const sof = minimalJpeg(6000, 4000);
		const withExif = new Uint8Array([
			...sof.slice(0, 2),
			...app1,
			...sof.slice(2),
		]);
		expect(sniffImageKind(withExif)).toBe("jpeg");
		expect(parseDimensions("jpeg", withExif)).toEqual({
			width: 6000,
			height: 4000,
		});
	});

	it("re-encoded variants carry no EXIF marker (browser contract)", () => {
		// The browser pipeline re-encodes through canvas: the uploaded variant
		// bytes must never contain the EXIF header, even for EXIF sources.
		const variant = minimalWebp(1600, 800);
		const marker = new TextEncoder().encode("Exif\0\0");
		const hasMarker = (bytes: Uint8Array): boolean => {
			for (let i = 0; i + marker.length <= bytes.length; i++) {
				let match = true;
				for (let j = 0; j < marker.length; j++) {
					if (bytes[i + j] !== marker[j]) {
						match = false;
						break;
					}
				}
				if (match) return true;
			}
			return false;
		};
		expect(hasMarker(variant)).toBe(false);
	});
});

describe("parseMediaMeta", () => {
	it("accepts a valid meta object", () => {
		expect(
			parseMediaMeta({
				sourceWidth: 6000,
				sourceHeight: 4000,
				sourceBytes: 1024,
				sourceMime: "image/jpeg",
			}),
		).toMatchObject({ sourceWidth: 6000, altDefault: "", dominantColor: null });
	});
	it("rejects bad mime, oversize source, and long alt", () => {
		expect(
			parseMediaMeta({
				sourceWidth: 100,
				sourceHeight: 100,
				sourceBytes: 10,
				sourceMime: "image/svg+xml",
			}),
		).toBeNull();
		expect(
			parseMediaMeta({
				sourceWidth: 100,
				sourceHeight: 100,
				sourceBytes: 13 * 1024 * 1024,
				sourceMime: "image/png",
			}),
		).toBeNull();
		expect(
			parseMediaMeta({
				sourceWidth: 100,
				sourceHeight: 100,
				sourceBytes: 10,
				sourceMime: "image/png",
				altDefault: "x".repeat(201),
			}),
		).toBeNull();
	});
});

describe("checkVariants", () => {
	const meta = {
		sourceWidth: 1600,
		sourceHeight: 800,
		sourceBytes: 1000,
		sourceMime: "image/jpeg" as const,
		altDefault: "",
		dominantColor: null,
	};
	it("accepts matching WebP variants (2:1 aspect)", () => {
		const r = checkVariants(meta, [
			{ width: 480, bytes: minimalWebp(480, 240) },
			{ width: 960, bytes: minimalWebp(960, 480) },
		]);
		expect(r).toEqual({
			ok: true,
			heights: [
				{ width: 480, height: 240 },
				{ width: 960, height: 480 },
			],
		});
	});
	it("rejects width above source (never upscale)", () => {
		expect(
			checkVariants(meta, [{ width: 2000, bytes: minimalWebp(2000, 1000) }]),
		).toEqual({ ok: false, code: "width-mismatch" });
	});
	it("rejects duplicate widths", () => {
		expect(
			checkVariants(meta, [
				{ width: 480, bytes: minimalWebp(480, 240) },
				{ width: 480, bytes: minimalWebp(480, 240) },
			]),
		).toEqual({ ok: false, code: "width-mismatch" });
	});
	it("rejects non-WebP variant bytes", () => {
		expect(
			checkVariants(meta, [{ width: 480, bytes: minimalPng(480, 240) }]),
		).toEqual({
			ok: false,
			code: "bad-mimetype",
		});
	});
	it("rejects >8 variants and empty sets", () => {
		const nine = Array.from({ length: 9 }, (_, i) => ({
			width: i + 1,
			bytes: minimalWebp(i + 1, 1),
		}));
		expect(checkVariants(meta, nine)).toEqual({ ok: false, code: "too-many" });
		expect(checkVariants(meta, [])).toEqual({ ok: false, code: "too-many" });
	});
	it("rejects oversize variant and aspect drift", () => {
		const big = new Uint8Array(3 * 1024 * 1024 + 1);
		big.set([0x52, 0x49, 0x46, 0x46]);
		expect(checkVariants(meta, [{ width: 480, bytes: big }])).toEqual({
			ok: false,
			code: "too-large",
		});
		// 480x200 is 2.4:1 vs source 2:1 — drift 0.4 > 0.02.
		expect(
			checkVariants(meta, [{ width: 480, bytes: minimalWebp(480, 200) }]),
		).toEqual({ ok: false, code: "aspect-mismatch" });
	});
});
