import { describe, expect, it } from "vitest";
import type { Locale } from "../src/config/site";
import { RenderError, renderDoc } from "../src/lib/content/render";
import { validateDoc } from "../src/lib/content/schema";
import type { Media } from "../src/server/db/schema";
import blockquoteHtml from "./content/__golden__/blockquote.html?raw";
import blockquoteJson from "./content/__golden__/blockquote.json?raw";
import codeHtml from "./content/__golden__/code.html?raw";
import codeJson from "./content/__golden__/code.json?raw";
import figureHtml from "./content/__golden__/figure.html?raw";
import figureJson from "./content/__golden__/figure.json?raw";
import figurePairHtml from "./content/__golden__/figure-pair.html?raw";
import figurePairJson from "./content/__golden__/figure-pair.json?raw";
import figureTriptychHtml from "./content/__golden__/figure-triptych.html?raw";
import figureTriptychJson from "./content/__golden__/figure-triptych.json?raw";
import headingHtml from "./content/__golden__/heading.html?raw";
import headingJson from "./content/__golden__/heading.json?raw";
import linksHtml from "./content/__golden__/links.html?raw";
import linksJson from "./content/__golden__/links.json?raw";
import listsHtml from "./content/__golden__/lists.html?raw";
import listsJson from "./content/__golden__/lists.json?raw";
import paragraphHtml from "./content/__golden__/paragraph.html?raw";
import paragraphJson from "./content/__golden__/paragraph.json?raw";

// Golden files in tests/content/__golden__/<name>.{json,html}: the JSON is a
// `content` array (wrapped into a doc before validation), the HTML is the
// exact expected `renderDoc(...).html` with locale en. The figure case uses
// a synthetic media row (the seed carries none until Phase 5).
function goldenHtml(json: string, locale: Locale = "en"): string {
	const content: unknown = JSON.parse(json);
	const doc = validateDoc({ type: "doc", content });
	return renderDoc(doc, { locale, media: new Map(), baseUrl: "" }).html;
}

const figureMedia: Media = {
	id: "media-1",
	r2KeyPrefix: "media/media-1/",
	mime: "image/webp",
	width: 1600,
	height: 800,
	bytes: 1000,
	altDefault: "Default alt",
	dominantColor: "#112233",
	variantsJson: JSON.stringify([
		{ w: 480, key: "media/media-1/480.webp", bytes: 100, mime: "image/webp" },
		{ w: 960, key: "media/media-1/960.webp", bytes: 200, mime: "image/webp" },
		{ w: 1600, key: "media/media-1/1600.webp", bytes: 300, mime: "image/webp" },
	]),
	createdAt: 0,
};

describe("renderer goldens", () => {
	const cases: { name: string; json: string; html: string }[] = [
		{ name: "paragraph", json: paragraphJson, html: paragraphHtml },
		{ name: "heading", json: headingJson, html: headingHtml },
		{ name: "blockquote", json: blockquoteJson, html: blockquoteHtml },
		{ name: "lists", json: listsJson, html: listsHtml },
		{ name: "code", json: codeJson, html: codeHtml },
		{ name: "links", json: linksJson, html: linksHtml },
	];
	for (const c of cases) {
		it(`renders ${c.name}`, () => {
			expect(goldenHtml(c.json)).toBe(c.html);
		});
	}

	it("renders figure with synthetic media", () => {
		const content: unknown = JSON.parse(figureJson);
		const doc = validateDoc({ type: "doc", content });
		const { html } = renderDoc(doc, {
			locale: "en",
			media: new Map([[figureMedia.id, figureMedia]]),
			baseUrl: "",
		});
		expect(html).toBe(figureHtml);
	});

	it.each([
		{ name: "offset", json: figureOffsetJson, html: figureOffsetHtml },
		{ name: "pair", json: figurePairJson, html: figurePairHtml },
		{ name: "triptych", json: figureTriptychJson, html: figureTriptychHtml },
	])("renders figure $name with synthetic media", ({ json, html }) => {
		const content: unknown = JSON.parse(json);
		const doc = validateDoc({ type: "doc", content });
		const { html: actual } = renderDoc(doc, {
			locale: "en",
			media: new Map([[figureMedia.id, figureMedia]]),
			baseUrl: "",
		});
		expect(actual).toBe(html);
	});

	it("throws RenderError for figure with unknown mediaId", () => {
		const content: unknown = JSON.parse(figureJson);
		const doc = validateDoc({ type: "doc", content });
		try {
			renderDoc(doc, { locale: "en", media: new Map(), baseUrl: "" });
			expect.unreachable("unknown mediaId must throw");
		} catch (error) {
			expect(error).toBeInstanceOf(RenderError);
			expect((error as RenderError).path).toBe("content[0]");
		}
	});

	it("throws RenderError for corrupt variants_json", () => {
		const bad: Media = { ...figureMedia, variantsJson: "not-json" };
		const content: unknown = JSON.parse(figureJson);
		const doc = validateDoc({ type: "doc", content });
		try {
			renderDoc(doc, {
				locale: "en",
				media: new Map([[bad.id, bad]]),
				baseUrl: "",
			});
			expect.unreachable("corrupt variants_json must throw");
		} catch (error) {
			expect(error).toBeInstanceOf(RenderError);
			expect((error as RenderError).message).toContain("bad variants_json");
		}
	});
});

