// Browser-only share-image generator (spec 06 §6.4). Never imported by
// workerd code (same rule as mediaClient.ts). Renders the post title on a
// 1200×630 canvas in the monochrome shell palette (near-black ground + pale
// circle, no new design) and returns a PNG blob for upload to `PUT .../og`.
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
const MAX_LINES = 3;

function wrapLines(
	ctx: CanvasRenderingContext2D,
	title: string,
	maxWidth: number,
): string[] {
	const words = title.split(/\s+/).filter((w) => w.length > 0);
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		const candidate = current === "" ? word : `${current} ${word}`;
		if (ctx.measureText(candidate).width <= maxWidth || current === "") {
			current = candidate;
		} else {
			lines.push(current);
			current = word;
			if (lines.length === MAX_LINES) break;
		}
	}
	if (lines.length < MAX_LINES && current !== "") lines.push(current);
	// Overflow: ellipsis on the last visible line.
	if (lines.length === MAX_LINES) {
		let last = lines[MAX_LINES - 1] ?? "";
		while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
			last = last.slice(0, -1);
		}
		lines[MAX_LINES - 1] = `${last}…`;
	}
	return lines;
}

export async function generateOgImage(title: string): Promise<Blob> {
	try {
		await document.fonts.ready;
	} catch {
		// Font API unavailable — serif fallback below still renders.
	}
	const canvas = document.createElement("canvas");
	canvas.width = OG_WIDTH;
	canvas.height = OG_HEIGHT;
	const ctx = canvas.getContext("2d");
	if (ctx === null) throw new Error("2d context unavailable");
	// Near-black ground (#0a0a0a sampled dark) + pale circle accent.
	ctx.fillStyle = "#0a0a0a";
	ctx.fillRect(0, 0, OG_WIDTH, OG_HEIGHT);
	ctx.fillStyle = "rgba(232, 222, 203, 0.16)";
	ctx.beginPath();
	ctx.arc(OG_WIDTH - 140, OG_HEIGHT - 120, 340, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = "#f4efe4";
	ctx.font = "600 76px Newsreader, Georgia, serif";
	ctx.textBaseline = "alphabetic";
	const lines = wrapLines(ctx, title, OG_WIDTH - 160);
	const lineHeight = 92;
	const startY = OG_HEIGHT / 2 - ((lines.length - 1) * lineHeight) / 2 + 26;
	lines.forEach((line, i) => {
		ctx.fillText(line, 80, startY + i * lineHeight);
	});
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, "image/png"),
	);
	if (blob === null) throw new Error("canvas encode failed");
	return blob;
}
