// Generates idempotent seed SQL (delete-insert in FK order) and pipes it to
// `wrangler d1 execute --local --file`. Run via `pnpm db:seed:local`.
// Repos/seed go through wrangler so dev uses the real local D1 file
// (hash-named under .wrangler/state) instead of a guessed path.
//
// Every post's `content_json` is a real Phase-2 allowlist doc (see
// `src/lib/content/schema.ts`) exercising every node/mark except `figure`
// (figures need Phase-5 media rows; they get unit coverage with a synthetic
// media map instead). Delete-insert (children first): post_tags ->
// post_media -> posts -> tags. Re running is a no-op in effect.
// Unique-violations fail loudly (constraint proof) — no upserts.
//
// `content_html`/`toc_json` written here are placeholders; the real values
// come from `pnpm db:rerender` (scripts/rerender.ts).

type SeedAttrs = Record<string, string | number | undefined>;

interface SeedMark {
	type: string;
	attrs?: SeedAttrs;
}

interface SeedInline {
	type: string;
	text?: string;
	marks?: SeedMark[];
	attrs?: SeedAttrs;
	content?: SeedInline[];
}

interface SeedNode {
	type: string;
	attrs?: SeedAttrs;
	text?: string;
	content?: (SeedNode | SeedInline)[];
}

// --- inline builders -------------------------------------------------------

function tx(text: string, ...marks: SeedMark[]): SeedInline {
	return marks.length > 0
		? { type: "text", text, marks }
		: { type: "text", text };
}

const bold = (): SeedMark => ({ type: "bold" });
const italic = (): SeedMark => ({ type: "italic" });
const code = (): SeedMark => ({ type: "code" });
const link = (href: string): SeedMark => ({ type: "link", attrs: { href } });
const br = (): SeedInline => ({ type: "hardBreak" });

// --- block builders --------------------------------------------------------

function para(...content: SeedInline[]): SeedNode {
	return { type: "paragraph", content };
}

function heading(level: 2 | 3 | 4, ...content: SeedInline[]): SeedNode {
	return { type: "heading", attrs: { level }, content };
}

function quote(...content: SeedNode[]): SeedNode {
	return { type: "blockquote", content };
}

function bullet(...items: SeedNode[][]): SeedNode {
	return {
		type: "bulletList",
		content: items.map((blocks) => ({ type: "listItem", content: blocks })),
	};
}

function ordered(...items: SeedNode[][]): SeedNode {
	return {
		type: "orderedList",
		content: items.map((blocks) => ({ type: "listItem", content: blocks })),
	};
}

function codeBlock(language: string, text: string): SeedNode {
	return {
		type: "codeBlock",
		attrs: { language },
		content: [{ type: "text", text }],
	};
}

function rule(): SeedNode {
	return { type: "horizontalRule" };
}

function sidenote(label: string, ...content: SeedInline[]): SeedInline {
	return { type: "sidenote", attrs: { label }, content };
}

function pullquote(...content: SeedNode[]): SeedNode {
	return { type: "pullquote", content };
}

function footnote(...content: SeedNode[]): SeedNode {
	return { type: "footnote", content };
}

