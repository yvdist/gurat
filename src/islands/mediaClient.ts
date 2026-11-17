// Browser-only media pipeline client (spec 05 §5.1). NEVER imported by
// workerd code: uses `createImageBitmap`, canvas, and `File`.
// Decodes the file, produces width variants (480/960/1600 px, never upscale)
// as WebP (quality 0.82), and computes a dominant color via 8×8 downscale
// average (used as the CLS-safe placeholder background). Re-encoding through
// canvas strips EXIF/GPS.

export interface PreparedVariant {
	w: number;
	blob: Blob;
}

export interface PreparedImage {
	sourceWidth: number;
	sourceHeight: number;
	sourceBytes: number;
	sourceMime: string;
	variants: PreparedVariant[];
	dominant: string;
}

const WIDTHS = [480, 960, 1600];
const QUALITY = 0.82;
function canvasToWebP(canvas: HTMLCanvasElement): Promise<Blob | null> {
	const { promise, resolve } = Promise.withResolvers<Blob | null>();
	canvas.toBlob(resolve, "image/webp", QUALITY);
	return promise;
}

async function drawScaled(
	source: ImageBitmap,
	w: number,
	h: number,
): Promise<HTMLCanvasElement> {
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("2d canvas unavailable");
	ctx.drawImage(source, 0, 0, w, h);
	return canvas;
}

export async function fileToVariants(file: File): Promise<PreparedImage> {
	const bitmap = await createImageBitmap(file);
	// Read dimensions BEFORE close(): a closed bitmap reports 0×0.
	const sourceWidth = bitmap.width;
	const sourceHeight = bitmap.height;
	const targets = WIDTHS.filter((w) => w <= sourceWidth);
	const widths = targets.length > 0 ? targets : [sourceWidth];
	const variants: PreparedVariant[] = [];
	for (const w of widths) {
		const h = Math.max(1, Math.round((sourceHeight * w) / sourceWidth));
		const canvas = await drawScaled(bitmap, w, h);
		const blob = await canvasToWebP(canvas);
		if (!blob) throw new Error("WebP encode failed");
		variants.push({ w, blob });
	}
	// Dominant color: 8×8 downscale average.
	const tiny = await drawScaled(bitmap, 8, 8);
	const tctx = tiny.getContext("2d");
	if (!tctx) throw new Error("2d canvas unavailable");
	const data = tctx.getImageData(0, 0, 8, 8).data;
	let r = 0;
	let g = 0;
	let b = 0;
	for (let i = 0; i < data.length; i += 4) {
		r += data[i] ?? 0;
		g += data[i + 1] ?? 0;
		b += data[i + 2] ?? 0;
	}
	const n = 64;
	const hex = (v: number): string =>
		Math.round(v / n)
			.toString(16)
			.padStart(2, "0");
	const dominant = `#${hex(r)}${hex(g)}${hex(b)}`;
	bitmap.close();
	return {
		sourceWidth,
		sourceHeight,
		sourceBytes: file.size,
		sourceMime: file.type,
		variants,
		dominant,
	};
}

export interface UploadedRef {
	id: string;
}

/** POST prepared variants + metadata to the library API. */
export async function uploadMedia(
	prepared: PreparedImage,
	altDefault: string,
): Promise<UploadedRef> {
	const form = new FormData();
	form.set(
		"meta",
		JSON.stringify({
			sourceWidth: prepared.sourceWidth,
			sourceHeight: prepared.sourceHeight,
			sourceBytes: prepared.sourceBytes,
			sourceMime: prepared.sourceMime,
			altDefault,
			dominantColor: prepared.dominant,
		}),
	);
	for (const v of prepared.variants) {
		form.set(`${v.w}.webp`, v.blob, `${v.w}.webp`);
	}
	const res = await fetch("/admin/api/media", {
		method: "POST",
		body: form,
	});
	if (!res.ok) throw new Error(`upload failed (${res.status})`);
	const data = (await res.json()) as {
		media?: { id?: string };
		error?: string;
	};
	if (typeof data.media?.id !== "string")
		throw new Error(data.error ?? "upload failed");
	return { id: data.media.id };
}
