import type { APIRoute } from "astro";
import {
	createTagService,
	listAllTagsService,
} from "../../../../server/admin/service";
import { adminJson, guard, readJson, serviceResponse } from "../_guard";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	const g = await guard(request, { mutating: false });
	if (g instanceof Response) return g;
	return adminJson({ tags: await listAllTagsService(g.db) }, 200);
};
export const POST: APIRoute = async ({ request }) => {
	const g = await guard(request, { mutating: true });
	if (g instanceof Response) return g;
	return serviceResponse(
		await createTagService(g.db, await readJson(request)),
		"tag",
		201,
	);
};
