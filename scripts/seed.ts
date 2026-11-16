// Generates idempotent seed SQL (delete-insert in FK order) and pipes it to
// `wrangler d1 execute --local --file`. Run via `pnpm db:seed:local`.
// Repos/seed go through wrangler so dev uses the real local D1 file
// (hash-named under .wrangler/state) instead of a guessed path.
//
// Delete-insert (children first): post_tags -> posts -> tags. Re running is a
// no-op in effect. Unique-violations fail loudly (constraint proof) — no upserts.

function tiptapDoc(title: string, body: string): string {
	return JSON.stringify({
		type: "doc",
		content: [
			{
				type: "heading",
				attrs: { level: 1 },
				content: [{ type: "text", text: title }],
			},
			{ type: "paragraph", content: [{ type: "text", text: body }] },
		],
	});
}

const DAY = 86_400_000;
const NOW = Date.now();

const esc = (s: string): string => `'${s.replaceAll("'", "''")}'`;

interface SeedPost {
	id: string;
	locale: "en" | "id";
	group: string | null;
	slug: string;
	title: string;
	excerpt: string;
	status: "draft" | "published";
	publishedAt: number | null;
	body: string;
	ageDays: number;
}

const POSTS: SeedPost[] = [
	{
		id: "post-en-hello",
		locale: "en",
		group: "group-hello",
		slug: "hello-world",
		title: "Hello, world",
		excerpt: "First post.",
		status: "published",
		publishedAt: NOW - 10 * DAY,
		body: "First post body.",
		ageDays: 10,
	},
	{
		id: "post-id-halo",
		locale: "id",
		group: "group-hello",
		slug: "halo-dunia",
		title: "Halo, dunia",
		excerpt: "Tulisan pertama.",
		status: "published",
		publishedAt: NOW - 10 * DAY,
		body: "Isi tulisan pertama.",
		ageDays: 10,
	},
	{
		id: "post-en-second",
		locale: "en",
		group: "group-second",
		slug: "second-post",
		title:
			"A very long title that keeps going well past one hundred and fifty characters to exercise the long-title seed case in full and without truncation anywhere",
		excerpt: "Another one.",
		status: "published",
		publishedAt: NOW - 5 * DAY,
		body: "More words here.",
		ageDays: 5,
	},
	{
		id: "post-id-kedua",
		locale: "id",
		group: "group-second",
		slug: "tulisan-kedua",
		title: "Tulisan kedua",
		excerpt: "Satu lagi.",
		status: "published",
		publishedAt: NOW - 5 * DAY,
		body: "Lebih banyak kata di sini.",
		ageDays: 5,
	},
	{
		id: "post-en-draft",
		locale: "en",
		group: null,
		slug: "draft-post",
		title: "Draft post",
		excerpt: "Not yet published.",
		status: "draft",
		publishedAt: null,
		body: "Draft body.",
		ageDays: 2,
	},
	{
		id: "post-id-future",
		locale: "id",
		group: null,
		slug: "tulisan-mendatang",
		title: "Tulisan mendatang",
		excerpt: "Terjadwal.",
		status: "published",
		publishedAt: NOW + 7 * DAY,
		body: "Isi tulisan terjadwal.",
		ageDays: 1,
	},
];

const TAGS = [
	["tag-essays", "essays", "Essays", "Esai"],
	["tag-notes", "notes", "Notes", "Catatan"],
	["tag-tech", "tech", "Tech", "Teknologi"],
	["tag-journal", "journal", "Journal", "Jurnal"],
] as const;

const POST_TAGS = [
	["post-en-hello", "tag-essays"],
	["post-id-kedua", "tag-notes"],
	["post-id-halo", "tag-essays"],
	["post-en-second", "tag-notes"],
	["post-en-second", "tag-tech"],
	["post-en-second", "tag-journal"],
	["post-id-future", "tag-notes"],
] as const;

const lines: string[] = [
	"DELETE FROM post_tags;",
	"DELETE FROM post_media;",
	"DELETE FROM posts;",
	"DELETE FROM tags;",
];
for (const [id, slug, en, idLabel] of TAGS) {
	lines.push(
		`INSERT INTO tags (id, slug, label_en, label_id) VALUES (${esc(id)}, ${esc(slug)}, ${esc(en)}, ${esc(idLabel)});`,
	);
}
for (const p of POSTS) {
	const created = NOW - p.ageDays * DAY;
	lines.push(
		`INSERT INTO posts (id, locale, translation_group_id, slug, title, excerpt, status, published_at, content_json, content_html, toc_json, created_at, updated_at) VALUES (${esc(p.id)}, ${esc(p.locale)}, ${p.group === null ? "NULL" : esc(p.group)}, ${esc(p.slug)}, ${esc(p.title)}, ${esc(p.excerpt)}, ${esc(p.status)}, ${p.publishedAt === null ? "NULL" : String(p.publishedAt)}, ${esc(tiptapDoc(p.title, p.body))}, ${esc("<p>TODO rerender (Phase 2)</p>")}, ${esc("[]")}, ${created}, ${created});`,
	);
}
for (const [postId, tagId] of POST_TAGS) {
	lines.push(
		`INSERT INTO post_tags (post_id, tag_id) VALUES (${esc(postId)}, ${esc(tagId)});`,
	);
}

console.log(lines.join("\n"));
