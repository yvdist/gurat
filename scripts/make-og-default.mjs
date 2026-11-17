// One-time generator for the static OG fallback (spec 06 §6.4).
// Zero dependencies: hand-rolled solid-color RGB + node:zlib deflate + a
// minimal CRC32. Never runs per-request. Usage: `node scripts/make-og-default.mjs`.

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 1200;
const H = 630;
// Hero-panel palette: navy ground, pale circle accent (no text, no artwork).
const NAVY = [0x1f, 0x2b, 0x3f];
const PALE = [0xe8, 0xde, 0xcb];
const ALPHA = 0.16;
const CX = W - 140;
const CY = H - 120;
const R = 340;

const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	table[n] = c >>> 0;
}
function crc32(bytes) {
	let c = 0xffffffff;
	for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}

const raw = Buffer.alloc(W * H * 3 + H);
let o = 0;
for (let y = 0; y < H; y++) {
	raw[o++] = 0; // filter byte: none
	for (let x = 0; x < W; x++) {
		const dx = x - CX;
		const dy = y - CY;
		const inside = dx * dx + dy * dy <= R * R;
		for (let ch = 0; ch < 3; ch++) {
			raw[o++] = inside
				? Math.round(PALE[ch] * ALPHA + NAVY[ch] * (1 - ALPHA))
				: NAVY[ch];
		}
	}
}
const png = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	chunk(
		"IHDR",
		(() => {
			const d = Buffer.alloc(13);
			d.writeUInt32BE(W, 0);
			d.writeUInt32BE(H, 4);
			d[8] = 8; // bit depth
			d[9] = 2; // truecolor
			return d;
		})(),
	),
	chunk("IDAT", deflateSync(raw)),
	chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(new URL("../public/og-default.png", import.meta.url), png);
console.log(`og-default.png: ${png.length} bytes`);
