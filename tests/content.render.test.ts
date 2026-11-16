import blockquoteHtml from "./content/__golden__/blockquote.html?raw";
import blockquoteJson from "./content/__golden__/blockquote.json?raw";
import codeHtml from "./content/__golden__/code.html?raw";
import codeJson from "./content/__golden__/code.json?raw";
import figureHtml from "./content/__golden__/figure.html?raw";
import figureJson from "./content/__golden__/figure.json?raw";
import headingHtml from "./content/__golden__/heading.html?raw";
import headingJson from "./content/__golden__/heading.json?raw";
import linksHtml from "./content/__golden__/links.html?raw";
import linksJson from "./content/__golden__/links.json?raw";
import listsHtml from "./content/__golden__/lists.html?raw";
import listsJson from "./content/__golden__/lists.json?raw";
import paragraphHtml from "./content/__golden__/paragraph.html?raw";
import paragraphJson from "./content/__golden__/paragraph.json?raw";
import { describe, expect, it } from "vitest";
import type { Locale } from "../src/config/site";
import { RenderError, renderDoc } from "../src/lib/content/render";
import { validateDoc } from "../src/lib/content/schema";
import type { Media } from "../src/server/db/schema";

// Golden files in tests/content/__golden__/<name>.{json,html}: the JSON is a
// `content` array (wrapped into a doc before validation), the HTML is the
// exact expected `renderDoc(...).html` with locale en. The figure case uses
// a synthetic media row (the seed carries none until Phase 5).
function goldenHtml(name: string, json: string, locale: Locale = "en"): string {
	const content: unknown = JSON.parse(json);
	const doc = validateDoc({ type: "doc", content });
	return renderDoc(doc, { locale, media: new Map() }).html;
}

const figureMedia: Media = {
	id: "media-1",
	r2KeyPrefix: "media-1",
	mime: "image/jpeg",
	width: 1200,
	height: 800,
	bytes: 1000,
	altDefault: "Default alt",
	dominantColor: null,
	variantsJson: "[]",
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
			expect(goldenHtml(c.name, c.json)).toBe(c.html);
		});
	}

	it("renders figure with synthetic media", () => {
		const content: unknown = JSON.parse(figureJson);
		const doc = validateDoc({ type: "doc", content });
		const { html } = renderDoc(doc, {
			locale: "en",
			media: new Map([[figureMedia.id, figureMedia]]),
		});
		expect(html).toBe(figureHtml);
	});

	it("throws RenderError for figure with unknown mediaId", () => {
		const content: unknown = JSON.parse(figureJson);
		const doc = validateDoc({ type: "doc", content });
		try {
			renderDoc(doc, { locale: "en", media: new Map() });
			expect.unreachable("unknown mediaId must throw");
		} catch (error) {
			expect(error).toBeInstanceOf(RenderError);
			expect((error as RenderError).path).toBe("content[0]");
		}
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
		const { html } = renderDoc(doc, { locale: "en", media: new Map() });
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
							marks: [{ type: "link", attrs: { href: "data:text/html,<b>x</b>" } }],
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
		const { html } = renderDoc(doc, { locale: "en", media: new Map() });
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
		const { html } = renderDoc(doc, { locale: "en", media: new Map() });
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
		const { html } = renderDoc(doc, { locale: "en", media: new Map() });
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
					content: [{ type: "text", text: "x", marks: [{ type: "underline" }] }],
				},
			],
		};
		for (const raw of [unknownNode, unknownMark]) {
			try {
				renderDoc(raw as never, { locale: "en", media: new Map() });
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
		const { html, toc } = renderDoc(doc, { locale: "en", media: new Map() });
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
			content: [{ type: "paragraph", content: [{ type: "text", text: words }] }],
		});
		const en = renderDoc(doc, { locale: "en", media: new Map() });
		const id = renderDoc(doc, { locale: "id", media: new Map() });
		expect(en.readingMinutes).toBe(2);
		expect(id.readingMinutes).toBe(2);
		const short = validateDoc({
			type: "doc",
			content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
		});
		expect(renderDoc(short, { locale: "en", media: new Map() }).readingMinutes).toBe(
			1,
		);
	});
});
