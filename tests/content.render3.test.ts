import { describe, expect, it } from "vitest";
import { renderDoc } from "../src/lib/content/render";
import { validateDoc } from "../src/lib/content/schema";
import footnoteHtml from "./content/__golden__/footnote.html?raw";
import footnoteJson from "./content/__golden__/footnote.json?raw";
import pullquoteHtml from "./content/__golden__/pullquote.html?raw";
import pullquoteJson from "./content/__golden__/pullquote.json?raw";

// Phase 3 node goldens: the JSON is a `content` array (wrapped into a doc
// before validation), the HTML is the exact expected `renderDoc(...).html`.
function goldenHtml(json: string): string {
	const content: unknown = JSON.parse(json);
	const doc = validateDoc({ type: "doc", content });
	return renderDoc(doc, { locale: "en", media: new Map(), baseUrl: "" }).html;
}

describe("renderer phase-3 goldens", () => {
	const cases = [
		{ name: "pullquote", json: pullquoteJson, html: pullquoteHtml },
		{ name: "footnote", json: footnoteJson, html: footnoteHtml },
	];
	for (const c of cases) {
		it(`renders ${c.name}`, () => {
			expect(goldenHtml(c.json)).toBe(c.html);
		});
	}

	it("numbers footnotes in document order", () => {
		const doc = validateDoc({
			type: "doc",
			content: [
				{
					type: "footnote",
					content: [
						{ type: "paragraph", content: [{ type: "text", text: "one" }] },
					],
				},
				{
					type: "footnote",
					content: [
						{ type: "paragraph", content: [{ type: "text", text: "two" }] },
					],
				},
			],
		});
		const { html } = renderDoc(doc, {
			locale: "en",
			media: new Map(),
			baseUrl: "",
		});
		expect(html).toContain('id="fn-1"');
		expect(html).toContain('id="fn-2"');
	});

	it("keeps the same HTML for EN and ID locales", () => {
		for (const json of [pullquoteJson, footnoteJson]) {
			const content: unknown = JSON.parse(json);
			const doc = validateDoc({ type: "doc", content });
			const en = renderDoc(doc, {
				locale: "en",
				media: new Map(),
				baseUrl: "",
			}).html;
			const idHtml = renderDoc(doc, {
				locale: "id",
				media: new Map(),
				baseUrl: "",
			}).html;
			expect(idHtml).toBe(en);
		}
	});

	it("escapes footnote content", () => {
		const doc = validateDoc({
			type: "doc",
			content: [
				{
					type: "footnote",
					content: [
						{
							type: "paragraph",
							content: [{ type: "text", text: "<img src=x onerror=alert(1)>" }],
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
		expect(html).not.toContain("<script");
		expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
	});
});
