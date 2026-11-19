import { describe, expect, it } from "vitest";
import { createHandler } from "../src/index";
import { rpc, rpcJson, testEnv, testEnvNoToken } from "./helpers";

// Migrations are applied by the root tests/setup.ts setupFile (same D1
// isolate, runs before every test file including these).

describe("bearer auth", () => {
	it("rejects requests without a token", async () => {
		const req = new Request("http://localhost/mcp", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/list",
				params: {},
			}),
		});
		const res = await createHandler(testEnv()).fetch(req);
		expect(res.status).toBe(401);
		const body = (await res.json()) as {
			error: { code: number; message: string };
		};
		expect(body.error.message).toBe("Unauthorized");
	});

	it("rejects requests with the wrong token", async () => {
		const res = await createHandler(testEnv()).fetch(
			rpc("tools/list", {}, 7, "wrong-token"),
		);
		expect(res.status).toBe(401);
		const body = (await res.json()) as {
			jsonrpc: string;
			id: unknown;
			error: { code: number };
		};
		expect(body.id).toBe(7);
		expect(body.error.code).toBe(-32000);
	});

	it("rejects when no token is configured server-side", async () => {
		const res = await createHandler(testEnvNoToken()).fetch(
			rpc("tools/list", {}),
		);
		expect(res.status).toBe(401);
	});

	it("serves tools/list with the correct token", async () => {
		const { status, body } = await rpcJson(testEnv(), "tools/list", {});
		expect(status).toBe(200);
		const names = (
			body as { result: { tools: { name: string }[] } }
		).result.tools
			.map((t) => t.name)
			.sort();
		expect(names).toEqual([
			"create-draft",
			"get-post",
			"list-posts",
			"list-tags",
			"update-draft",
		]);
	});
});
