import type { D1Database } from "@cloudflare/workers-types";
import {
	createMcpHandler,
	hostHeaderValidationResponse,
	McpServer,
	originValidationResponse,
} from "@modelcontextprotocol/server";
import { registerTools } from "./tools";

export interface McpEnv {
	DB: D1Database;
	SITE_URL?: string;
	MCP_BEARER_TOKEN?: string;
}

const SERVER_VERSION = "0.1.0"; // mirrors root package.json version (fragile import of JSON avoided in workerd)

function jsonRpcError(id: unknown, code: number, message: string): Response {
	return Response.json(
		{ jsonrpc: "2.0", id: id ?? null, error: { code, message } },
		{ status: 401 },
	);
}

function extractJsonRpcId(body: unknown): unknown {
	if (typeof body !== "object" || body === null) return null;
	return (body as { id?: unknown }).id ?? null;
}

/** Constant-time bearer comparison; missing/mismatch both yield 401 with no hint. */
export async function checkBearer(
	request: Request,
	env: McpEnv,
): Promise<Response | null> {
	const expected = env.MCP_BEARER_TOKEN;
	const header = request.headers.get("Authorization");
	if (!expected || !header?.startsWith("Bearer ")) {
		return jsonRpcError(null, -32000, "Unauthorized");
	}
	const actual = header.slice("Bearer ".length);
	const enc = new TextEncoder();
	const a = enc.encode(actual);
	const b = enc.encode(expected);
	if (a.byteLength !== b.byteLength) {
		return jsonRpcError(null, -32000, "Unauthorized");
	}
	// `timingSafeEqual` exists in workerd's webcrypto but not in the bundled
	// lib.dom types; fall back to a manual constant-time loop elsewhere.
	const subtle = crypto.subtle as SubtleCrypto & {
		timingSafeEqual?: (
			x: Uint8Array,
			y: Uint8Array,
		) => boolean | Promise<boolean>;
	};
	let equal: boolean;
	if (subtle.timingSafeEqual) {
		equal = await subtle.timingSafeEqual(a, b);
	} else {
		let diff = 0;
		for (let i = 0; i < a.byteLength; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
		equal = diff === 0;
	}
	if (!equal) return jsonRpcError(null, -32000, "Unauthorized");
	return null;
}

/**
 * Host allowlist check. Synthetic `Request`s (tests) carry no Host header
 * (`Host` is a forbidden header name); in workerd the runtime-assigned
 * request URL is authoritative instead, so validate its hostname there.
 * Real traffic always has the header and takes the SDK path.
 */
function hostRejected(
	request: Request,
	allowed: string[],
): Response | undefined {
	if (request.headers.get("host") !== null) {
		return hostHeaderValidationResponse(request, allowed);
	}
	const actual = new URL(request.url).hostname;
	if (!allowed.includes(actual)) {
		return Response.json(
			{
				jsonrpc: "2.0",
				id: null,
				error: { code: -32000, message: `Invalid Host: ${actual}` },
			},
			{ status: 403 },
		);
	}
	return undefined;
}

export function createHandler(env: McpEnv) {
	const handler = createMcpHandler(
		() => {
			const server = new McpServer({ name: "gurat", version: SERVER_VERSION });
			registerTools(server, env);
			return server;
		},
		{ responseMode: "json" },
	);
	return {
		async fetch(request: Request): Promise<Response> {
			const url = new URL(request.url);
			if (url.pathname !== "/mcp")
				return new Response("Not found", { status: 404 });
			if (request.method !== "POST")
				return new Response("Method not allowed", { status: 405 });

			const host = new URL(env.SITE_URL || url.origin).hostname;
			const rejected = hostRejected(request, [host]);
			if (rejected) return rejected;
			const originRejected = originValidationResponse(request, [host]);
			if (originRejected) return originRejected;

			const authed = await checkBearer(request, env);
			if (authed) {
				// Echo the request id (if parseable) without leaking token detail.
				try {
					return Response.json(
						{
							jsonrpc: "2.0",
							id: extractJsonRpcId(await request.clone().json()),
							error: { code: -32000, message: "Unauthorized" },
						},
						{ status: 401 },
					);
				} catch {
					return authed;
				}
			}
			return handler.fetch(request, {
				authInfo: { token: "redacted", clientId: "owner", scopes: [] },
			});
		},
	};
}

export default {
	async fetch(request: Request, env: McpEnv): Promise<Response> {
		return createHandler(env).fetch(request);
	},
};
