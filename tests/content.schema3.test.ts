import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { validateDoc } from "../src/lib/content/schema";

// Phase 3 nodes: pullquote (block), sidenote (inline), footnote (block).
// Same path-aware rejection style as tests/content.schema.test.ts.
function expectPath(doc: unknown, segments: string): void {
	try {
		validateDoc(doc);
	} catch (error) {
		expect(error).toBeInstanceOf(ZodError);
		expect(JSON.stringify((error as ZodError).issues), segments).toContain(
			segments,
		);
		return;
	}
	expect.unreachable(`must be rejected at ${segments}`);
}

describe("content schema phase-3 nodes", () => {
	it("accepts pullquote, sidenote, and footnote nodes", () => {
		const doc = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{ type: "text", text: "before " },
						{
							type: "sidenote",
							attrs: { label: "1" },
							content: [{ type: "text", text: "margin note" }],
						},
					],
				},
				{
					type: "pullquote",
					content: [
						{ type: "paragraph", content: [{ type: "text", text: "quoted" }] },
					],
				},
				{
					type: "footnote",
					content: [
						{ type: "paragraph", content: [{ type: "text", text: "note" }] },
					],
				},
			],
		};
		expect(validateDoc(doc).type).toBe("doc");
	});

	it("rejects empty pullquote, sidenote, and footnote content", () => {
		expectPath(
			{ type: "doc", content: [{ type: "pullquote", content: [] }] },
			'"content",0,"content"',
		);
		expectPath(
			{
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{ type: "sidenote", attrs: { label: "1" }, content: [] },
						],
					},
				]
			},
			'"content",0,"content",0,"content"'
		);
		expectPath(
			{ type: "doc", content: [{ type: "footnote", content: [] }] },
			'"content",0,"content"'
		);
	});

	it("rejects missing labels and unknown attrs", () => {
		expectPath(
			{
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [{ type: "sidenote", content: [{ type: "text", text: "x" }] }]
					}
				]
			},
			'"content",0,"content",0'
		);
		expectPath(
			{
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{
								type: "sidenote",
								attrs: { label: "1", side: "left" },
								content: [{ type: "text", text: "x" }]
							}
						]
					}
				]
			},
			'"content",0,"content",0,"attrs"'
		);
		expectPath(
			{
				type: "doc",
				content: [
					{
						type: "pullquote",
						content: [{ type: "paragraph", content: [] }],
						caption: "extra"
					}
				]
			},
			'"content",0'
		);
	});
});
