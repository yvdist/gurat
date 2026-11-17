import type { APIRoute } from "astro";
import {
	deletePostService,
	savePostService,
} from "../../../../server/admin/service";
import { adminJson, guard, readJson, serviceResponse } from "../_guard";

export const prerender = false;

export const PUT: APIRoute = async ({ request, params }) => {
	const g = await guard(request, { mutating: true });
	if (g instanceof Response) return g;
	const id = params.id;
	if (!id) return adminJson({ error: "bad-request" }, 400);
	return serviceResponse(
		await savePostService(g.db, id, await readJson(request), {
			baseUrl: g.env.MEDIA_BASE_URL,
		}),
		"post",
	);
};

export const DELETE: APIRoute = async ({ request, params }) => {
	const g = await guard(request, { mutating: true });
	if (g instanceof Response) return g;
	const id = params.id;
	if (!id) return adminJson({ error: "bad-request" }, 400);
	const result = await deletePostService(g.db, id);
	if (!result.ok)
		return adminJson(
			{
				error: result.err.code,
				...(result.err.detail !== undefined
					? { detail: result.err.detail }
					: {}),
			},
			result.err.status,
		);
	return adminJson({ deleted: true }, 200);
};
