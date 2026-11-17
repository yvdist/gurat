import type { APIRoute } from "astro";
import {
	createPostService,
	listPostsService,
	parseListQuery,
} from "../../../../server/admin/service";
import { adminJson, guard, readJson, serviceResponse } from "../_guard";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	const g = await guard(request, { mutating: false });
	if (g instanceof Response) return g;
	const query = parseListQuery(new URL(request.url).searchParams);
	if ("code" in query) return adminJson({ error: query.code }, query.status);
	return adminJson({ posts: await listPostsService(g.db, query) }, 200);
};

export const POST: APIRoute = async ({ request }) => {
	const g = await guard(request, { mutating: true });
	if (g instanceof Response) return g;
	return serviceResponse(
		await createPostService(g.db, await readJson(request)),
		"post",
		201,
	);
};
