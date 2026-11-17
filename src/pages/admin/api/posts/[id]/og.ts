import type { APIRoute } from "astro";
import {
	OG_IMAGE_MAX_BYTES,
	uploadOgImageService,
} from "../../../../../server/media/service";
import { adminJson, guard, serviceResponse } from "../../_guard";

export const prerender = false;

export const PUT: APIRoute = async ({ request, params }) => {
	const g = await guard(request, { mutating: true, nonJson: true });
	if (g instanceof Response) return g;
	const id = params.id;
	if (!id) return adminJson({ error: "bad-request" }, 400);
	// Multipart: the PNG arrives via formData, not JSON.
	const form = await request.formData().catch(() => null);
	const file =
		form !== null && form.get("image") instanceof File
			? (form.get("image") as File)
			: null;
	if (file === null) return adminJson({ error: "bad-request" }, 400);
	if (file.size > OG_IMAGE_MAX_BYTES) {
		return adminJson({ error: "too-large" }, 422);
	}
	const bytes = new Uint8Array(await file.arrayBuffer());
	return serviceResponse(
		await uploadOgImageService(g.db, g.env, id, bytes),
		"og",
		200,
	);
};
