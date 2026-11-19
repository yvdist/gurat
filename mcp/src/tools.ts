import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ServiceError } from "../../src/server/admin/service";
import {
	createPostService,
	listPostsService,
	savePostService,
} from "../../src/server/admin/service";
import type { AdminPost } from "../../src/server/db/admin";
import { getPostById } from "../../src/server/db/admin";
import { createDb } from "../../src/server/db/client";
import { listTags } from "../../src/server/db/tags";
import type { McpEnv } from "./index";

const DRAFT_ONLY =
	"Drafts only. Publishing happens manually in the /admin editor — there is no publish tool.";

const localeSchema = z.enum(["en", "id"]);

const RETRY_HINTS: Partial<Record<ServiceError["code"], string>> = {
	"slug-conflict":
		"That slug is taken in this locale. Call list-posts with q=<slug> to see the owner, then retry with a different slug.",
	concurrency:
		"The post changed since you read it. Call get-post for the latest expectedUpdatedAt, merge your edits, retry.",
};

function errText(err: ServiceError): string {
	if (err.code === "bad-request" && err.detail === "tagIds") {
		return "bad-request(400): tagIds. One or more tagIds do not exist. Call list-tags for the locale to get valid ids, then retry.";
	}
	const base =
		err.detail !== undefined
			? `${err.code}(${err.status}): ${err.detail}`
			: `${err.code}(${err.status})`;
	const hint = RETRY_HINTS[err.code];
	return hint ? `${base}. ${hint}` : base;
}

function errorResult(err: ServiceError) {
	return {
		content: [{ type: "text" as const, text: errText(err) }],
		isError: true as const,
	};
}

function row(p: AdminPost) {
	return {
		id: p.id,
		locale: p.locale,
		slug: p.slug,
		title: p.title,
		status: p.status,
		updatedAt: p.updatedAt,
	};
}

const DRAFT_ONLY_SUFFIX =
	"DRAFTS ONLY — no publish tool exists. To revise a published post, ask the owner to unpublish it in /admin first, then edit the draft.";