describe("renderer figure output", () => {
	function figureDoc(
		attrs: Record<string, string>,
	): ReturnType<typeof validateDoc> {
		return validateDoc({
			type: "doc",
			content: [{ type: "figure", attrs }],
		});
	}
	const ctx = (media: Media, extra: Record<string, unknown> = {}) => ({
		locale: "en" as const,
		media: new Map([[media.id, media]]),
		baseUrl: "",
		...extra,
	});

	it("emits per-layout sizes", () => {
		for (const [layout, sizes, cls] of [
			["inline", "(max-width: 768px) 100vw, 68ch", "layout-inline"],
			["offset", "(max-width: 768px) 100vw, 68ch", "layout-offset"],
			["wide", "(max-width: 1280px) 100vw, 1200px", "layout-wide"],
			["full", "100vw", "layout-full"],
			// A lone pair/triptych degrades to an inline single (inline sizes).
			["pair", "(max-width: 768px) 100vw, 68ch", "layout-inline"],
			["triptych", "(max-width: 768px) 100vw, 68ch", "layout-inline"],
		] as const) {
			const html = renderDoc(
				figureDoc({ mediaId: "media-1", alt: "a", caption: "", layout }),
				ctx(figureMedia),
			).html;
			expect(html).toContain(`sizes="${sizes}"`);
			expect(html).toContain(`class="${cls}"`);
		}
	});
	it("uses cell sizes inside pair/triptych groups", () => {
		const fig = (caption: string, layout: string) => ({
			type: "figure",
			attrs: { mediaId: "media-1", alt: "a", caption, layout },
		});
		const pairHtml = renderDoc(
			validateDoc({
				type: "doc",
				content: [fig("p1", "pair"), fig("p2", "pair")],
			}),
			ctx(figureMedia),
		).html;
		expect(pairHtml).toContain('sizes="(max-width: 768px) 50vw, 600px"');
		const triHtml = renderDoc(
			validateDoc({
				type: "doc",
				content: [
					fig("t1", "triptych"),
					fig("t2", "triptych"),
					fig("t3", "triptych"),
				],
			}),
			ctx(figureMedia),
		).html;
		expect(triHtml).toContain('sizes="(max-width: 768px) 33vw, 400px"');
	});

	it("numbers groups and merges pair/triptych runs", () => {
		const pair = (id: string, caption: string, layout: string) => ({
			type: "figure",
			attrs: { mediaId: id, alt: "a", caption, layout },
		});
		// 7 groups: inline, offset, pair, triptych, wide, full, inline.
		const doc = validateDoc({
			type: "doc",
			content: [
				pair("media-1", "one", "inline"),
				pair("media-1", "two", "offset"),
				pair("media-1", "p1", "pair"),
				pair("media-1", "p2", "pair"),
				pair("media-1", "t1", "triptych"),
				pair("media-1", "t2", "triptych"),
				pair("media-1", "t3", "triptych"),
				pair("media-1", "five", "wide"),
				pair("media-1", "six", "full"),
				pair("media-1", "seven", "inline"),
			],
		});
		const html = renderDoc(doc, ctx(figureMedia)).html;
		for (const k of ["01", "02", "03", "04", "05", "06", "07"]) {
			expect(html).toContain(`${k} / 07`);
		}
		expect(html).toContain('class="layout-pair"');
		expect(html).toContain('class="layout-triptych"');
	});

	it("degrades malformed pair/triptych runs to inline singles", () => {
		const fig = (caption: string, layout: string) => ({
			type: "figure",
			attrs: { mediaId: "media-1", alt: "a", caption, layout },
		});
		// Lone pair + mixed-layout run: no group forms, two singles.
		const lone = validateDoc({
			type: "doc",
			content: [fig("lone", "pair"), fig("other", "inline")],
		});
		const loneHtml = renderDoc(lone, ctx(figureMedia)).html;
		expect(loneHtml).not.toContain("layout-pair");
		expect(loneHtml).toContain("01 / 02");
		expect(loneHtml).toContain("02 / 02");
		// 4-in-a-row triptych spill: first 3 group, 4th degrades to inline.
		const spill = validateDoc({
			type: "doc",
			content: [
				fig("s1", "triptych"),
				fig("s2", "triptych"),
				fig("s3", "triptych"),
				fig("s4", "triptych"),
			],
		});
		const spillHtml = renderDoc(spill, ctx(figureMedia)).html;
		expect(spillHtml).toContain('class="layout-triptych"');
		expect(spillHtml).toContain('class="layout-inline"');
		expect(spillHtml).toContain("01 / 02");
		expect(spillHtml).toContain("02 / 02");
	});

	it("first figure eager + fetchpriority, second lazy without fetchpriority", () => {
		const doc = validateDoc({
			type: "doc",
			content: [
				{
					type: "figure",
					attrs: {
						mediaId: "media-1",
						alt: "a",
						caption: "",
						layout: "inline",
					},
				},
				{
					type: "figure",
					attrs: {
						mediaId: "media-1",
						alt: "b",
						caption: "",
						layout: "inline",
					},
				},
			],
		});
		const html = renderDoc(doc, ctx(figureMedia)).html;
		const imgs = html.split("<img");
		expect(imgs[1]).toContain('loading="eager"');
		expect(imgs[1]).toContain('fetchpriority="high"');
		expect(imgs[2]).toContain('loading="lazy"');
		expect(imgs[2]).not.toContain("fetchpriority");
	});

	it("cover media is eager even when not first", () => {
		const other: Media = { ...figureMedia, id: "other", altDefault: "O" };
		const doc = validateDoc({
			type: "doc",
			content: [
				{
					type: "figure",
					attrs: { mediaId: "other", alt: "", caption: "", layout: "inline" },
				},
				{
					type: "figure",
					attrs: { mediaId: "media-1", alt: "", caption: "", layout: "inline" },
				},
			],
		});
		const html = renderDoc(doc, {
			locale: "en",
			media: new Map([
				[figureMedia.id, figureMedia],
				[other.id, other],
			]),
			baseUrl: "",
			coverMediaId: "media-1",
		}).html;
		// Both eager: first by position, second by cover match.
		expect(html.match(/loading="eager"/g)).toHaveLength(2);
	});

	it("escapes alt and caption; falls back to altDefault", () => {
		const html = renderDoc(
			figureDoc({
				mediaId: "media-1",
				alt: '"><script>alert(1)</script>',
				caption: "<b>bold</b>",
				layout: "inline",
			}),
			ctx(figureMedia),
		).html;
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
		expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
		const fallback = renderDoc(
			figureDoc({ mediaId: "media-1", alt: "", caption: "", layout: "inline" }),
			ctx(figureMedia),
		).html;
		expect(fallback).toContain('alt="Default alt"');
	});

	it("omits dominant style when absent or malformed; absolute baseUrl prefixes", () => {
		const noColor: Media = { ...figureMedia, dominantColor: null };
		expect(
			renderDoc(
				figureDoc({
					mediaId: "media-1",
					alt: "a",
					caption: "",
					layout: "inline",
				}),
				ctx(noColor),
			).html,
		).not.toContain("style=");
		const badColor: Media = { ...figureMedia, dominantColor: "red" };
		expect(
			renderDoc(
				figureDoc({
					mediaId: "media-1",
					alt: "a",
					caption: "",
					layout: "inline",
				}),
				ctx(badColor),
			).html,
		).not.toContain("style=");
		const absolute = renderDoc(
			figureDoc({
				mediaId: "media-1",
				alt: "a",
				caption: "",
				layout: "inline",
			}),
			ctx(figureMedia, { baseUrl: "https://media.example/" }),
		).html;
		expect(absolute).toContain(
			'src="https://media.example/media/media-1/1600.webp"',
		);
	});
});

