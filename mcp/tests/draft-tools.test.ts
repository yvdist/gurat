import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getPostById, publishPost } from "../../src/server/db/admin";
import { createDb } from "../../src/server/db/client";
import { rpcJson, testEnv, toolResult } from "./helpers";

// Migrations are applied by the root tests/setup.ts setupFile (same D1
// isolate, runs before every test file including these).

describe("draft tools", () => {
	const doc = (title: string): string =>
		JSON.stringify({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: title }] },
			],
		});

	async function createDraft(
		title: string,
		extra: Record<string, unknown> = {},
	) {
		const { body } = await rpcJson(testEnv(), "tools/call", {
			name: "create-draft",
			arguments: {
				locale: "en",
				slug: `slug-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
				title,
				contentJson: doc(title),
				...extra,
			},
		});
		const { text, isError } = toolResult(body);
		expect(isError).toBe(false);
		return JSON.parse(text) as {
			id: string;
			updatedAt: number;
			status: string;
		};
	}

	it("create-draft round-trips adversarial Tiptap JSON into a draft row", async () => {
		const hostile =
			'</script><script>alert(1)</script> ünïcodé 🎉 "quotes" & <tags>';
		const longTitle = "t".repeat(300);
		const post = await createDraft(longTitle, { contentJson: doc(hostile) });
		expect(post.status).toBe("draft");

		const row = await getPostById(createDb(env.DB), post.id);
		expect(row.status).toBe("draft");
		expect(row.publishedAt).toBeNull();
		expect(JSON.parse(row.contentJson).content[0].content[0].text).toBe(
			hostile,
		);
	});

	it("create-draft with an invalid node type returns the zod path", async () => {
		const bad = JSON.stringify({
			type: "doc",
			content: [{ type: "paragraph" }, { type: "evilBlock" }],
		});
		const { body } = await rpcJson(testEnv(), "tools/call", {
			name: "create-draft",
			arguments: {
				locale: "en",
				slug: `bad-${Date.now()}`,
				title: "Bad",
				contentJson: bad,
			},
		});
		const { text, isError } = toolResult(body);
		expect(isError).toBe(true);
		expect(text).toMatch(/schema\(422\):/);
		expect(text).toContain("content.1");
	});

	it("duplicate slug returns a retry hint", async () => {
		const slug = `dup-${Date.now()}`;
		await createDraft("First", { slug } as Record<string, unknown>);
		const { body } = await rpcJson(testEnv(), "tools/call", {
			name: "create-draft",
			arguments: {
				locale: "en",
				slug,
				title: "Second",
				contentJson: doc("Second"),
			},
		});
		const { text, isError } = toolResult(body);
		expect(isError).toBe(true);
		expect(text).toMatch(/slug-conflict\(409\)/);
		expect(text).toContain("retry with a different slug");
	});

	it("unknown tagIds return a retry hint", async () => {
		const { body } = await rpcJson(testEnv(), "tools/call", {
			name: "create-draft",
			arguments: {
				locale: "en",
				slug: `tags-${Date.now()}`,
				title: "Tags",
				contentJson: doc("Tags"),
				tagIds: ["no-such-tag"],
			},
		});
		const { text, isError } = toolResult(body);
		expect(isError).toBe(true);
		expect(text).toMatch(/bad-request\(400\): tagIds/);
		expect(text).toContain("list-tags");
	});

	it("update-draft rejects stale expectedUpdatedAt", async () => {
		const post = await createDraft("Concurrency probe");
		const { body } = await rpcJson(testEnv(), "tools/call", {
			name: "update-draft",
			arguments: {
				id: post.id,
				expectedUpdatedAt: post.updatedAt - 1,
				title: "Stale write",
			},
		});
		const { text, isError } = toolResult(body);
		expect(isError).toBe(true);
		expect(text).toMatch(/concurrency\(409\)/);
	});

	it("update-draft refuses published posts", async () => {
		const post = await createDraft("Publish me");
		await publishPost(createDb(env.DB), post.id);

		const { body } = await rpcJson(testEnv(), "tools/call", {
			name: "update-draft",
			arguments: {
				id: post.id,
				expectedUpdatedAt: post.updatedAt,
				title: "Nope",
			},
		});
		const { text, isError } = toolResult(body);
		expect(isError).toBe(true);
		expect(text).toMatch(/forbidden\(403\)/);
	});

	it("list-posts never includes contentJson", async () => {
		await createDraft("List probe");
		const { status, body } = await rpcJson(testEnv(), "tools/call", {
			name: "list-posts",
			arguments: { limit: 50 },
		});
		expect(status).toBe(200);
		const { text } = toolResult(body);
		expect(text).not.toContain("contentJson");
		const rows = JSON.parse(text) as Record<string, unknown>[];
		expect(rows.length).toBeGreaterThan(0);
		for (const r of rows) {
			expect(Object.keys(r).sort()).toEqual(
				["id", "locale", "slug", "status", "title", "updatedAt"].sort(),
			);
		}
	});

	it("get-post returns full contentJson for revision", async () => {
		const post = await createDraft("Get probe");
		const { body } = await rpcJson(testEnv(), "tools/call", {
			name: "get-post",
			arguments: { id: post.id },
		});
		const { text, isError } = toolResult(body);
		expect(isError).toBe(false);
		const full = JSON.parse(text) as { contentJson: string; updatedAt: number };
		expect(typeof full.contentJson).toBe("string");
		expect(full.updatedAt).toBe(post.updatedAt);
	});
});