export function registerTools(server: McpServer, env: McpEnv): void {
	const db = createDb(env.DB);
	const baseUrl = "";

	server.registerTool(
		"list-posts",
		{
			description: `List posts (compact rows: id, locale, slug, title, status, updatedAt — never contentJson). Filters mirror the admin list. ${DRAFT_ONLY}`,
			inputSchema: z.object({
				status: z.enum(["draft", "published"]).optional(),
				locale: localeSchema.optional(),
				tagId: z.string().optional(),
				q: z.string().max(200).optional(),
				limit: z.number().int().min(1).max(200).optional(),
			}),
		},
		async (args) => {
			const posts = await listPostsService(db, args);
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(posts.map(row), null, 2),
					},
				],
			};
		},
	);

	server.registerTool(
		"get-post",
		{
			description: `Fetch one post by id (any status), including full contentJson for revision. Get expectedUpdatedAt here before update-draft. ${DRAFT_ONLY}`,
			inputSchema: z.object({ id: z.string() }),
		},
		async (args) => {
			try {
				const post = await getPostById(db, args.id);
				return {
					content: [
						{ type: "text" as const, text: JSON.stringify(post, null, 2) },
					],
				};
			} catch (err) {
				const code = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text" as const, text: `not-found(404): ${code}` }],
					isError: true as const,
				};
			}
		},
	);

	server.registerTool(
		"create-draft",
		{
			description: `Create a new DRAFT post. contentJson is a stringified Tiptap doc (see gurat://schema/content-blocks). The repo layer hardcodes status=draft — this tool can never publish. ${DRAFT_ONLY_SUFFIX}`,
			inputSchema: z.object({
				locale: localeSchema,
				slug: z.string(),
				title: z.string(),
				excerpt: z.string().optional(),
				contentJson: z.string(),
				seoDescription: z.string().nullable().optional(),
				translationGroupId: z.string().nullable().optional(),
				tagIds: z.array(z.string()).optional(),
				coverMediaId: z.string().nullable().optional(),
			}),
		},
		async (args) => {
			const result = await createPostService(db, args, { baseUrl });
			if (!result.ok) return errorResult(result.err);
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(result.value, null, 2),
					},
				],
			};
		},
	);

	server.registerTool(
		"update-draft",
		{
			description: `Save changes to a DRAFT post. expectedUpdatedAt comes from get-post/create-draft output (optimistic concurrency — stale values are rejected). Refuses published posts. ${DRAFT_ONLY_SUFFIX}`,
			inputSchema: z.object({
				id: z.string(),
				expectedUpdatedAt: z.number(),
				locale: localeSchema.optional(),
				slug: z.string().optional(),
				title: z.string().optional(),
				excerpt: z.string().optional(),
				contentJson: z.string().optional(),
				seoDescription: z.string().nullable().optional(),
				translationGroupId: z.string().nullable().optional(),
				tagIds: z.array(z.string()).optional(),
				coverMediaId: z.string().nullable().optional(),
			}),
		},
		async (args) => {
			const { id, expectedUpdatedAt, ...patch } = args;
			let current: AdminPost;
			try {
				current = await getPostById(db, id);
			} catch (err) {
				const code = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text" as const, text: `not-found(404): ${code}` }],
					isError: true as const,
				};
			}
			if (current.status === "published") {
				return {
					content: [
						{
							type: "text" as const,
							text: "forbidden(403): published posts cannot be edited via MCP — ask the owner to unpublish it in /admin first",
						},
					],
					isError: true as const,
				};
			}
			const result = await savePostService(
				db,
				id,
				{ expectedUpdatedAt, ...patch },
				{ baseUrl },
			);
			if (!result.ok) return errorResult(result.err);
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(result.value, null, 2),
					},
				],
			};
		},
	);

	server.registerTool(
		"list-tags",
		{
			description:
				"List tags for a locale (id/slug/labels only) for tag discovery. tagIds on create-draft/update-draft must reference real ids.",
			inputSchema: z.object({ locale: localeSchema }),
		},
		async (args) => {
			const tags = await listTags(db, args.locale);
			const compact = tags.map((t) => ({
				id: t.id,
				slug: t.slug,
				labelEn: t.labelEn,
				labelId: t.labelId,
			}));
			return {
				content: [
					{ type: "text" as const, text: JSON.stringify(compact, null, 2) },
				],
			};
		},
	);

	server.registerResource(
		"content-blocks",
		"gurat://schema/content-blocks",
		{ title: "Tiptap content block schema", mimeType: "text/plain" },
		async (uri) => ({
			contents: [{ uri: uri.href, text: SCHEMA_GUIDE }],
		}),
	);
}

const SCHEMA_GUIDE = `Gurat post contentJson: a JSON *string* (≤200_000 chars) of a Tiptap doc.

Top level: {"type":"doc","content":[Block,...]}. Schemas are strict — unknown
nodes, marks, or attrs fail with a path-aware zod error. Blocks:

- paragraph: {"type":"paragraph","content":[Inline]} (content optional)
- heading: {"type":"heading","attrs":{"level":2|3|4},"content":[Inline]}
- blockquote: {"type":"blockquote","content":[Block]}
- bulletList: {"type":"bulletList","content":[{"type":"listItem","content":[Block]}]}
- orderedList: same shape with "orderedList"
- codeBlock: {"type":"codeBlock","attrs":{"language":"..."},"content":[{"type":"text","text":"..."}]}
  (code content is plain text nodes only — no marks)
- horizontalRule: {"type":"horizontalRule"}
- figure: {"type":"figure","attrs":{"mediaId":"...","alt":"...","caption":"...","layout":"inline"|"offset"|"wide"|"full"|"pair"|"triptych"}}
  mediaId must be a real media id (figures with unknown ids fail at render).
- pullquote: {"type":"pullquote","content":[Block]}
- footnote: {"type":"footnote","content":[Block]}

Inline nodes: {"type":"text","text":"...","marks":[{"type":"bold"|"italic"|"code"}]}
or link marks: {"type":"link","attrs":{"href":"...","title"?:"..."}}.
Hard breaks: {"type":"hardBreak"}. Escape nothing specially — plain JSON
strings (</script>, Unicode, quotes all pass through verbatim).

Rules: coverMediaId (top-level tool arg) must be a real media id. Always start
from get-post output when revising; send the FULL doc back in contentJson.
Validation errors return "schema(422): <field.path>" — read the path, fix
that node, retry.`;
