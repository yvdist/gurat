import type { APIRoute } from "astro";
import {
	listMediaService,
	uploadMediaService,
} from "../../../../server/media/service";
import { adminJson, guard, serviceResponse } from "../_guard";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	const g = await guard(request, { mutating: false });
	if (g instanceof Response) return g;
	return adminJson({ media: await listMediaService(g.db) }, 200);
};

export const POST: APIRoute = async ({ request }) => {
	const g = await guard(request, { mutating: true, nonJson: true });
	if (g instanceof Response) return g;
	// Multipart: files arrive via formData, not JSON.
	const form = await request.formData().catch(() => null);
	if (form === null) return adminJson({ error: "bad-request" }, 400);
	return serviceResponse(
		await uploadMediaService(g.db, g.env, form),
		"media",
		201,
	);
};
