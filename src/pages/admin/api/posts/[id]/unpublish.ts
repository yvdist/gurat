import type { APIRoute } from "astro";
import { unpublishPostService } from "../../../../../server/admin/service";
import { adminJson, guard, serviceResponse } from "../../_guard";

export const prerender = false;

export const POST: APIRoute = async ({ request, params }) => {
	const g = await guard(request, { mutating: true });
	if (g instanceof Response) return g;
	const id = params.id;
	if (!id) return adminJson({ error: "bad-request" }, 400);
	return serviceResponse(await unpublishPostService(g.db, id), "post");
};
