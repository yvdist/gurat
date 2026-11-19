import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { validateDoc } from "../src/lib/content/schema";

// Phase 3 nodes: pullquote (block) and footnote (block).
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
	it("accepts pullquote and footnote nodes", () => {
		const doc = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "before " }],
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

	it("rejects empty pullquote and footnote content", () => {
		expectPath(
			{ type: "doc", content: [{ type: "pullquote", content: [] }] },
			'"content",0,"content"',
		);
		expectPath(
			{ type: "doc", content: [{ type: "footnote", content: [] }] },
			'"content",0,"content"',
		);
	});

	it("rejects unknown attrs", () => {
		expectPath(
			{
				type: "doc",
				content: [
					{
						type: "pullquote",
						content: [{ type: "paragraph", content: [] }],
						caption: "extra",
					},
				],
			},
			'"content",0',
		);
	});
});
