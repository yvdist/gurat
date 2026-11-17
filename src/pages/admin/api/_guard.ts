import type { Env } from "../../../lib/env";
import { getEnv } from "../../../lib/env";
import type {
	ServiceError,
	ServiceResult,
} from "../../../server/admin/service";
import {
	AccessError,
	assertSameOrigin,
	assertSameOriginMultipart,
	requireAdminApi,
} from "../../../server/auth/access";
import type { Db } from "../../../server/db";
import { createDb } from "../../../server/db";

// Shared helpers for the thin admin API endpoints: every handler guards
// (auth, then CSRF for mutating methods), runs its service, and maps the
// result to JSON with admin no-store headers.

export interface Guarded {
	env: Env;
	db: Db;
}

/** Auth guard; returns a `Response` to send on failure, else the env+db. */
export async function guard(
	request: Request,
	opts: { mutating: boolean; multipart?: boolean },
): Promise<Guarded | Response> {
	const env = getEnv();
	try {
		await requireAdminApi(request, env, { isDev: import.meta.env.DEV });
		if (opts.mutating)
			(opts.multipart === true ? assertSameOriginMultipart : assertSameOrigin)(
				request,
				env,
			);
	} catch (res) {
		if (res instanceof Response) return res;
		if (res instanceof AccessError)
			return adminJson({ error: res.code }, res.status);
		throw res;
	}
	return { env, db: createDb(env.DB) };
}

export function adminJson(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			"X-Robots-Tag": "noindex, nofollow",
			"Cache-Control": "no-store",
		},
	});
}

function errorBody(err: ServiceError): Record<string, unknown> {
	return {
		error: err.code,
		...(err.detail !== undefined ? { detail: err.detail } : {}),
		...(err.currentUpdatedAt !== undefined
			? { currentUpdatedAt: err.currentUpdatedAt }
			: {}),
	};
}

/** Maps a `ServiceResult` to a 200/201 JSON response or its error status. */
export function serviceResponse<T>(
	result: ServiceResult<T>,
	key: string,
	successStatus = 200,
): Response {
	if (!result.ok) return adminJson(errorBody(result.err), result.err.status);
	return adminJson({ [key]: result.value }, successStatus);
}

export async function readJson(request: Request): Promise<unknown> {
	return request.json().catch(() => null);
}