describe("renderer XSS suite", () => {
	it("escapes script tags in text and code", () => {
		const doc = validateDoc({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: '<script>alert("x")</script>' }],
				},
				{
					type: "codeBlock",
					attrs: { language: "html" },
					content: [{ type: "text", text: "<img src=x onerror=alert(1)>" }],
				},
			],
		});
		const { html } = renderDoc(doc, {
			locale: "en",
			media: new Map(),
			baseUrl: "",
		});
		expect(html).not.toContain("<script");
		expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
		expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
	});

	it("unwraps javascript:, data:, and //-host hrefs to plain text", () => {
		const doc = validateDoc({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "evil",
							marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
						},
						{
							type: "text",
							text: "data",
							marks: [
								{ type: "link", attrs: { href: "data:text/html,<b>x</b>" } },
							],
						},
						{
							type: "text",
							text: "proto",
							marks: [{ type: "link", attrs: { href: "//evil.example/x" } }],
						},
					],
				},
			],
		});
		const { html } = renderDoc(doc, {
			locale: "en",
			media: new Map(),
			baseUrl: "",
		});
		expect(html).toBe("<p>evildataproto</p>");
		expect(html).not.toContain("<a");
	});

	it("escapes attribute injection via title and language", () => {
		const doc = validateDoc({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "t",
							marks: [
								{
									type: "link",
									attrs: { href: "/x", title: '" onmouseover="alert(1)' },
								},
							],
						},
					],
				},
				{
					type: "codeBlock",
					attrs: { language: 'x" onmouseover="alert(1)' },
					content: [{ type: "text", text: "y" }],
				},
			],
		});
		const { html } = renderDoc(doc, {
			locale: "en",
			media: new Map(),
			baseUrl: "",
		});
		expect(html).not.toContain('" onmouseover');
		expect(html).toContain("&quot; onmouseover=&quot;alert(1)");
		expect(html).toContain("<pre><code>y</code></pre>");
	});

	it("renders nested marks inside-out", () => {
		const doc = validateDoc({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "both",
							marks: [
								{ type: "bold" },
								{ type: "link", attrs: { href: "https://example.com" } },
							],
						},
					],
				},
			],
		});
		const { html } = renderDoc(doc, {
			locale: "en",
			media: new Map(),
			baseUrl: "",
		});
		expect(html).toBe(
			'<p><strong><a href="https://example.com" rel="noopener noreferrer">both</a></strong></p>',
		);
	});

	it("throws RenderError with a path for unknown nodes and marks", () => {
		const unknownNode = {
			type: "doc",
			content: [
				{
					type: "blockquote",
					content: [
						{ type: "paragraph", content: [] },
						{ type: "table", content: [] },
					],
				},
			],
		};
		const unknownMark = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{ type: "text", text: "x", marks: [{ type: "underline" }] },
					],
				},
			],
		};
		for (const raw of [unknownNode, unknownMark]) {
			try {
				renderDoc(raw as never, {
					locale: "en",
					media: new Map(),
					baseUrl: "",
				});
				expect.unreachable("unknown input must throw");
			} catch (error) {
				expect(error).toBeInstanceOf(RenderError);
				expect((error as RenderError).path.length).toBeGreaterThan(0);
			}
		}
	});

	it("dedupes repeated heading text with -2 suffixes in order", () => {
		const doc = validateDoc({
			type: "doc",
			content: [
				{
					type: "heading",
					attrs: { level: 2 },
					content: [{ type: "text", text: "Getting started" }],
				},
				{
					type: "heading",
					attrs: { level: 2 },
					content: [{ type: "text", text: "Getting started" }],
				},
				{
					type: "heading",
					attrs: { level: 3 },
					content: [{ type: "text", text: "Getting started" }],
				},
			],
		});
		const { html, toc } = renderDoc(doc, {
			locale: "en",
			media: new Map(),
			baseUrl: "",
		});
		expect(toc.map((e) => e.id)).toEqual([
			"getting-started",
			"getting-started-2",
			"getting-started-3",
		]);
		expect(html).toContain('id="getting-started-2"');
	});

	it("counts reading time per locale with Intl.Segmenter", () => {
		const words = Array.from({ length: 400 }, () => "kata").join(" ");
		const doc = validateDoc({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: words }] },
			],
		});
		const en = renderDoc(doc, { locale: "en", media: new Map(), baseUrl: "" });
		const id = renderDoc(doc, { locale: "id", media: new Map(), baseUrl: "" });
		expect(en.readingMinutes).toBe(2);
		expect(id.readingMinutes).toBe(2);
		const short = validateDoc({
			type: "doc",
			content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
		});
		expect(
			renderDoc(short, { locale: "en", media: new Map(), baseUrl: "" })
				.readingMinutes,
		).toBe(1);
	});
});
