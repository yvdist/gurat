import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type APIRequestContext,
	expect,
	type Page,
	test,
} from "@playwright/test";

// Media journey: EXIF-bearing 6000px JPEG → dropzone upload → picker insert
// (alt enforced) → publish → responsive public image with zero layout shift.
// Runs in the `admin` project (DEV bypass on :4322); CLS is measured against
// the production preview server (:4321) so HMR scripts can't pollute it.

const SLUG = `e2e-media-${Date.now().toString(36)}`;

async function bypassActive(request: APIRequestContext) {
	const res = await request.get("/admin/api/tags");
	return res.status() === 200;
}

test.beforeEach(async ({ request }) => {
	test.skip(
		!(await bypassActive(request)),
		"needs ADMIN_DEV_BYPASS=1 + ADMIN_EMAILS + SITE_URL=http://localhost:4322 in .dev.vars",
	);
});

/** Minimal EXIF APP1 segment with GPS tags (proves the EXIF-stripping path). */
function exifApp1WithGps(): Buffer {
	const header = Buffer.from("Exif\0\0", "latin1");
	// TIFF (little-endian): header + IFD0 (1 entry: GPS pointer) + GPS IFD
	// (2 entries: lat-ref "N", lon-ref "E") + inline ASCII values.
	const tiff = Buffer.alloc(8 + 2 + 12 + 4 + 2 + 2 * 12 + 4 + 8);
	let o = 0;
	tiff.write("II", o, 2, "latin1");
	o += 2;
	tiff.writeUInt16LE(42, o);
	o += 2;
	tiff.writeUInt32LE(8, o);
	o += 4;
	// IFD0
	tiff.writeUInt16LE(1, o);
	o += 2;
	tiff.writeUInt16LE(0x8825, o);
	o += 2; // GPSInfo tag
	tiff.writeUInt16LE(4, o);
	o += 2; // LONG
	tiff.writeUInt32LE(1, o);
	o += 4;
	const gpsOff = 8 + 2 + 12 + 4;
	tiff.writeUInt32LE(gpsOff, o);
	o += 4;
	tiff.writeUInt32LE(0, o);
	o += 4; // next IFD
	// GPS IFD
	tiff.writeUInt16LE(2, o);
	o += 2;
	// GPSLatitudeRef = "N\0"
	tiff.writeUInt16LE(0x0001, o);
	o += 2;
	tiff.writeUInt16LE(2, o);
	o += 2; // ASCII
	tiff.writeUInt32LE(2, o);
	o += 4;
	tiff.write("N\0", o, 2, "latin1");
	o += 2;
	tiff.writeUInt16LE(0, o);
	o += 2; // pad
	// GPSLongitudeRef = "E\0"
	tiff.writeUInt16LE(0x0002, o);
	o += 2;
	tiff.writeUInt16LE(2, o);
	o += 2;
	tiff.writeUInt32LE(2, o);
	o += 4;
	tiff.write("E\0", o, 2, "latin1");
	o += 2;
	tiff.writeUInt16LE(0, o);
	o += 2;
	tiff.writeUInt32LE(0, o);
	o += 4;
	const payload = Buffer.concat([header, tiff]);
	const segment = Buffer.alloc(2 + 2 + payload.length);
	segment.writeUInt16BE(0xffe1, 0);
	segment.writeUInt16BE(payload.length + 2, 2);
	payload.copy(segment, 4);
	return segment;
}

/** Render a 6000px JPEG in the browser, splice EXIF+GPS after SOI in Node. */
async function exifJpegFile(
	page: Page,
): Promise<{ path: string; dir: string }> {
	const bytes: number[] = await page.evaluate(async () => {
		const canvas = document.createElement("canvas");
		canvas.width = 6000;
		canvas.height = 4000;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("no 2d context");
		const grad = ctx.createLinearGradient(0, 0, 6000, 4000);
		grad.addColorStop(0, "#7a2e2e");
		grad.addColorStop(1, "#2e4a7a");
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, 6000, 4000);
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, "image/jpeg", 0.85),
		);
		if (!blob) throw new Error("encode failed");
		return [...new Uint8Array(await blob.arrayBuffer())];
	});
	const raw = Buffer.from(bytes);
	expect(raw[0]).toBe(0xff);
	expect(raw[1]).toBe(0xd8);
	const withExif = Buffer.concat([
		raw.subarray(0, 2),
		exifApp1WithGps(),
		raw.subarray(2),
	]);
	expect(withExif.includes(Buffer.from("Exif\0\0", "latin1"))).toBe(true);
	const dir = mkdtempSync(join(tmpdir(), "e2e-media-"));
	const path = join(dir, "gps-photo.jpg");
	writeFileSync(path, withExif);
	return { path, dir };
}

