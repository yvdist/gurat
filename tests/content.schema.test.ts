import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { validateDoc } from "../src/lib/content/schema";

// Path-aware rejection: the stringified issues must contain the offending
// path segments in order (e.g. `"content",0,"attrs","level"`). This asserts
// on zod's path arrays, not on message wording.
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

describe("content schema allowlist", () => {
	it("accepts a doc exercising every allowlisted node and mark", () => {
		const doc = {
			type: "doc",
			content: [
				{
					type: "heading",
					attrs: { level: 2 },
					content: [{ type: "text", text: "Title" }],
				},
				{
					type: "heading",
					attrs: { level: 3 },
					content: [{ type: "text", text: "Sub" }],
				},
				{
					type: "heading",
					attrs: { level: 4 },
					content: [{ type: "text", text: "Deep" }],
				},
				{
					type: "paragraph",
					content: [
						{ type: "text", text: "bold", marks: [{ type: "bold" }] },
						{ type: "text", text: "italic", marks: [{ type: "italic" }] },
						{ type: "text", text: "code", marks: [{ type: "code" }] },
						{
							type: "text",
							text: "link",
							marks: [
								{
									type: "link",
									attrs: { href: "https://example.com", title: "Example" },
								},
							],
						},
						{ type: "hardBreak" },
					],
				},
				{
					type: "blockquote",
					content: [
						{ type: "paragraph", content: [{ type: "text", text: "quoted" }] },
					],
				},
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							content: [
								{ type: "paragraph", content: [{ type: "text", text: "one" }] },
							],
						},
					],
				},
				{
					type: "orderedList",
					content: [
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "first" }],
								},
							],
						},
					],
				},
				{
					type: "codeBlock",
					attrs: { language: "ts" },
					content: [{ type: "text", text: "const x = 1;" }],
				},
				{ type: "horizontalRule" },
				{
					type: "figure",
					attrs: { mediaId: "m1", alt: "alt", caption: "cap", layout: "wide" },
				},
			],
		};
		expect(validateDoc(doc).type).toBe("doc");
	});

	it("rejects heading level 1 with a path-aware error", () => {
		expectPath(
			{
				type: "doc",
				content: [{ type: "heading", attrs: { level: 1 }, content: [] }],
			},
			'"content",0,"attrs","level"',
		);
	});

	it("rejects an empty doc", () => {
		expectPath({ type: "doc", content: [] }, '"content"');
	});

	it("rejects unknown nodes, marks, and attrs with paths", () => {
		expectPath(
			{ type: "doc", content: [{ type: "table", content: [] }] },
			'"content",0',
		);
		expectPath(
			{
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [{ type: "text", text: "x", marks: [{ type: "strike" }] }],
					},
				],
			},
			'"content",0,"content",0,"marks",0',
		);
		expectPath(
			{
				type: "doc",
				content: [
					{ type: "paragraph", attrs: { align: "center" }, content: [] },
				],
			},
			'"content",0',
		);
		expectPath(
			{
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{
								type: "text",
								text: "x",
								marks: [
									{ type: "link", attrs: { href: "/", target: "_blank" } },
								],
							},
						],
					},
				],
			},
			'"content",0,"content",0,"marks",0,"attrs"',
		);
	});
});