function doc(...content: SeedNode[]): string {
	return JSON.stringify({ type: "doc", content });
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

// English docs exercise the full allowlist; Indonesian docs mirror it with
// distinct text (including a duplicated heading to prove `-2` slug dedup).
const EN_DOC = doc(
	heading(2, tx("Getting started")),
	heading(2, tx("Getting started")),
	para(
		tx("This post exercises "),
		tx("bold", bold()),
		tx(" and "),
		tx("italic", italic()),
		tx(" and "),
		tx("inline code", code()),
		tx(", plus a "),
		tx("relative link", link("/writing/second-post")),
		tx(" and an "),
		tx("external link", link("https://example.com")),
		tx("."),
		br(),
		tx("A second line after a hard break."),
	),
	quote(
		para(tx("A quoted paragraph with a ")),
		para(tx("Second quoted line.")),
	),
	bullet([para(tx("First bullet with ", bold()))], [para(tx("Second bullet"))]),
	ordered([para(tx("First step"))], [para(tx("Second step"))]),
	codeBlock("ts", 'const greeting = "hello";\nconsole.log(greeting);'),
	rule(),
	heading(3, tx("A deeper heading")),
	para(
		tx("A marginal thought sits here "),
		sidenote("1", tx("margin note one")),
		tx(" and another "),
		sidenote("2", tx("margin note two")),
		tx("."),
	),
	pullquote(para(tx("Design is the shape of the argument."))),
	para(tx("Closing paragraph.")),
	footnote(para(tx("First footnote text."))),
	footnote(para(tx("Second footnote text."))),
);

const EN_SECOND_DOC = doc(
	heading(2, tx("Notes on structure")),
	heading(3, tx("Lists")),
	heading(4, tx("Nested detail")),
	para(
		tx("Contact via "),
		tx("email", link("mailto:owner@example.com")),
		tx(" or jump to "),
		tx("the section", link("#lists")),
		tx("."),
	),
	bullet(
		[
			para(tx("Item one")),
			ordered([para(tx("Nested one"))], [para(tx("Nested two"))]),
		],
		[para(tx("Item two"))],
	),
	quote(para(tx("Single quoted line."))),
	codeBlock("sh", "pnpm install\npnpm dev"),
	rule(),
	para(tx("End of the second post.")),
);

const ID_DOC = doc(
	heading(2, tx("Memulai")),
	heading(2, tx("Memulai")),
	para(
		tx("Tulisan ini memakai "),
		tx("tebal", bold()),
		tx(" dan "),
		tx("miring", italic()),
		tx(" dan "),
		tx("kode sebaris", code()),
		tx(", serta "),
		tx("tautan relatif", link("/id/writing/tulisan-kedua")),
		tx(" dan "),
		tx("tautan luar", link("https://example.com")),
		tx("."),
		br(),
		tx("Baris kedua setelah jeda baris."),
	),
	quote(
		para(tx("Paragraf kutipan dengan sebuah ")),
		para(tx("Baris kutipan kedua.")),
	),
	bullet(
		[para(tx("Butir pertama dengan ", bold()))],
		[para(tx("Butir kedua"))],
	),
	ordered([para(tx("Langkah pertama"))], [para(tx("Langkah kedua"))]),
	codeBlock("ts", 'const salam = "halo";\nconsole.log(salam);'),
	rule(),
	heading(3, tx("Judul yang lebih dalam")),
	para(tx("Paragraf penutup.")),
);

const ID_SECOND_DOC = doc(
	heading(2, tx("Catatan tentang struktur")),
	heading(3, tx("Daftar")),
	heading(4, tx("Rincian bersarang")),
	para(
		tx("Hubungi via "),
		tx("email", link("mailto:owner@example.com")),
		tx(" atau lompat ke "),
		tx("bagian ini", link("#daftar")),
		tx("."),
	),
	bullet(
		[
			para(tx("Butir satu")),
			ordered([para(tx("Bersarang satu"))], [para(tx("Bersarang dua"))]),
		],
		[para(tx("Butir dua"))],
	),
	quote(para(tx("Satu baris kutipan."))),
	codeBlock("sh", "pnpm install\npnpm dev"),
	rule(),
	para(tx("Akhir tulisan kedua.")),
);

const DRAFT_DOC = doc(
	heading(2, tx("Work in progress")),
	para(tx("Draft body.")),
);

const FUTURE_DOC = doc(
	heading(2, tx("Terjadwal")),
	para(tx("Isi tulisan terjadwal.")),
);

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
		body: EN_DOC,
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
		body: ID_DOC,
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
		body: EN_SECOND_DOC,
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
		body: ID_SECOND_DOC,
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
		body: DRAFT_DOC,
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
		body: FUTURE_DOC,
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
		`INSERT INTO posts (id, locale, translation_group_id, slug, title, excerpt, status, published_at, content_json, content_html, toc_json, created_at, updated_at) VALUES (${esc(p.id)}, ${esc(p.locale)}, ${p.group === null ? "NULL" : esc(p.group)}, ${esc(p.slug)}, ${esc(p.title)}, ${esc(p.excerpt)}, ${esc(p.status)}, ${p.publishedAt === null ? "NULL" : String(p.publishedAt)}, ${esc(p.body)}, ${esc("<p>TODO rerender (Phase 2)</p>")}, ${esc("[]")}, ${created}, ${created});`,
	);
}
for (const [postId, tagId] of POST_TAGS) {
	lines.push(
		`INSERT INTO post_tags (post_id, tag_id) VALUES (${esc(postId)}, ${esc(tagId)});`,
	);
}

console.log(lines.join("\n"));
