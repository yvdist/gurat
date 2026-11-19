import { env } from "cloudflare:workers";
import type { McpEnv } from "../src/index";
import { createHandler } from "../src/index";

export const TOKEN = "test-bearer-token";

export function testEnv(): McpEnv {
	return { DB: env.DB, SITE_URL: "http://localhost", MCP_BEARER_TOKEN: TOKEN };
}

export function testEnvNoToken(): McpEnv {
	return {
		DB: env.DB,
		SITE_URL: "http://localhost",
		MCP_BEARER_TOKEN: undefined,
	};
}

export function rpc(
	method: string,
	params: unknown,
	id: number | string = 1,
	token: string = TOKEN,
): Request {
	return new Request("http://localhost/mcp", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
	});
}

/**
 * Stateless (pre-handshake) requests are served over SSE even with
 * `responseMode: "json"` — decode the `data:` frame into the JSON-RPC body.
 */
export async function rpcJson(
	env: McpEnv,
	method: string,
	params: unknown,
): Promise<{ status: number; body: unknown }> {
	const res = await createHandler(env).fetch(rpc(method, params));
	const text = await res.text();
	const contentType = res.headers.get("content-type") ?? "";
	if (contentType.includes("text/event-stream")) {
		const dataLine = text
			.split("\n")
			.map((l) => l.trim())
			.find((l) => l.startsWith("data:"));
		if (!dataLine)
			throw new Error(`SSE response without data frame: ${text.slice(0, 200)}`);
		return {
			status: res.status,
			body: JSON.parse(dataLine.slice("data:".length).trim()),
		};
	}
	let body: unknown = text;
	try {
		body = JSON.parse(text);
	} catch {
		// Plain-text envelope; leave raw.
	}
	return { status: res.status, body };
}

export function toolResult(body: unknown): { text: string; isError: boolean } {
	const result = (
		body as { result: { content: { text: string }[]; isError?: boolean } }
	).result;
	const text = result.content.map((c) => c.text).join("\n");
	return { text, isError: result.isError ?? false };
}