test("upload EXIF JPEG → insert with alt → publish → responsive, CLS ≈ 0", async ({
	page,
	request,
}) => {
	// 1. Build the EXIF-bearing source and upload via the library dropzone.
	const { path: uploadPath, dir } = await exifJpegFile(page);
	let mediaId = "";
	try {
		await page.goto("/admin/media");
		const before = await page.locator(".admin-media-card").count();
		await page.locator("#filepick").setInputFiles(uploadPath);
		await page
			.waitForFunction(
				(expected) =>
					document.querySelectorAll(".admin-media-card").length > expected,
				before,
				{ timeout: 60000 },
			)
			.catch(() => null);
		const cards = await page.locator(".admin-media-card").count();
		expect(cards).toBeGreaterThan(before);

		const listed = (await request
			.get("/admin/api/media")
			.then((r) => r.json())) as { media?: { id: string }[] };
		mediaId = listed.media?.[listed.media.length - 1]?.id ?? "";
		expect(mediaId).not.toBe("");

		// 2. Variants exist, sniff as WebP, carry no EXIF, never exceed source.
		const sizes: string[] = [];
		for (const w of [480, 960, 1600]) {
			const res = await request.get(`/media/${mediaId}/${w}.webp`);
			expect(res.status()).toBe(200);
			expect(res.headers()["content-type"]).toContain("image/webp");
			const buf = Buffer.from(await res.body());
			expect(buf.includes(Buffer.from("Exif\0\0", "latin1"))).toBe(false);
			expect(buf.length).toBeLessThanOrEqual(3 * 1024 * 1024);
			sizes.push(`${w}=${buf.length}`);
		}
		console.log(`E2E variants ${mediaId} bytes: ${sizes.join(" ")}`);

		// 3. New post → picker: Insert disabled until alt is provided.
		await page.goto("/admin/posts/new");
		await page.locator("#meta-slug").fill(SLUG);
		await page.locator("#meta-title").fill("E2E Media Post");
		await page.locator("#meta-excerpt").fill("E2E media excerpt");
		await page.getByRole("button", { name: "Insert image" }).click();
		const dialog = page.getByRole("dialog", { name: "Insert image" });
		await expect(dialog).toBeVisible();
		await expect(dialog.locator(`option[value="${mediaId}"]`)).toBeAttached({
			timeout: 15000,
		});
		await dialog.locator("select").first().selectOption(mediaId);
		const insertBtn = dialog.getByRole("button", {
			name: "Insert",
			exact: true,
		});
		await expect(insertBtn).toBeDisabled();
		await dialog.getByLabel("Image alt text").fill("A wide test photo");
		await expect(insertBtn).toBeEnabled();
		await insertBtn.click();

		// 4. Cover via the metadata panel, then wait for autosave to persist.
		await page.locator("#meta-cover").selectOption(mediaId);
		// `.tiptap` only: inserted figure atoms carry contenteditable=false,
		// which the shared admin-spec selector would also match.
		const editor = page.locator(".article-body .tiptap");
		await editor.click();
		await editor.pressSequentially("Body text for the media post.", {
			delay: 10,
		});
		await expect(page).toHaveURL(/\/admin\/posts\/(?!new$)[^/]+$/, {
			timeout: 15000,
		});
		const postId = page.url().split("/").pop() ?? "";

		// 5. Publish → public page shows responsive image + eager cover.
		await page.getByRole("button", { name: "Publish", exact: true }).click();
		await page.waitForURL("/admin", { timeout: 15000 });
		const pub = await request.get(`/writing/${SLUG}`);
		expect(pub.status()).toBe(200);
		const html = await pub.text();
		expect(html).toContain(`media/${mediaId}/1600.webp`);
		expect(html).toContain("srcset=");
		expect(html).toContain('width="6000"');
		expect(html).toContain('height="4000"');
		expect(html).toContain('sizes="(max-width: 1280px) 100vw, 1200px"');
		expect(html).toContain('fetchpriority="high"');

		// 6. CLS ≈ 0 on the production build (HMR-free).
		const prodPage = await request.get(`http://127.0.0.1:4321/writing/${SLUG}`);
		expect(prodPage.status()).toBe(200);
		await page.goto(`http://127.0.0.1:4321/writing/${SLUG}`);
		const cls = await page.evaluate(
			() =>
				new Promise<number>((resolve) => {
					let value = 0;
					const po = new PerformanceObserver((list) => {
						for (const entry of list.getEntries()) {
							const e = entry as PerformanceEntry & {
								value?: number;
								hadRecentInput?: boolean;
							};
							if (!e.hadRecentInput) value += e.value ?? 0;
						}
					});
					po.observe({ type: "layout-shift", buffered: true });
					window.scrollTo(0, document.body.scrollHeight);
					setTimeout(() => {
						po.disconnect();
						resolve(value);
					}, 2500);
				}),
		);
		console.log(`E2E CLS: ${cls}`);
		expect(cls).toBeLessThan(0.05);

		// 7. Cleanup: unpublish, delete post, delete (now unreferenced) media.
		await page.goto(`http://localhost:4322/admin/posts/${postId}`);
		await page.getByRole("button", { name: "Unpublish", exact: true }).click();
		await page.waitForURL("/admin", { timeout: 15000 });
		expect((await request.get(`/writing/${SLUG}`)).status()).toBe(404);
		// APIRequestContext sends no Origin; the CSRF guard needs it.
		const csrf = { Origin: "http://localhost:4322" };
		const delPost = await request.delete(`/admin/api/posts/${postId}`, {
			headers: csrf,
			data: {},
		});
		expect(delPost.status()).toBe(200);
		const delMedia = await request.delete(`/admin/api/media/${mediaId}`, {
			headers: csrf,
		});
		expect(delMedia.status()).toBe(200);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
