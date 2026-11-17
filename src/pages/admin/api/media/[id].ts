import type { APIRoute } from "astro";
import {
	deleteMediaService,
	renameMediaService,
} from "../../../../server/media/service";
import { adminJson, guard, readJson, serviceResponse } from "../_guard";

export const prerender = false;

export const PUT: APIRoute = async ({ params, request }) => {
	const g = await guard(request, { mutating: true });
	if (g instanceof Response) return g;
	const id = params.id ?? "";
	return serviceResponse(
		await renameMediaService(g.db, id, await readJson(request)),
		"media",
		200,
	);
};

export const DELETE: APIRoute = async ({ params, request }) => {
	const g = await guard(request, { mutating: true });
	if (g instanceof Response) return g;
	const id = params.id ?? "";
	const result = await deleteMediaService(g.db, g.env, id);
	if (!result.ok && result.err.code === "media-in-use") {
		return adminJson(
			{
				error: "media-in-use",
				detail: { posts: result.err.detail?.split(",") ?? [] },
			},
			409,
		);
	}
	return serviceResponse(result, "result", 200);
};
