import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";

export const prerender = false;

const FILE_RE = /^(\d+)\.webp$/;

// Local R2 emulation (spec §5.5). Prod serves media from the public R2 custom
// domain (`MEDIA_BASE_URL`) with no Worker invocation — this route 404s in
// production builds and exists only so `astro dev` can serve the same
// same-origin `/media/...` URLs.
export const GET: APIRoute = async ({ params }) => {
	if (!import.meta.env.DEV) return new Response("Not Found", { status: 404 });
	const id = params.id ?? "";
	const file = params.file ?? "";
	if (FILE_RE.exec(file) === null) return new Response("Not Found", { status: 404 });
	const env = getEnv();
	const obj = await env.MEDIA.get(`media/${id}/${file}`);
	if (obj === null) return new Response("Not Found", { status: 404 });
	return new Response(obj.body, {
		headers: {
			"Content-Type": "image/webp",
			"Cache-Control": "public, max-age=31536000, immutable",
		},
	});
};
