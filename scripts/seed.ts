// Generates idempotent seed SQL (delete-insert in FK order) and pipes it to
// `wrangler d1 execute --local --file`. Run via `pnpm db:seed:local`.
// Repos/seed go through wrangler so dev uses the real local D1 file
// (hash-named under .wrangler/state) instead of a guessed path.
//
// Corpus: 8 translation-group essays NO.007–NO.014 (EN+ID mirrors, 16 rows)
// exercising every allowlist block incl. all five photo-figure treatments,
// plus one EN draft and one ID scheduled post. Delete-insert (children
// first): post_tags -> post_media -> posts -> tags. Re-running is a no-op
// in effect. Unique-violations fail loudly (constraint proof) — no upserts.
//
// Figure media comes from `scripts/.seed-media-map.json` (written by
// `scripts/seed-photo-media.ts`, plan Step 3); every referenced photo must
// resolve or generation aborts. Each doc is validated against the content
// schema before SQL emission; word counts are logged to stderr (plan band
// 1200–1800 per essay).
//
// `content_html`/`toc_json` written here are placeholders; the real values
// come from `pnpm db:rerender` (scripts/rerender.ts).

import { readFileSync } from "node:fs";
import { validateDoc } from "../src/lib/content/schema";

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

function codeBlock(language: string, text: string): SeedNode {
	return {
		type: "codeBlock",
		attrs: { language },
		content: [{ type: "text", text }],
	};
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

function fig(
	mediaSeed: string,
	alt: string,
	caption: string,
	layout: "inline" | "offset" | "wide" | "full" | "pair" | "triptych",
): SeedNode {
	const mediaId = MEDIA_IDS[mediaSeed];
	if (typeof mediaId !== "string" || mediaId === "") {
		throw new Error(
			`seed: no mediaId for fixture ${mediaSeed} (run scripts/seed-photo-media.ts first)`,
		);
	}
	return {
		type: "figure",
		attrs: { mediaId, alt, caption, layout },
	};
}

function doc(...content: SeedNode[]): string {
	return JSON.stringify({ type: "doc", content });
}

// --- media map (plan Step 3 output) ----------------------------------------

const MEDIA_IDS = JSON.parse(
	readFileSync(new URL("./.seed-media-map.json", import.meta.url), "utf8"),
) as Record<string, string>;
for (const seed of Array.from(
	{ length: 14 },
	(_, i) => `gurat-${String(i + 1).padStart(2, "0")}`,
)) {
	if (typeof MEDIA_IDS[seed] !== "string" || MEDIA_IDS[seed] === "") {
		throw new Error(
			`seed: fixture ${seed} missing from scripts/.seed-media-map.json`,
		);
	}
}

const DAY = 86_400_000;
const NOW = Date.now();

const esc = (s: string): string => `'${s.replaceAll("'", "''")}'`;

// Rough word count over text nodes (plan band check only; rerender computes
// the real reading time).
function wordCount(body: string): number {
	const json: unknown = JSON.parse(body);
	const texts: string[] = [];
	const walk = (node: unknown): void => {
		if (typeof node !== "object" || node === null) return;
		const n = node as Record<string, unknown>;
		if (n.type === "text" && typeof n.text === "string") texts.push(n.text);
		if (Array.isArray(n.content)) for (const c of n.content) walk(c);
	};
	walk(json);
	return texts
		.join(" ")
		.split(/\s+/)
		.filter((w) => w !== "").length;
}

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
	figureMediaIds: string[];
}
// --- NO.007 · software -------------------------------------------------------
// Rotation slot n=0: fixtures gurat-01…gurat-10.

const EN_007 = doc(
	heading(2, tx("The software that bores you is working")),
	para(
		tx(
			"There is a particular kind of program that never makes a demo reel. It starts in the morning before you arrive and it is still running when you leave, doing the same unglamorous thing it did yesterday: moving records from one queue to another, retrying the ones that fail, and writing down everything it did in a log nobody reads until something breaks. I have spent most of my career writing software like this, and I have come to believe that boredom is not the absence of craft. It is the evidence of it. Excitement in production is almost always somebody else's outage. The systems I am proudest of are the ones I never think about, the ones whose names I have to look up because nothing has paged me about them in months. This essay is a defense of that feeling, and a field manual for building things that stay boring on purpose.",
		),
	),
	fig(
		"gurat-01",
		"A quiet desk with an editor open on a passing test suite",
		"Morning build, no surprises",
		"inline",
	),
	para(
		tx("The first discipline is choosing "),
		tx("fewer moving parts", bold()),
		tx(
			" than the problem seems to invite. Every dependency you add is a small loan taken out against a future version of yourself, and the interest compounds in ",
		),
		tx("upgrade nights", italic()),
		tx(
			" and migration weekends. I keep a short list of tools I trust — a queue, a relational database, a cron runner — and I reach for anything else only after writing down why the boring option fails. The note usually talks me out of it. When I need the exact incantation I check the ",
		),
		tx("runbook", code()),
		tx(" first, then the "),
		tx("relative archive", link("/writing/no-007-quiet-discipline")),
		tx(" or the "),
		tx("upstream manual", link("https://example.com/manual")),
		tx(
			". Most clever architectures are just boring architectures with the boring parts hidden. I would rather see the boring parts. They are the parts that fail at 3 a.m., and I want to know their names before they introduce themselves.",
		),
	),
	heading(2, tx("Boring is a practice, not a property")),
	para(
		tx(
			"Nothing ships boring. Boring is something you do to software every week, the way you weed a garden, and the work is never finished because entropy never sleeps. Dependencies release major versions. Certificates expire. Disks fill. The practice is a short loop: watch one dashboard that fits on a phone screen, fix the smallest anomaly before it becomes a story, and delete one thing you no longer understand. I run this loop on Friday afternoons when my judgment is worst, because the loop is designed to be safe for tired people. ",
		),
		sidenote(
			"1",
			tx("A dashboard that needs scrolling is a dashboard nobody reads."),
		),
		tx(
			" If a check cannot be understood in ten seconds it gets simplified until it can. The goal is not perfect observability. The goal is a system so legible that a stranger could take the pager on their first day, which has happened twice, and both times the stranger thanked me for the boredom.",
		),
	),
	fig(
		"gurat-02",
		"Side-alley light falling across a notebook of checklists",
		"The Friday loop, annotated",
		"offset",
	),
	para(
		tx(
			"The second discipline is writing things down where the next person will actually look. Not in a wiki that requires a VPN and a prayer, but in the repository, next to the code, in the same plain text the code is written in. Every runbook I write answers three questions: what does normal look like, what is the single most likely way this breaks, and what is the first command to type. ",
		),
		sidenote(
			"2",
			tx(
				"Runbooks rot; I re-read mine every quarter and delete the parts that embarrass me.",
			),
		),
		tx(
			" Documentation rots, of course. All of it rots. But a short, specific document rots visibly, in a way that invites repair, while a comprehensive one rots invisibly, in a way that invites trust it no longer deserves. I prefer my rot visible. Visible rot gets weeded. Invisible rot gets paged.",
		),
	),
	heading(2, tx("Boring is a practice, not a property")),
	para(
		tx(
			"Repetition deserves a second visit, because the first time you read a heading like this it sounds like a slogan, and the second time it should sound like a schedule. Here is mine. Monday: read the error budget and the deploy log, ten minutes, no more. Wednesday: upgrade one dependency, exactly one, and watch the graphs while the coffee cools. Friday: the loop described above, thirty minutes, then close the laptop. The rest of the week belongs to building. People sometimes ask where the innovation goes in a regimen like this. It goes into the product. The infrastructure is not the place where you express yourself. The infrastructure is the place where you disappear, reliably, so that the thing you actually care about can be seen clearly by the people you built it for.",
		),
	),
	fig(
		"gurat-03",
		"Two prints of the same diff side by side",
		"Two ways to read a diff",
		"pair",
	),
	fig(
		"gurat-04",
		"A second print with margin annotations",
		"Slow review beats fast merging",
		"pair",
	),
	quote(
		para(
			tx(
				"Excitement in production is almost always somebody else's outage. Aim to be nobody's excitement.",
			),
		),
	),
	heading(3, tx("What I delete on purpose")),
	para(
		tx(
			"Deletion is the highest-leverage boring practice I know. Every quarter I remove a feature flag that has fully rolled out, an endpoint with no callers, a cron job whose output nobody consumes. Each deletion is a small proof that the system can get simpler over time, which compounds the way interest does. The code I am proudest of deleting is a caching layer that saved eleven milliseconds per request and cost two incidents per quarter. The latency went up by an amount no human can perceive. The incidents went to zero, which every human can perceive. If you want a metric for boredom, count the things you removed this quarter. A healthy count is greater than zero and smaller than the count of things you understood before removing them.",
		),
	),
	fig(
		"gurat-05",
		"Three contact sheets of deploys in different light",
		"Three states of a deploy",
		"triptych",
	),
	fig(
		"gurat-06",
		"A second contact sheet, mid-rollback",
		"Practice the rollback too",
		"triptych",
	),
	fig(
		"gurat-07",
		"A third sheet, green across the board",
		"Green is a color, not a virtue",
		"triptych",
	),
	codeBlock(
		"sh",
		"pnpm db:migrate:local && pnpm db:seed:local && pnpm db:rerender\n# watch the graphs while the coffee cools; one change at a time",
	),
	para(
		tx(
			"That is the whole deploy script for the boring parts: migrate, seed, rerender, watch. One change at a time, always, even when two changes are small, especially when two changes are small. Small changes compose into large outages more reliably than large changes do, because small changes skip the review that large changes receive. The script above looks unimpressive. It has never paged me.",
		),
	),
	fig(
		"gurat-08",
		"A wide desk panorama with monitors showing flat graphs",
		"A wide view of the monorepo",
		"wide",
	),
	pullquote(
		para(
			tx(
				"The infrastructure is not the place where you express yourself. It is the place where you disappear, reliably.",
			),
		),
	),
	heading(2, tx("An epilogue in one incident")),
	para(
		tx(
			"Last spring a queue consumer fell behind by forty minutes and nobody noticed until lunch, because the alert threshold was set for an hour and the backlog drained itself by the time anyone looked. In another era this would have been a postmortem with action items and a blameless timeline. Instead it was a footnote. ",
		),
		tx(
			"The system had enough headroom to absorb its own bad morning",
			link("#fn-1"),
		),
		tx(
			", which is the entire thesis of this essay stated as an operational fact. Boredom is headroom made visible. You cannot buy it the week you need it. You build it on Fridays, in thirty-minute increments, by deleting things and writing things down, until the day the graphs wobble and recover before lunch, and the only record is a footnote nobody needs to read.",
		),
	),
	fig(
		"gurat-09",
		"A server room door slightly ajar, full frame",
		"Full width, full attention",
		"full",
	),
	para(
		tx(
			"If you take one practice from this essay, take the Friday loop. Ten minutes of graphs, one deletion, one rewritten paragraph of runbook. Do it when you are tired, because the loop is the thing that works when you are tired, which is exactly when production prefers to fail. The reward is not dramatic. The reward is a Tuesday three years from now when someone asks who owns the quiet system that never pages, and you have to look it up, and you smile at the name, because the name is yours, and you had completely forgotten.",
		),
	),
	fig(
		"gurat-10",
		"Evening light on a closed laptop beside a tea cup",
		"Evening log, still green",
		"inline",
	),
	para(
		tx(
			"Boring software is a love letter to the future written in deletions. It says: I was here, I understood this, and I left it simpler than I found it so that you would not have to think about it either. There are flashier letters to write. I have written some of them. But the ones that lasted, the ones still running years later in rooms I will never visit, are the boring ones. They run, and run, and run, and nobody writes essays about them — except, it turns out, this one.",
		),
	),
	footnote(
		para(
			tx(
				"Headroom is the only metric that matters at 3 a.m.: spare capacity in queues, disks, error budgets, and attention. Spend Fridays buying it.",
			),
		),
	),
	footnote(
		para(
			tx(
				"The eleven-millisecond cache: removed in the spring cleanup, mourned by no one, missed by no dashboard.",
			),
		),
	),
	footnote(
		para(
			tx(
				"A note on notes: this essay's duplicated heading renders its second anchor with a -2 suffix, which is how you know the renderer counts honestly.",
			),
		),
	),
);

const ID_007 = doc(
	heading(2, tx("Perangkat lunak yang membosankan sedang bekerja")),
	para(
		tx(
			"Ada jenis program tertentu yang tidak pernah masuk video demo. Ia menyala di pagi hari sebelum Anda tiba dan masih berjalan saat Anda pulang, melakukan hal yang sama tidak glamornya seperti kemarin: memindahkan rekaman dari satu antrean ke antrean lain, mencoba lagi yang gagal, dan mencatat semua yang dikerjakannya dalam log yang tak dibaca siapa pun sampai sesuatu rusak. Sebagian besar karier saya dihabiskan menulis perangkat lunak seperti ini, dan saya sampai pada keyakinan bahwa kebosanan bukanlah ketiadaan keterampilan. Ia adalah buktinya. Kegembiraan di produksi hampir selalu berarti insiden orang lain. Sistem yang paling saya banggakan adalah yang tak pernah saya pikirkan, yang namanya harus saya cari karena sudah berbulan-bulan tidak memanggil saya. Esai ini adalah pembelaan atas perasaan itu, sekaligus panduan lapangan untuk membangun hal-hal yang tetap membosankan dengan sengaja.",
		),
	),
	fig(
		"gurat-01",
		"Meja kerja yang tenang dengan editor terbuka pada rangkaian uji yang lolos",
		"Bangun pagi tanpa kejutan",
		"inline",
	),
	para(
		tx("Disiplin pertama adalah memilih "),
		tx("bagian bergerak yang lebih sedikit", bold()),
		tx(
			" daripada yang tampaknya diminta masalah. Setiap dependensi yang Anda tambah adalah pinjaman kecil terhadap diri Anda di masa depan, dan bunganya berbunga pada ",
		),
		tx("malam-malam peningkatan versi", italic()),
		tx(
			" dan akhir pekan migrasi. Saya menyimpan daftar pendek peralatan yang saya percaya — antrean, basis data relasional, penjadwal cron — dan baru menjangkau yang lain setelah menulis mengapa opsi membosankan itu gagal. Catatan itu biasanya meyakinkan saya untuk batal. Saat butuh mantra yang tepat saya memeriksa ",
		),
		tx("runbook", code()),
		tx(" dulu, lalu "),
		tx("arsip relatif", link("/id/writing/no-007-disiplin-tenang")),
		tx(" atau "),
		tx("manual hulu", link("https://example.com/manual")),
		tx(
			". Kebanyakan arsitektur cerdas hanyalah arsitektur membosankan yang bagian membosankannya disembunyikan. Saya lebih suka melihat bagian yang membosankan. Merekalah yang gagal pukul 3 pagi, dan saya ingin tahu nama mereka sebelum mereka memperkenalkan diri.",
		),
	),
	heading(2, tx("Membosankan adalah latihan, bukan sifat")),
	para(
		tx(
			"Tidak ada yang dikirim dalam keadaan membosankan. Membosankan adalah sesuatu yang Anda lakukan pada perangkat lunak setiap minggu, seperti menyiangi kebun, dan pekerjaan itu tak pernah selesai karena entropi tak pernah tidur. Dependensi merilis versi mayor. Sertifikat kedaluwarsa. Diska penuh. Latihannya adalah lingkaran pendek: awasi satu dasbor yang muat di layar ponsel, perbaiki anomali terkecil sebelum menjadi cerita, dan hapus satu hal yang tak lagi Anda pahami. Saya menjalankan lingkaran ini pada Jumat sore saat penilaian saya terburuk, karena lingkaran ini dirancang aman untuk orang lelah. ",
		),
		sidenote(
			"1",
			tx("Dasbor yang perlu digulir adalah dasbor yang tak dibaca siapa pun."),
		),
		tx(
			" Jika sebuah pemeriksaan tak bisa dipahami dalam sepuluh detik, ia disederhanakan sampai bisa. Tujuannya bukan observabilitas sempurna. Tujuannya adalah sistem yang begitu terbaca sehingga orang asing bisa memegang pager di hari pertamanya, yang sudah terjadi dua kali, dan kedua kali orang asing itu berterima kasih atas kebosanannya.",
		),
	),
	fig(
		"gurat-02",
		"Cahaya gang samping jatuh di atas buku catatan berisi daftar periksa",
		"Lingkaran Jumat, beranotasi",
		"offset",
	),
	para(
		tx(
			"Disiplin kedua adalah menuliskan hal-hal di tempat orang berikutnya benar-benar akan melihat. Bukan di wiki yang butuh VPN dan doa, melainkan di repositori, di samping kode, dalam teks polos yang sama dengan kode itu ditulis. Setiap runbook yang saya tulis menjawab tiga pertanyaan: seperti apa keadaan normal, apa satu cara paling mungkin ini rusak, dan apa perintah pertama yang diketik. ",
		),
		sidenote(
			"2",
			tx(
				"Runbook membusuk; saya membaca ulang milik saya setiap kuartal dan menghapus bagian yang memalukan.",
			),
		),
		tx(
			" Dokumentasi membusuk, tentu saja. Semuanya membusuk. Tetapi dokumen yang pendek dan spesifik membusuk secara terlihat, dengan cara yang mengundang perbaikan, sementara yang komprehensif membusuk secara tak terlihat, dengan cara yang mengundang kepercayaan yang tak lagi pantas. Saya lebih suka pembusukan yang terlihat. Yang terlihat disiangi. Yang tak terlihat memanggil pager.",
		),
	),
	heading(2, tx("Membosankan adalah latihan, bukan sifat")),
	para(
		tx(
			"Pengulangan layak dikunjungi dua kali, karena pertama kali Anda membaca judul seperti ini terdengar seperti slogan, dan kedua kali seharusnya terdengar seperti jadwal. Inilah jadwal saya. Senin: baca anggaran error dan log deploy, sepuluh menit, tidak lebih. Rabu: tingkatkan satu dependensi, tepat satu, dan awasi grafik selagi kopi mendingin. Jumat: lingkaran di atas, tiga puluh menit, lalu tutup laptop. Sisa minggu milik membangun. Orang kadang bertanya ke mana perginya inovasi dalam rezim seperti ini. Ia pergi ke produk. Infrastruktur bukan tempat Anda mengekspresikan diri. Infrastruktur adalah tempat Anda menghilang, dengan andal, agar hal yang benar-benar Anda pedulikan bisa terlihat jelas oleh orang-orang yang Anda bangun untuk mereka.",
		),
	),
	fig(
		"gurat-03",
		"Dua cetakan diff yang sama berdampingan",
		"Dua cara membaca diff",
		"pair",
	),
	fig(
		"gurat-04",
		"Cetakan kedua dengan anotasi margin",
		"Tinjauan lambat mengalahkan gabung cepat",
		"pair",
	),
	quote(
		para(
			tx(
				"Kegembiraan di produksi hampir selalu berarti insiden orang lain. Berusahalah menjadi kegembiraan bagi tak seorang pun.",
			),
		),
	),
	heading(3, tx("Apa yang saya hapus dengan sengaja")),
	para(
		tx(
			"Penghapusan adalah latihan membosankan berdaya ungkit tertinggi yang saya kenal. Setiap kuartal saya menghapus flag fitur yang sudah sepenuhnya meluncur, endpoint tanpa pemanggil, cron job yang keluarannya tak dikonsumsi siapa pun. Setiap penghapusan adalah bukti kecil bahwa sistem bisa menjadi lebih sederhana dari waktu ke waktu, yang berbunga seperti bunga bank. Kode yang paling saya banggakan karena menghapusnya adalah lapisan cache yang menghemat sebelas milidetik per permintaan dan menelan dua insiden per kuartal. Latensinya naik sebesar yang tak bisa dirasakan manusia. Insidennya menjadi nol, yang bisa dirasakan setiap manusia. Jika Anda menginginkan metrik kebosanan, hitung hal yang Anda hapus kuartal ini. Hitungan yang sehat lebih besar dari nol dan lebih kecil dari hitungan hal yang Anda pahami sebelum menghapusnya.",
		),
	),
	fig(
		"gurat-05",
		"Tiga lembar kontak deploy dalam cahaya berbeda",
		"Tiga keadaan deploy",
		"triptych",
	),
	fig(
		"gurat-06",
		"Lembar kontak kedua, di tengah rollback",
		"Latih juga rollback-nya",
		"triptych",
	),
	fig(
		"gurat-07",
		"Lembar ketiga, hijau semua",
		"Hijau adalah warna, bukan kebajikan",
		"triptych",
	),
	codeBlock(
		"sh",
		"pnpm db:migrate:local && pnpm db:seed:local && pnpm db:rerender\n# awasi grafik selagi kopi mendingin; satu perubahan dalam satu waktu",
	),
	para(
		tx(
			"Itulah seluruh skrip deploy untuk bagian-bagian yang membosankan: migrasi, seed, render ulang, awasi. Satu perubahan dalam satu waktu, selalu, bahkan saat dua perubahan kecil, terutama saat dua perubahan kecil. Perubahan kecil tersusun menjadi insiden besar lebih andal daripada perubahan besar, karena perubahan kecil melewatkan tinjauan yang diterima perubahan besar. Skrip di atas terlihat tidak mengesankan. Ia tak pernah memanggil saya.",
		),
	),
	fig(
		"gurat-08",
		"Panorama meja lebar dengan monitor bergrafik datar",
		"Pandangan lebar atas monorepo",
		"wide",
	),
	pullquote(
		para(
			tx(
				"Infrastruktur bukan tempat Anda mengekspresikan diri. Ia adalah tempat Anda menghilang, dengan andal.",
			),
		),
	),
	heading(2, tx("Epilog dalam satu insiden")),
	para(
		tx(
			"Musim semi lalu sebuah konsumen antrean tertinggal empat puluh menit dan tak disadari siapa pun sampai makan siang, karena ambang peringatan disetel satu jam dan tumpukannya terkuras sendiri sebelum ada yang melihat. Di era lain ini akan menjadi postmortem dengan butir tindakan dan lini masa tanpa cela. Malah ia menjadi catatan kaki. ",
		),
		tx(
			"Sistem itu punya cukup ruang kepala untuk menyerap paginya yang buruk",
			link("#fn-1"),
		),
		tx(
			", yang merupakan seluruh tesis esai ini yang dinyatakan sebagai fakta operasional. Kebosanan adalah ruang kepala yang dibuat terlihat. Anda tak bisa membelinya di minggu Anda membutuhkannya. Anda membangunnya pada hari Jumat, dalam kelipatan tiga puluh menit, dengan menghapus dan menuliskan, sampai hari ketika grafik bergoyang dan pulih sebelum makan siang, dan satu-satunya catatan adalah catatan kaki yang tak perlu dibaca siapa pun.",
		),
	),
	fig(
		"gurat-09",
		"Pintu ruang server sedikit terbuka, bingkai penuh",
		"Lebar penuh, perhatian penuh",
		"full",
	),
	para(
		tx(
			"Jika Anda mengambil satu latihan dari esai ini, ambillah lingkaran Jumat. Sepuluh menit grafik, satu penghapusan, satu paragraf runbook yang ditulis ulang. Lakukan saat Anda lelah, karena lingkaran itulah yang bekerja saat Anda lelah, yaitu tepat saat produksi lebih suka gagal. Imbalannya tidak dramatis. Imbalannya adalah suatu Selasa tiga tahun dari sekarang ketika seseorang bertanya siapa pemilik sistem tenang yang tak pernah memanggil, dan Anda harus mencarinya, dan Anda tersenyum pada namanya, karena nama itu milik Anda, dan Anda sudah sepenuhnya lupa.",
		),
	),
	fig(
		"gurat-10",
		"Cahaya senja di atas laptop tertutup di samping cangkir teh",
		"Log senja, masih hijau",
		"inline",
	),
	para(
		tx(
			"Perangkat lunak yang membosankan adalah surat cinta untuk masa depan yang ditulis dengan penghapusan. Katanya: saya pernah di sini, saya memahami ini, dan saya meninggalkannya lebih sederhana daripada saat saya menemukannya agar Anda pun tak perlu memikirkannya. Ada surat-surat yang lebih mencolok untuk ditulis. Saya pernah menulis beberapa. Tetapi yang bertahan, yang masih berjalan bertahun-tahun kemudian di ruangan yang takkan pernah saya kunjungi, adalah yang membosankan. Mereka berjalan, dan berjalan, dan berjalan, dan tak ada yang menulis esai tentang mereka — kecuali, ternyata, yang ini.",
		),
	),
	footnote(
		para(
			tx(
				"Ruang kepala adalah satu-satunya metrik yang penting pukul 3 pagi: kapasitas cadangan antrean, diska, anggaran error, dan perhatian. Belilah pada hari Jumat.",
			),
		),
	),
	footnote(
		para(
			tx(
				"Cache sebelas milidetik itu: dihapus dalam bersih-bersih musim semi, tak diratapi siapa pun, tak dirindukan dasbor mana pun.",
			),
		),
	),
	footnote(
		para(
			tx(
				"Catatan tentang catatan: judul ganda esai ini me-render jangkar keduanya dengan akhiran -2, begitulah Anda tahu perender menghitung dengan jujur.",
			),
		),
	),
);
// (NO.008–NO.014, draft, scheduled, tags, and SQL emission follow.)
// --- NO.008 · film -------------------------------------------------------------
// Rotation slot n=1: fixtures gurat-06,07,08,09,10,11,12,13,14,01.

const EN_008 = doc(
	heading(2, tx("Learning to watch at the speed of the film")),
	para(
		tx(
			"The first slow film I ever finished felt like a dare. Nothing exploded, nobody explained themselves, and the camera spent four unbroken minutes watching rain cross a parking lot while I checked my watch three times and then, somewhere in the fourth minute, stopped checking. That is the entire pedagogy of slow cinema in one parking lot: attention is not something you bring to the work, it is something the work builds in you, minute by unhurried minute, until the small movements start to register as events. A hand hesitates over a door handle. A kettle takes its time. You laugh at how much these things suddenly matter. I walked out of that screening a different viewer than the one who walked in, and I have been chasing that recalibration ever since, in cinemas and out of them, because the skill transfers. Attention is attention, wherever you practice it.",
		),
	),
	fig(
		"gurat-06",
		"Rain streaking a cinema exit door at night",
		"Rain, four unbroken minutes",
		"inline",
	),
	para(
		tx("The technique underneath is disarmingly simple: "),
		tx("long takes", bold()),
		tx(
			", static frames, and a refusal to tell you where to look. Without cuts to do your seeing for you, your eyes have to do the work themselves, wandering the frame the way they wander a room. Critics call this ",
		),
		tx("contemplative cinema", italic()),
		tx(
			", which makes it sound like homework, but the viewing experience is closer to sitting by a window. My notes live in a plain-text ",
		),
		tx("viewing log", code()),
		tx("; the longer write-up sits in the "),
		tx("relative archive", link("/writing/no-008-slow-films")),
		tx(
			", and the director interviews I keep returning to are collected in an ",
		),
		tx("online notebook", link("https://example.com/slow-cinema")),
		tx(
			". The form asks for patience and repays it with interest, though never on the schedule you expect. Some films take an hour to open. One took me three viewings across two years, and the third viewing felt like the first one had finally finished loading.",
		),
	),
	heading(2, tx("Duration is the message")),
	para(
		tx(
			"Every art has a minimum interesting duration, the shortest span in which it can say what it came to say, and commercial cinema keeps convincing us that span is about ninety seconds. Slow films propose otherwise: that a shot held past comfort becomes a different kind of sentence, one whose subject is time itself. Watch a fixed frame of a kitchen for two minutes and something predictable happens. First you inventory the objects. Then you get restless. Then, if you stay, the frame starts to move without moving — steam, shadows, your own breathing — and you realize the shot was never empty. ",
		),
		sidenote(
			"1",
			tx(
				"My rule: never check the time before the first hour. The film knows what it is doing.",
			),
		),
		tx(
			" You were. Duration had to teach you how to see it, because nothing in the feed-scroll rhythm of ordinary viewing prepares the eye for a pleasure that arrives this slowly. The message is not in the frame. The message is the frame, held.",
		),
	),
	fig(
		"gurat-07",
		"An empty row of cinema seats in half-light",
		"The row nobody sits in",
		"offset",
	),
	para(
		tx(
			"I practice this deliberately now, the way musicians practice scales. One evening a month I watch something that asks for slowness and I leave the phone in another room, which is the entire technique, and somehow also the hardest part. The first twenty minutes are always negotiation: the itch, the bargaining, the phantom vibration of a device that is not even present. ",
		),
		sidenote(
			"2",
			tx(
				"Phantom vibration is real; I have felt it for a phone left two rooms away.",
			),
		),
		tx(
			" Then the negotiation ends, usually mid-shot, and the evening becomes what evenings used to be: one thing, fully attended. I take notes afterward, never during. During is for watching. Afterward I write down the three shots I remember, and they are never the three I would have predicted, which is how I know the practice is working on something deeper than taste.",
		),
	),
	heading(2, tx("Duration is the message")),
	para(
		tx(
			"Saying it twice is the point: the first statement describes the films, and the second describes everything else. Once duration teaches you its lesson, you start finding it everywhere. The long steep of tea before the first sip. The unhurried tuning of instruments before a concert, which audiences used to hear and now mostly miss. Bread rising. Paint drying, watched on purpose, which I did once on a dare from a friend and recommend exactly once. The world is full of slow cinema that nobody filmed. Attention is the projector. You carry it with you, and the festival never closes, and the tickets are free, and the only usher is your own willingness to stay in your seat past the moment of restlessness, which is always — always — where the film actually begins.",
		),
	),
	fig(
		"gurat-08",
		"Two lobby stills from the same screening",
		"Before the lights go down",
		"pair",
	),
	fig(
		"gurat-09",
		"A second still with latecomers finding seats",
		"Latecomers, forgiven",
		"pair",
	),
	quote(
		para(
			tx(
				"Attention is not something you bring to the work. It is something the work builds in you.",
			),
		),
	),
	heading(3, tx("A syllabus of slowness")),
	para(
		tx(
			"Start with a short film, not a three-hour monument; the muscle builds faster with repetitions than with ordeals. Watch it twice in one week, once for the story your habits demand and once for everything your habits missed. Then lengthen the takes: a festival sidebar, a retrospective, a rainy Sunday given entirely to one director. Keep the log. Date every entry. The log will embarrass you within a year — mine from last spring reads like dispatches from a much more impatient person — and that embarrassment is the diploma. You will also, without deciding to, start watching everything else differently: conversations, streets, the way light leaves a room at dusk. The syllabus ends where it began, in a parking lot in the rain, except now four minutes feels exactly as long as it is, which is to say, exactly long enough.",
		),
	),
	fig(
		"gurat-10",
		"Three frames of rain on glass at different exposures",
		"Rain, three exposures",
		"triptych",
	),
	fig(
		"gurat-11",
		"A second study in window light",
		"Window light, held",
		"triptych",
	),
	fig(
		"gurat-12",
		"A third study as the room darkens",
		"Dusk does the editing",
		"triptych",
	),
	codeBlock(
		"text",
		"evening rite:\n  phone -> other room\n  lights -> low\n  runtime -> whatever it is\n  notes -> after, never during",
	),
	para(
		tx(
			"That is the whole rite, and it fits on an index card, and it has never failed to change the evening. The card lives on my shelf next to the tickets. Some evenings the film is mediocre and the rite carries it. Some evenings the film is great and the rite disappears inside it. Both outcomes beat the third option, which is the evening dissolved into forty half-watched things and remembered as nothing. The rite is not about cinema. It is about refusing the dissolution, one evening a month, on purpose.",
		),
	),
	fig(
		"gurat-13",
		"A wide empty auditorium from the projection booth",
		"A wide view of the auditorium",
		"wide",
	),
	pullquote(
		para(
			tx(
				"The world is full of slow cinema that nobody filmed. Attention is the projector.",
			),
		),
	),
	heading(2, tx("Coda: the parking lot, revisited")),
	para(
		tx(
			"Years later I found the parking lot film streaming at midnight and watched it alone on a laptop, which should have been a desecration and turned out to be a reunion. I knew every shot and remembered none of my restlessness; the four minutes of rain felt, impossibly, too short. ",
		),
		tx(
			"The film had not changed at all, which meant the change was mine",
			link("#fn-1"),
		),
		tx(
			" to keep. That is the quiet contract slow cinema offers: give it your duration and it returns your attention, upgraded. I keep the ticket stub from the first screening in the viewing log, faded to near-blank, which feels exactly right. The stub is empty now. The attention is full. Some exchanges are that simple, and that slow, and that worth it.",
		),
	),
	fig(
		"gurat-14",
		"Headlights crossing an empty lot in full frame",
		"Full width, full attention",
		"full",
	),
	para(
		tx(
			"If you take one practice from this essay, take the monthly evening. Phone in another room, something slow, notes afterward. The first twenty minutes will negotiate. Let them. The negotiation always ends, and what waits past it is the thing you actually sat down for: the feeling of your own attention settling, like sediment clearing from water, until everything in the frame — and, later, everything outside it — is visible again.",
		),
	),
	fig(
		"gurat-01",
		"Morning after: the same lot in daylight",
		"Morning after, still lot",
		"inline",
	),
	para(
		tx(
			"Slow films taught me that boredom is usually attention arriving early to a place the eyes have not caught up with yet. Wait with it. The eyes catch up. And when they do, the parking lot in the rain turns out to have been an ocean all along, four minutes wide, and you were swimming in it the whole time, holding your breath for no reason, learning — the slowest possible way, which is the only way that lasts — how to see.",
		),
	),
	footnote(
		para(
			tx(
				"The four-minute rain shot: one take, no coverage, reportedly filmed because the crew's van broke down. Constraint as co-director.",
			),
		),
	),
	footnote(
		para(
			tx(
				"Phantom vibration has been studied; the phone need not be present. Attention, it seems, vibrates on its own.",
			),
		),
	),
	footnote(
		para(
			tx(
				"This essay's doubled heading renders its second anchor with a -2 suffix — duration, counted twice, counted honestly.",
			),
		),
	),
);

const ID_008 = doc(
	heading(2, tx("Belajar menonton secepat filmnya")),
	para(
		tx(
			"Film lambat pertama yang pernah saya selesaikan terasa seperti tantangan. Tak ada yang meledak, tak ada yang menjelaskan diri, dan kamera menghabiskan empat menit tanpa putus menatap hujan menyeberangi pelataran parkir sementara saya melirik jam tiga kali lalu, entah di menit keempat, berhenti melirik. Itulah seluruh pedagogi sinema lambat dalam satu pelataran parkir: perhatian bukanlah sesuatu yang Anda bawa ke karya itu, melainkan sesuatu yang dibangun karya itu di dalam Anda, menit demi menit yang tak tergesa, sampai gerakan-gerakan kecil mulai tercatat sebagai peristiwa. Tangan ragu di atas gagang pintu. Ketel yang tidak terburu-buru. Anda tertawa menyadari betapa berartinya hal-hal itu tiba-tiba. Saya keluar dari pemutaran itu sebagai penonton yang berbeda dari yang masuk, dan saya mengejar penyetelan ulang itu sejak itu, di bioskop maupun di luar, karena keterampilannya menular. Perhatian tetaplah perhatian, di mana pun Anda melatihnya.",
		),
	),
	fig(
		"gurat-06",
		"Hujan menggarisi pintu keluar bioskop di malam hari",
		"Hujan, empat menit tanpa putus",
		"inline",
	),
	para(
		tx("Teknik di baliknya sederhana hingga menipu: "),
		tx("pengambilan panjang", bold()),
		tx(
			", bingkai statis, dan penolakan untuk memberi tahu Anda ke mana harus melihat. Tanpa potongan yang melihatkan untuk Anda, mata Anda harus bekerja sendiri, menjelajahi bingkai seperti menjelajahi ruangan. Kritikus menyebutnya ",
		),
		tx("sinema kontemplatif", italic()),
		tx(
			", yang terdengar seperti PR, tetapi pengalaman menontonnya lebih mirip duduk di tepi jendela. Catatan saya tinggal dalam ",
		),
		tx("log tontonan", code()),
		tx(" teks polos; tulisan yang lebih panjang ada di "),
		tx("arsip relatif", link("/id/writing/no-008-film-lambat")),
		tx(", dan wawancara sutradara yang terus saya kunjungi terkumpul dalam "),
		tx("buku catatan daring", link("https://example.com/slow-cinema")),
		tx(
			". Bentuk ini meminta kesabaran dan membayarnya dengan bunga, meski tak pernah sesuai jadwal yang Anda harapkan. Sebagian film butuh satu jam untuk terbuka. Satu film butuh tiga kali tonton selama dua tahun, dan tontonan ketiga terasa seperti tontonan pertama yang akhirnya selesai memuat.",
		),
	),
	heading(2, tx("Durasi adalah pesannya")),
	para(
		tx(
			"Setiap seni punya durasi minimum yang menarik, rentang terpendek di mana ia bisa mengatakan maksud kedatangannya, dan sinema komersial terus meyakinkan kita bahwa rentang itu sekitar sembilan puluh detik. Film-film lambat mengusulkan sebaliknya: bahwa bidikan yang ditahan melewati nyaman menjadi jenis kalimat yang berbeda, yang subjeknya adalah waktu itu sendiri. Tatap bingkai tetap sebuah dapur selama dua menit dan sesuatu yang dapat diprediksi terjadi. Pertama Anda menginventarisasi benda. Lalu Anda gelisah. Lalu, jika Anda tinggal, bingkai itu mulai bergerak tanpa bergerak — uap, bayangan, napas Anda sendiri — dan Anda sadar bidikan itu tak pernah kosong. ",
		),
		sidenote(
			"1",
			tx(
				"Aturan saya: jangan pernah melihat jam sebelum satu jam pertama. Film itu tahu apa yang dilakukannya.",
			),
		),
		tx(
			" Andalah yang kosong. Durasi harus mengajari Anda cara melihatnya, karena tak ada dalam ritme umpan-gulir tontonan biasa yang menyiapkan mata untuk kenikmatan yang tiba selambat ini. Pesan itu tidak ada dalam bingkai. Pesan itu adalah bingkai itu, yang ditahan.",
		),
	),
	fig(
		"gurat-07",
		"Deretan kursi bioskop kosong dalam setengah cahaya",
		"Deretan yang tak diduduki siapa pun",
		"offset",
	),
	para(
		tx(
			"Saya melatih ini dengan sengaja sekarang, seperti musisi berlatih tangga nada. Sebulan sekali saya menonton sesuatu yang meminta kelambatan dan saya meninggalkan ponsel di ruangan lain, yang merupakan seluruh tekniknya, sekaligus bagian tersulitnya. Dua puluh menit pertama selalu negosiasi: gatal itu, tawar-menawar itu, getaran hantu dari perangkat yang bahkan tidak ada. ",
		),
		sidenote(
			"2",
			tx(
				"Getaran hantu itu nyata; saya pernah merasakannya untuk ponsel yang tertinggal dua ruangan.",
			),
		),
		tx(
			" Lalu negosiasi berakhir, biasanya di tengah bidikan, dan malam itu menjadi seperti malam-malam dulu: satu hal, dihadiri penuh. Saya mencatat setelahnya, tak pernah selama. Selama adalah untuk menonton. Setelahnya saya menulis tiga bidikan yang saya ingat, dan tak pernah tiga yang saya duga, begitulah saya tahu latihan ini bekerja pada sesuatu yang lebih dalam dari selera.",
		),
	),
	heading(2, tx("Durasi adalah pesannya")),
	para(
		tx(
			"Mengatakannya dua kali adalah intinya: pernyataan pertama menggambarkan film-film itu, dan yang kedua menggambarkan segala yang lain. Begitu durasi mengajarkan pelajarannya, Anda mulai menemukannya di mana-mana. Seduhan teh yang lama sebelum tegukan pertama. Penyeteman instrumen yang tak tergesa sebelum konser, yang dulu terdengar penonton dan kini kebanyakan terlewat. Roti mengembang. Cat mengering, ditatap dengan sengaja, yang pernah saya lakukan sekali karena tantangan teman dan saya rekomendasikan tepat sekali. Dunia penuh sinema lambat yang tak pernah difilmkan siapa pun. Perhatian adalah proyektornya. Anda membawanya ke mana pun, dan festivalnya tak pernah tutup, dan tiketnya gratis, dan satu-satunya petugas adalah kesediaan Anda sendiri untuk tetap di kursi melewati momen gelisah, yang selalu — selalu — merupakan tempat film itu benar-benar dimulai.",
		),
	),
	fig(
		"gurat-08",
		"Dua gambar lobi dari pemutaran yang sama",
		"Sebelum lampu padam",
		"pair",
	),
	fig(
		"gurat-09",
		"Gambar kedua dengan penonton terlambat mencari kursi",
		"Yang terlambat, dimaafkan",
		"pair",
	),
	quote(
		para(
			tx(
				"Perhatian bukanlah sesuatu yang Anda bawa ke karya itu. Ia adalah sesuatu yang dibangun karya itu di dalam Anda.",
			),
		),
	),
	heading(3, tx("Silabus kelambatan")),
	para(
		tx(
			"Mulailah dengan film pendek, bukan monumen tiga jam; otot tumbuh lebih cepat dengan pengulangan daripada dengan cobaan. Tonton dua kali dalam seminggu, sekali untuk cerita yang dituntut kebiasaan Anda dan sekali untuk semua yang dilewatkan kebiasaan Anda. Lalu panjangkan pengambilannya: bilik samping festival, retrospektif, Minggu hujan yang diserahkan seluruhnya untuk satu sutradara. Simpan lognya. Beri tanggal setiap entri. Log itu akan memalukan Anda dalam setahun — milik saya dari musim semi lalu terbaca seperti kabar dari orang yang jauh lebih tidak sabar — dan rasa malu itu adalah ijazahnya. Anda juga, tanpa memutuskan, akan mulai menonton segala yang lain secara berbeda: percakapan, jalanan, cara cahaya meninggalkan ruangan saat senja. Silabus berakhir di tempat ia bermula, di pelataran parkir dalam hujan, kecuali kini empat menit terasa tepat sepanjang adanya, yaitu, tepat cukup panjang.",
		),
	),
	fig(
		"gurat-10",
		"Tiga bingkai hujan pada kaca dengan eksposur berbeda",
		"Hujan, tiga eksposur",
		"triptych",
	),
	fig(
		"gurat-11",
		"Kajian kedua dalam cahaya jendela",
		"Cahaya jendela, ditahan",
		"triptych",
	),
	fig(
		"gurat-12",
		"Kajian ketiga saat ruangan menggelap",
		"Senja yang menyunting",
		"triptych",
	),
	codeBlock(
		"text",
		"ritus malam:\n  ponsel -> ruangan lain\n  lampu -> redup\n  durasi -> berapa pun adanya\n  catatan -> setelahnya, jangan pernah selama",
	),
	para(
		tx(
			"Itulah seluruh ritus, dan muat di kartu indeks, dan tak pernah gagal mengubah malam itu. Kartu itu tinggal di rak saya di samping tiket-tiket. Ada malam filmnya biasa-biasa saja dan ritus yang menggendongnya. Ada malam filmnya hebat dan ritus yang lenyap di dalamnya. Kedua hasil mengalahkan opsi ketiga, yaitu malam yang larut menjadi empat puluh hal yang ditonton setengah-setengah dan dikenang sebagai ketiadaan. Ritus ini bukan tentang sinema. Ini tentang menolak pelarutan itu, sebulan sekali, dengan sengaja.",
		),
	),
	fig(
		"gurat-13",
		"Auditorium kosong yang lebar dari ruang proyektor",
		"Pandangan lebar atas auditorium",
		"wide",
	),
	pullquote(
		para(
			tx(
				"Dunia penuh sinema lambat yang tak pernah difilmkan siapa pun. Perhatian adalah proyektornya.",
			),
		),
	),
	heading(2, tx("Koda: pelataran parkir, dikunjungi lagi")),
	para(
		tx(
			"Bertahun-tahun kemudian saya menemukan film pelataran parkir itu mengalir tengah malam dan menontonnya sendirian di laptop, yang seharusnya menjadi penodaan dan ternyata menjadi reuni. Saya hafal setiap bidikan dan tak ingat satu pun kegelisahan saya; empat menit hujan itu terasa, mustahilnya, terlalu pendek. ",
		),
		tx(
			"Filmnya sama sekali tidak berubah, yang berarti perubahannyalah milik saya",
			link("#fn-1"),
		),
		tx(
			" untuk dijaga. Itulah kontrak tenang yang ditawarkan sinema lambat: beri ia durasi Anda dan ia mengembalikan perhatian Anda, yang ditingkatkan. Saya menyimpan potongan tiket dari pemutaran pertama di log tontonan, memudar hingga nyaris kosong, yang terasa tepat sekali. Potongannya kini kosong. Perhatiannya penuh. Sebagian pertukaran sesederhana itu, dan selambat itu, dan sepadan itu.",
		),
	),
	fig(
		"gurat-14",
		"Lampu depan menyeberangi pelataran kosong dalam bingkai penuh",
		"Lebar penuh, perhatian penuh",
		"full",
	),
	para(
		tx(
			"Jika Anda mengambil satu latihan dari esai ini, ambillah malam bulanan itu. Ponsel di ruangan lain, sesuatu yang lambat, catatan setelahnya. Dua puluh menit pertama akan bernegosiasi. Biarkan. Negosiasi selalu berakhir, dan yang menunggu melewatinya adalah hal yang sebenarnya Anda duduki: perasaan perhatian Anda sendiri yang mengendap, seperti sedimen yang jernih dari air, sampai segala dalam bingkai — dan, kemudian, segala di luarnya — terlihat lagi.",
		),
	),
	fig(
		"gurat-01",
		"Pagi setelahnya: pelataran yang sama di siang hari",
		"Pagi setelahnya, tetap pelataran",
		"inline",
	),
	para(
		tx(
			"Film-film lambat mengajari saya bahwa kebosanan biasanya adalah perhatian yang tiba lebih awal di tempat yang belum disusul mata. Tunggulah bersamanya. Mata menyusul. Dan saat menyusul, pelataran parkir dalam hujan itu ternyata selama ini adalah samudra, selebar empat menit, dan Anda selama ini berenang di dalamnya, menahan napas tanpa alasan, belajar — dengan cara paling lambat yang mungkin, yaitu satu-satunya cara yang bertahan — cara melihat.",
		),
	),
	footnote(
		para(
			tx(
				"Bidikan hujan empat menit itu: satu pengambilan, tanpa liputan, kabarnya difilmkan karena van kru mogok. Keterbatasan sebagai sutradara bersama.",
			),
		),
	),
	footnote(
		para(
			tx(
				"Getaran hantu sudah diteliti; ponselnya tak perlu ada. Perhatian, tampaknya, bergetar sendiri.",
			),
		),
	),
	footnote(
		para(
			tx(
				"Judul ganda esai ini me-render jangkar keduanya dengan akhiran -2 — durasi, dihitung dua kali, dihitung jujur.",
			),
		),
	),
);
// --- NO.009 · music ------------------------------------------------------------
// Rotation slot n=2: fixtures gurat-11,12,13,14,01,02,03,04,05,06.

const EN_009 = doc(
	heading(2, tx("Thirty days with one record")),
	para(
		tx(
			"In January I gave one album thirty days: no shuffling, no skipping, no background listening while answering email. Just the record, front to back, once a day, on speakers, sitting down. Friends treated this like a cleanse, and it was, but not of the kind they imagined. I did not emerge with opinions about the album. I emerged with the album inside my reflexes — humming bridge melodies while washing dishes, hearing the drum fill from track four in the rhythm of a train, dreaming once in its key. Opinions are cheap and arrive in the first three listens. Inhabitation takes thirty days, and it changes the listener more than it changes the record. By week two I was no longer evaluating. By week three I was no longer even listening, exactly. I was keeping company.",
		),
	),
	fig(
		"gurat-11",
		"A turntable with one record, sleeve worn at the edges",
		"Day one, side A",
		"inline",
	),
	para(
		tx(
			"The method needs stating plainly because its simplicity invites dismissal: ",
		),
		tx("same record, same hour, full attention", bold()),
		tx(
			", for a month. Mornings worked best, before the day's noise claimed the ears. I kept playback boring on purpose — no ",
		),
		tx("remaster comparisons", italic()),
		tx(
			", no alternate takes until February — and logged each session in a three-line ",
		),
		tx("listening diary", code()),
		tx(
			": track that caught me, moment I drifted, one sentence. The longer notes went to the ",
		),
		tx("relative archive", link("/writing/no-009-one-album")),
		tx(", and the pressing details to a friend's "),
		tx("discography page", link("https://example.com/pressings")),
		tx(
			". Repetition is usually framed as the enemy of novelty, but thirty identical mornings proved the opposite. The record never repeated. I did. And each repetition found a different listener sitting in the chair, carrying a different day, hearing a different album wearing the same clothes.",
		),
	),
	heading(2, tx("The week the record fought back")),
	para(
		tx(
			"Around day nine every record fights back. The novelty is gone, the favorites are tired, and the weak track you have been skipping in your head steps forward and demands its hearing. This is the week most listening projects die, and it is the entire point. What lives on the other side of day nine is the album as the artist sequenced it, including the song that only makes sense as a corridor between two rooms you love. I had dismissed track six as filler for years. On day eleven, walking home in sleet, its bridge arrived uninvited and rearranged my week. ",
		),
		sidenote(
			"1",
			tx(
				"Skip buttons are editors with no accountability. Remove them for a month.",
			),
		),
		tx(
			" Filler is usually a room you have not stood in long enough. Stay in the corridor. The doors on either side sound better for it, and so, incidentally, do you.",
		),
	),
	fig(
		"gurat-12",
		"Headphones resting on a notebook of daily entries",
		"The diary, mid-month",
		"offset",
	),
	para(
		tx(
			"By the third week the diary entries changed character. The first week's notes were reviews — judgments, ratings, comparisons. The third week's notes were weather reports: today the record sounded tall, today it sounded tired, today the bassline walked me to the station. I stopped writing about the music and started writing about the listening, which is the correct subject and the one I had been avoiding. ",
		),
		sidenote(
			"2",
			tx(
				"A listening diary is a diary that happens to mention music. Read yours accordingly.",
			),
		),
		tx(
			" A month of one album is a controlled experiment where the variable is you. The record holds still so you can watch yourself move: grieving on day fourteen, restless on day twenty, oddly weightless on day twenty-six, each state remixing the same twelve tracks into a different record. Nobody needs thirty days to review an album. You need thirty days to review the listener.",
		),
	),
	heading(2, tx("The week the record fought back")),
	para(
		tx(
			"The fight deserves its second round, because day nine returns in every long practice wearing different clothes. In running it is the third kilometer. In meditation it is the seventh minute. In marriage, the counselors say, it is the seventh year. The shape is always the same: the romance of beginning spent, the mastery of the end nowhere in sight, and a flat middle that asks whether the whole thing was a mistake. It was not a mistake. The middle is the practice. Everything before it was orientation and everything after it is harvest, but the middle — the corridor track, the sleet, the eleventh day — is where the change happens, quietly, without witnesses, in a room you almost left. Stay in the room.",
		),
	),
	fig(
		"gurat-13",
		"Two sleeves from the same pressing side by side",
		"Two copies, one month apart",
		"pair",
	),
	fig(
		"gurat-14",
		"A second sleeve with ring wear circled in pencil",
		"Ring wear, annotated",
		"pair",
	),
	quote(
		para(
			tx(
				"Repetition is not the enemy of novelty. The record never repeats. You do.",
			),
		),
	),
	heading(3, tx("What thirty days cost")),
	para(
		tx(
			"Honesty requires the ledger. Thirty days of one album cost me roughly thirty hours and every casual conversation about new releases for a month. I nodded along to discussions of records I had not heard with the serenity of a monk who has taken a vow. People assumed I had stopped caring about music; the truth was closer to the opposite, an attention so narrow it looked like absence. The return on those thirty hours: one album I will carry for life instead of thirty I would have streamed into fog, plus a practiced capacity for staying that transfers everywhere. The math embarrasses the algorithm. Depth beats breadth at every horizon longer than a week, and most of the horizons that matter — craft, love, attention — are measured in years.",
		),
	),
	fig(
		"gurat-01",
		"Three tickets from three listening sessions",
		"Three evenings, one record",
		"triptych",
	),
	fig(
		"gurat-02",
		"A second set of stubs with setlists",
		"The setlist never changed",
		"triptych",
	),
	fig(
		"gurat-03",
		"A third set, edges softened",
		"Soft edges, sharp ears",
		"triptych",
	),
	codeBlock(
		"text",
		"listening rite:\n  same hour, speakers, sitting down\n  no skipping, no background, no comparisons\n  diary: caught me / drifted / one sentence",
	),
	para(
		tx(
			"That is the whole rite, and it fits beside the turntable, and January proved it works on any record worth a month. February's album is already chosen. March has a waiting list. The shelf of candidates grows faster than the months can take them, which is exactly the right problem: a surplus of depth, scheduled. The algorithm will keep offering thirty new things a day. Let it. You have a chair, an hour, and one record, and that has turned out to be enough.",
		),
	),
	fig(
		"gurat-04",
		"A wide shelf of records with one slot empty",
		"A wide view of the shelf",
		"wide",
	),
	pullquote(
		para(
			tx(
				"Nobody needs thirty days to review an album. You need thirty days to review the listener.",
			),
		),
	),
	heading(2, tx("February, already")),
	para(
		tx(
			"The strangest outcome: February's record began before January's ended. On day twenty-seven the new album arrived in the mail, and I held the sealed sleeve like a letter from a future I had earned. Discipline compounds into appetite — the month of restraint had not tired my ears but sharpened them, and the new record sounded enormous, detailed, impossibly generous. ",
		),
		tx(
			"Restraint turned out to be the finest preamplifier I own",
			link("#fn-1"),
		),
		tx(
			". This is the part the streaming metrics cannot see: that listening less, on purpose, makes each record more. The month taught me the album, and then, as a bonus it never advertised, it taught me hunger — the good kind, the kind that sits down at the same hour and waits, expectant, for the needle to drop.",
		),
	),
	fig(
		"gurat-05",
		"February's sealed sleeve in full frame",
		"Full width, still sealed",
		"full",
	),
	para(
		tx(
			"If you take one practice from this essay, take the month. One record, same hour, no skipping. Day nine will come for you. Let it. What waits past it is not a better opinion about an album but a better instrument for hearing everything: records, rooms, people. Attention is the only equipment that appreciates with use, and thirty days is enough to feel the upgrade click into place.",
		),
	),
	fig(
		"gurat-06",
		"The chair by the speakers, morning light",
		"The chair, waiting",
		"inline",
	),
	para(
		tx(
			"Thirty days ends, and the record stays. Not on the turntable — February needs that — but in the reflexes, in the train rhythms, in the key of one remembered dream. I could write a review now, full of judgments and comparisons. Instead I wrote this: a record of the listening, which is the only review that ever mattered. The album is unchanged. The listener is not. That was the entire experiment, and it worked.",
		),
	),
	footnote(
		para(
			tx(
				"Track six, the corridor: a forty-second interlude I skipped for years, now the hinge of the whole record.",
			),
		),
	),
	footnote(
		para(
			tx(
				"The diary method: three lines a day, no more. Constraints are what make a month survivable.",
			),
		),
	),
	footnote(
		para(
			tx(
				"This essay's doubled heading earns its -2 anchor the honest way: by saying the hard part twice.",
			),
		),
	),
);

const ID_009 = doc(
	heading(2, tx("Tiga puluh hari dengan satu rekaman")),
	para(
		tx(
			"Pada bulan Januari saya memberi satu album tiga puluh hari: tanpa acak, tanpa lewati, tanpa mendengar sambil lalu saat membalas surel. Hanya rekaman itu, dari awal sampai akhir, sehari sekali, lewat pengeras suara, sambil duduk. Teman-teman memperlakukannya seperti pembersihan, dan memang, tetapi bukan seperti yang mereka bayangkan. Saya tidak keluar dengan opini tentang album itu. Saya keluar dengan album itu di dalam refleks — menyenandungkan melodi jembatan sambil mencuci piring, mendengar isian drum trek empat dalam ritme kereta, pernah bermimpi dalam nadanya. Opini itu murah dan tiba dalam tiga dengaran pertama. Penghunian butuh tiga puluh hari, dan ia mengubah pendengar lebih dari mengubah rekaman. Pada minggu kedua saya berhenti menilai. Pada minggu ketiga saya bahkan berhenti mendengar, tepatnya. Saya sedang berkawan.",
		),
	),
	fig(
		"gurat-11",
		"Pemutar piringan dengan satu rekaman, sampul aus di tepi",
		"Hari pertama, sisi A",
		"inline",
	),
	para(
		tx(
			"Metodenya perlu dinyatakan gamblang karena kesederhanaannya mengundang remeh: ",
		),
		tx("rekaman yang sama, jam yang sama, perhatian penuh", bold()),
		tx(
			", selama sebulan. Pagi hari paling cocok, sebelum kebisingan hari mengklaim telinga. Saya membuat pemutaran membosankan dengan sengaja — tanpa ",
		),
		tx("perbandingan remaster", italic()),
		tx(
			", tanpa versi alternatif sampai Februari — dan mencatat setiap sesi dalam ",
		),
		tx("diari dengar", code()),
		tx(
			" tiga baris: trek yang menangkapku, momen aku melayang, satu kalimat. Catatan yang lebih panjang masuk ke ",
		),
		tx("arsip relatif", link("/id/writing/no-009-satu-album")),
		tx(", dan detail cetakan ke "),
		tx("laman diskografi", link("https://example.com/pressings")),
		tx(
			" milik teman. Pengulangan biasanya dibingkai sebagai musuh kebaruan, tetapi tiga puluh pagi yang identik membuktikan sebaliknya. Rekaman itu tak pernah berulang. Sayalah yang berulang. Dan setiap pengulangan menemukan pendengar berbeda duduk di kursi, membawa hari yang berbeda, mendengar album berbeda berbaju sama.",
		),
	),
	heading(2, tx("Minggu rekaman itu melawan")),
	para(
		tx(
			"Sekitar hari kesembilan setiap rekaman melawan. Kebaruan habis, favorit-favorit lelah, dan trek lemah yang selama ini Anda lewati di kepala maju dan menuntut didengar. Inilah minggu tempat kebanyakan proyek dengar mati, dan inilah seluruh intinya. Yang hidup di seberang hari kesembilan adalah album sebagaimana diurutkan senimannya, termasuk lagu yang hanya masuk akal sebagai koridor di antara dua ruangan yang Anda cintai. Saya telah mengabaikan trek enam sebagai pengisi selama bertahun-tahun. Pada hari kesebelas, berjalan pulang dalam hujan es, jembatannya tiba tanpa diundang dan menata ulang minggu saya. ",
		),
		sidenote(
			"1",
			tx(
				"Tombol lewati adalah editor tanpa akuntabilitas. Singkirkan selama sebulan.",
			),
		),
		tx(
			" Pengisi biasanya adalah ruangan yang belum cukup lama Anda diami. Tinggallah di koridor. Pintu-pintu di kedua sisinya terdengar lebih baik karenanya, dan Anda pun, secara kebetulan, demikian.",
		),
	),
	fig(
		"gurat-12",
		"Headphone tergeletak di atas buku catatan harian",
		"Diari itu, pertengahan bulan",
		"offset",
	),
	para(
		tx(
			"Pada minggu ketiga entri diari berubah karakter. Catatan minggu pertama adalah ulasan — penilaian, peringkat, perbandingan. Catatan minggu ketiga adalah laporan cuaca: hari ini rekaman terdengar tinggi, hari ini terdengar lelah, hari ini bassline mengantar saya ke stasiun. Saya berhenti menulis tentang musik dan mulai menulis tentang mendengar, yang merupakan subjek yang benar dan yang selama ini saya hindari. ",
		),
		sidenote(
			"2",
			tx(
				"Diari dengar adalah diari yang kebetulan menyebut musik. Bacalah milik Anda seperti itu.",
			),
		),
		tx(
			" Sebulan satu album adalah eksperimen terkendali yang variabelnya adalah Anda. Rekaman diam agar Anda bisa melihat diri bergerak: berduka pada hari keempat belas, gelisah pada hari kedua puluh, ringan aneh pada hari kedua puluh enam, setiap keadaan me-remix dua belas trek yang sama menjadi rekaman berbeda. Tak ada yang butuh tiga puluh hari untuk mengulas album. Anda butuh tiga puluh hari untuk mengulas pendengar.",
		),
	),
	heading(2, tx("Minggu rekaman itu melawan")),
	para(
		tx(
			"Perlawanan layak ronde kedua, karena hari kesembilan kembali dalam setiap latihan panjang dengan pakaian berbeda. Dalam lari ia adalah kilometer ketiga. Dalam meditasi ia adalah menit ketujuh. Dalam pernikahan, kata para konselor, ia adalah tahun ketujuh. Bentuknya selalu sama: romantika permulaan habis, penguasaan akhir tak terlihat, dan dataran tengah yang datar bertanya apakah semuanya kekeliruan. Bukan kekeliruan. Tengah itulah latihannya. Segala sebelumnya adalah orientasi dan segala sesudahnya adalah panen, tetapi tengah itu — trek koridor, hujan es, hari kesebelas — adalah tempat perubahan terjadi, diam-diam, tanpa saksi, di ruangan yang nyaris Anda tinggalkan. Tinggallah di ruangan itu.",
		),
	),
	fig(
		"gurat-13",
		"Dua sampul dari cetakan yang sama berdampingan",
		"Dua salinan, selisih sebulan",
		"pair",
	),
	fig(
		"gurat-14",
		"Sampul kedua dengan ring wear dilingkari pensil",
		"Ring wear, beranotasi",
		"pair",
	),
	quote(
		para(
			tx(
				"Pengulangan bukanlah musuh kebaruan. Rekaman itu tak pernah berulang. Andalah yang berulang.",
			),
		),
	),
	heading(3, tx("Berapa harga tiga puluh hari")),
	para(
		tx(
			"Kejujuran menuntut pembukuan. Tiga puluh hari satu album merenggut saya kira-kira tiga puluh jam dan setiap percakapan santai tentang rilisan baru selama sebulan. Saya mengangguk mengikuti diskusi rekaman yang belum saya dengar dengan ketenangan rahib berkaul. Orang mengira saya berhenti peduli musik; kebenarannya lebih dekat ke sebaliknya, perhatian yang begitu sempit hingga tampak seperti ketiadaan. Imbal tiga puluh jam itu: satu album yang akan saya bawa seumur hidup alih-alih tiga puluh yang akan saya alirkan menjadi kabut, plus kapasitas bertahan yang terlatih dan menular ke mana-mana. Matematikanya mempermalukan algoritma. Kedalaman mengalahkan keluasan di setiap cakrawala lebih dari seminggu, dan sebagian besar cakrawala yang penting — keterampilan, cinta, perhatian — diukur dalam tahun.",
		),
	),
	fig(
		"gurat-01",
		"Tiga tiket dari tiga sesi dengar",
		"Tiga malam, satu rekaman",
		"triptych",
	),
	fig(
		"gurat-02",
		"Set kedua potongan dengan daftar lagu",
		"Daftar lagu tak pernah berubah",
		"triptych",
	),
	fig(
		"gurat-03",
		"Set ketiga, tepinya melunak",
		"Tepi melunak, telinga menajam",
		"triptych",
	),
	codeBlock(
		"text",
		"ritus dengar:\n  jam yang sama, pengeras suara, sambil duduk\n  tanpa lewati, tanpa latar, tanpa banding\n  diari: yang menangkapku / melayang / satu kalimat",
	),
	para(
		tx(
			"Itulah seluruh ritus, dan muat di samping pemutar piringan, dan Januari membuktikan ia bekerja pada rekaman apa pun yang layak sebulan. Album Februari sudah dipilih. Maret punya daftar tunggu. Rak kandidat tumbuh lebih cepat daripada bulan bisa menampungnya, dan itulah tepat masalah yang benar: surplus kedalaman, terjadwal. Algoritma akan terus menawarkan tiga puluh hal baru sehari. Biarkan. Anda punya kursi, satu jam, dan satu rekaman, dan itu ternyata cukup.",
		),
	),
	fig(
		"gurat-04",
		"Rak lebar berisi rekaman dengan satu slot kosong",
		"Pandangan lebar atas rak",
		"wide",
	),
	pullquote(
		para(
			tx(
				"Tak ada yang butuh tiga puluh hari untuk mengulas album. Anda butuh tiga puluh hari untuk mengulas pendengar.",
			),
		),
	),
	heading(2, tx("Februari, sudah")),
	para(
		tx(
			"Hasil paling aneh: rekaman Februari dimulai sebelum Januari berakhir. Pada hari kedua puluh tujuh album baru tiba lewat pos, dan saya memegang sampul tersegel seperti surat dari masa depan yang telah saya hasilkan. Disiplin ber bunga menjadi selera — sebulan menahan diri tidak melelahkan telinga saya melainkan menajamkannya, dan rekaman baru terdengar luar biasa, rinci, murah hati tak terkira. ",
		),
		tx(
			"Menahan diri ternyata preamplifier terbaik yang saya miliki",
			link("#fn-1"),
		),
		tx(
			". Inilah bagian yang tak bisa dilihat metrik aliran: bahwa mendengar lebih sedikit, dengan sengaja, membuat setiap rekaman lebih banyak. Sebulan itu mengajari saya album itu, dan kemudian, sebagai bonus yang tak pernah diiklankan, ia mengajari saya lapar — yang baik, yang duduk pada jam yang sama dan menunggu, penuh harap, jatuhnya jarum.",
		),
	),
	fig(
		"gurat-05",
		"Sampul tersegel Februari dalam bingkai penuh",
		"Lebar penuh, masih tersegel",
		"full",
	),
	para(
		tx(
			"Jika Anda mengambil satu latihan dari esai ini, ambillah sebulan itu. Satu rekaman, jam yang sama, tanpa lewati. Hari kesembilan akan datang untuk Anda. Biarkan. Yang menunggu melewatinya bukanlah opini lebih baik tentang album melainkan instrumen lebih baik untuk mendengar segalanya: rekaman, ruangan, orang. Perhatian adalah satu-satunya peralatan yang terapresiasi dengan pemakaian, dan tiga puluh hari cukup untuk merasakan peningkatan itu terkunci pada tempatnya.",
		),
	),
	fig(
		"gurat-06",
		"Kursi di samping pengeras suara, cahaya pagi",
		"Kursi itu, menunggu",
		"inline",
	),
	para(
		tx(
			"Tiga puluh hari berakhir, dan rekaman itu tinggal. Bukan di pemutar — Februari membutuhkannya — melainkan di refleks, di ritme kereta, di nada satu mimpi yang diingat. Saya bisa menulis ulasan kini, penuh penilaian dan perbandingan. Malah saya menulis ini: catatan tentang mendengar, yang merupakan satu-satunya ulasan yang pernah penting. Album tidak berubah. Pendengar berubah. Itulah seluruh eksperimen, dan ia berhasil. Dan keberhasilan itu menular ke luar musik: saya kini mendengar percakapan dengan kesabaran yang sama, memberi orang tiga puluh hari perhatian yang dulu hanya saya berikan pada rekaman. Cara kita mendengar satu hal adalah cara kita mendengar segala hal. Januari mengajari saya itu, satu ketukan jujur dalam satu waktu, sampai pendengar baru itu — yang duduk di kursi setiap pagi, menunggu, hadir — menjadi diri saya yang sebenarnya.",
		),
	),
	footnote(
		para(
			tx(
				"Trek enam, koridor itu: selingan empat puluh detik yang saya lewati bertahun-tahun, kini engsel seluruh rekaman.",
			),
		),
	),
	footnote(
		para(
			tx(
				"Metode diari: tiga baris sehari, tidak lebih. Batasanlah yang membuat sebulan bisa selamat.",
			),
		),
	),
	footnote(
		para(
			tx(
				"Judul ganda esai ini meraih jangkar -2-nya dengan cara jujur: dengan mengatakan bagian sulit dua kali.",
			),
		),
	),
);
// --- NO.010 · notes -------------------------------------------------------------
// Rotation slot n=3: fixtures gurat-02,03,04,05,06,07,08,09,10,11.

const EN_010 = doc(
	heading(2, tx("The honest margins")),
	para(
		tx(
			"Every book I truly own is defaced. The margins carry arguments, the endpapers carry indexes I wrote myself, and at least one page in every beloved volume carries a sentence underlined so hard the pen nearly tore through — a younger me shouting at an older author across decades. I used to apologize for this. Book people fall into two camps, the pristine and the annotated, and the pristine camp has better shelves. But shelves are furniture. Margins are thinking, and thinking leaves marks. This essay is a defense of the defaced book and a manual for marginalia that future-you will actually thank you for: dated, legible, disagreeing, and honest about the difference between understanding a book and finishing it.",
		),
	),
	fig(
		"gurat-02",
		"An open book dense with pencil marginalia",
		"First marks, light pencil",
		"inline",
	),
	para(
		tx(
			"The system fits on an index card, which is deliberate, because systems that need manuals do not survive contact with reading chairs: ",
		),
		tx("date everything, argue in verbs, index the endpapers", bold()),
		tx(". Dates first, because "),
		tx("marginalia without dates", italic()),
		tx(
			" is archaeology without strata — you will never know which self disagreed with the author. My shorthand lives in a ",
		),
		tx("legend file", code()),
		tx(
			" (star for true, question for unclear, exclamation for wrong, arrow for follow up); the full legend is pinned in the ",
		),
		tx("relative archive", link("/writing/no-010-marginalia")),
		tx(", and the best historical examples are surveyed on a "),
		tx("scholar's site", link("https://example.com/marginalia")),
		tx(
			". Argue in verbs — writes, claims, assumes, ignores — because adjectives fade and verbs accuse precisely. Index the endpapers because a book you cannot search is a conversation you cannot rejoin.",
		),
	),
	heading(2, tx("Against the pencil of politeness")),
	para(
		tx(
			"There is a kind of annotation that flatters the book: neat underlines of sentences already famous, exclamation marks where the author intended them, little stars raining on conclusions you agreed with before opening. This is not thinking. This is applause, and applause belongs in theaters. The margin deserves better than agreement. It deserves the sentence you almost wrote in anger and then, on rereading, kept — the objection that survived the night. ",
		),
		sidenote(
			"1",
			tx(
				"If every mark agrees with the author, you are reviewing, not reading. Pick a fight.",
			),
		),
		tx(
			" I have a rule now: no book is finished until something in it has annoyed me enough to answer. The answers embarrass me later, often within the year. That embarrassment is the receipt. It proves the margin did its job, which was never to be right. It was to be present — a dated witness that a mind was here, working, and willing to be wrong in writing.",
		),
	),
	fig(
		"gurat-03",
		"A furious ink annotation filling a whole margin",
		"The margin fights back",
		"offset",
	),
	para(
		tx(
			"Rereading annotated books is time travel with a hostile guide. You meet five-years-ago-you mid-argument, confident, wrong about something you now find obvious, and the margin forces a confrontation that memory would have politely skipped. This is the real dividend of the practice, larger than any retrieval benefit: a dated record of your own mind changing, in your own hand, disagreeing with itself across the years. ",
		),
		sidenote(
			"2",
			tx("Keep the embarrassing marks. Erasing them forges the record."),
		),
		tx(
			" I never erase, even the marks that make me wince. Erasing forges the record, and the record is the point. Who you were is data. The margin is the lab notebook of the self, and lab notebooks are not edited for dignity. They are kept — coffee stains, wrong turns, crossed-out certainties and all — because the crossed-out parts are where the learning visibly happened.",
		),
	),
	heading(2, tx("Against the pencil of politeness")),
	para(
		tx(
			"Politeness deserves its second hearing, because there is one book that earns it: the borrowed one. Never annotate a book you do not own. This is the whole of marginalia ethics, and it fits in one sentence because ethics should be portable. A borrowed book returns clean, always, no matter how loudly you disagreed in your head; your argument goes in your own notebook, dated, with the page number, where it belongs. Ownership is what makes the margin honest — the freedom to be wrong in a place nobody grades. Borrowed books get your best behavior, which is to say your least thinking. Your own books get the truth. Buy the books you want to argue with. It is the cheapest possible tuition for the longest possible conversation.",
		),
	),
	fig(
		"gurat-04",
		"Two editions of one book with rival annotations",
		"Two readers, one book",
		"pair",
	),
	fig(
		"gurat-05",
		"The same passage argued over in two hands",
		"Rival hands, same page",
		"pair",
	),
	quote(
		para(
			tx(
				"Shelves are furniture. Margins are thinking, and thinking leaves marks.",
			),
		),
	),
	heading(3, tx("The endpaper index")),
	para(
		tx(
			"Here is the whole retrieval method. When you finish a book, turn to the back endpaper and list what mattered: the three ideas you will want in a year, each with a page number, in your own words, not the author's. Own words force comprehension; quotations merely prove eyes passed over text. Six months later, when the book's argument has dissolved into aura, the index rebuilds it in minutes — your words leading back to their passages, which lead back to the margins, which lead back to the self who read it. The index is the map. The margins are the territory. The territory is dated, so you can watch yourself cross it differently each time, which is the closest thing to rereading a book and finding it changed, when really, gloriously, the changed thing is you.",
		),
	),
	fig(
		"gurat-06",
		"Three endpapers with competing index systems",
		"Three indexes, three minds",
		"triptych",
	),
	fig(
		"gurat-07",
		"A second endpaper dense with page numbers",
		"Page numbers as lifelines",
		"triptych",
	),
	fig(
		"gurat-08",
		"A third with arrows and cross-references",
		"Arrows point forward",
		"triptych",
	),
	codeBlock(
		"text",
		"margin legend:\n  * true (I checked)\n  ? unclear (I don't follow)\n  ! wrong (I disagree, dated)\n  -> follow up (page, title, date)",
	),
	para(
		tx(
			"That is the whole legend, and it fits on a card tucked in the back cover, and it has survived a decade of reading chairs. The symbols matter less than the dating — every mark carries the day it was made, because undated certainty is the most misleading annotation of all. A bare exclamation from 2019 means nothing. A dated one means: here stood someone, on this day, sure of this, and you can ask what has happened since. The legend turns graffiti into data. Data, dated, becomes a diary. And a diary of disagreements with dead authors turns out to be one of the most honest autobiographies you can keep.",
		),
	),
	fig(
		"gurat-09",
		"A wide desk covered in open annotated books",
		"A wide view of the desk",
		"wide",
	),
	pullquote(
		para(
			tx(
				"A dated record of your own mind changing, in your own hand, is the real dividend.",
			),
		),
	),
	heading(2, tx("Lend clean, keep marked")),
	para(
		tx(
			"The lending rule has one corollary worth stating: annotate the books you lend against. When a friend asks to borrow a book I love, I buy them their own copy — used, cheap, clean — and keep my defaced one. This looks extravagant and costs less than dinner. What it buys is two honest objects instead of one compromised one: their fresh reading, unshadowed by my certainties, and my margins, undisturbed by their politeness. ",
		),
		tx("Generosity, it turns out, is a conservation strategy", link("#fn-1")),
		tx(
			". The books that taught me most were never the clean ones. They were the marked ones, carrying other minds in their margins — a teacher's pencil, a friend's exclamation, a stranger's initials in a used-bookstore find. We read alone but we annotate in company, across years, in handwriting that outlives the hands.",
		),
	),
	fig(
		"gurat-10",
		"A borrowed book returned spotless beside a marked twin",
		"Full width, two copies",
		"full",
	),
	para(
		tx(
			"If you take one practice from this essay, take the date. Pencil, back endpaper, today's date, three ideas in your own words. Everything else — the verbs, the arguments, the fights with the author — grows from that one habit, because a dated mark is a promise that future-you can collect on. The pristine camp keeps better shelves. The annotated camp keeps better minds. Choose the margins. Leave marks. Date them. Argue loudly, in pencil, where only your future self has to answer.",
		),
	),
	fig(
		"gurat-11",
		"A reading chair with today's book left open",
		"Today's book, left open",
		"inline",
	),
	para(
		tx(
			"My books are ruined and I have never been richer. Every shelf is a sediment of former selves, dated and disagreeing, arguing with authors and with each other in handwriting that spans decades. Someday someone will inherit these defaced volumes and meet me in the margins — confident, wrong, present. I hope they keep the embarrassing marks. I hope they add their own, dated, in verbs. The conversation continues. That was always the point: not the finished book, but the unfinished reader, still arguing, still dating the evidence, still happily, defiantly, leaving marks.",
		),
	),
	footnote(
		para(
			tx(
				"Coleridge's marginalia runs to hundreds of pages and is still in print. The margins outlived the man.",
			),
		),
	),
	footnote(
		para(
			tx(
				"The used-bookstore rule: always check the margins before the price. Annotated copies are undervalued everywhere.",
			),
		),
	),
	footnote(
		para(
			tx(
				"This essay's doubled heading renders its -2 anchor honestly: politeness, questioned twice.",
			),
		),
	),
);

const ID_010 = doc(
	heading(2, tx("Margin yang jujur")),
	para(
		tx(
			"Setiap buku yang benar-benar saya miliki dirusak. Marginnya membawa perdebatan, kertas akhirnya membawa indeks yang saya tulis sendiri, dan setidaknya satu halaman di setiap volume kesayangan membawa kalimat yang digarisbawahi begitu keras hingga pena nyaris menembus — diri saya yang lebih muda berteriak pada pengarang yang lebih tua lintas dekade. Dulu saya meminta maaf untuk ini. Kaum buku terbagi dua kubu, yang murni dan yang beranotasi, dan kubu murni punya rak lebih bagus. Tetapi rak adalah furnitur. Margin adalah berpikir, dan berpikir meninggalkan bekas. Esai ini adalah pembelaan atas buku yang dirusak dan manual untuk marginalia yang akan benar-benar disyukuri diri-Anda-di-masa-depan: bertanggal, terbaca, membantah, dan jujur tentang beda antara memahami buku dan menamatkannya.",
		),
	),
	fig(
		"gurat-02",
		"Buku terbuka yang padat dengan marginalia pensil",
		"Tanda pertama, pensil ringan",
		"inline",
	),
	para(
		tx(
			"Sistemnya muat di kartu indeks, dan itu disengaja, karena sistem yang butuh manual tidak selamat bersentuhan dengan kursi baca: ",
		),
		tx(
			"beri tanggal pada semua, berdebatlah dengan kata kerja, indeks kertas akhirnya",
			bold(),
		),
		tx(". Tanggal dulu, karena "),
		tx("marginalia tanpa tanggal", italic()),
		tx(
			" adalah arkeologi tanpa strata — Anda takkan pernah tahu diri mana yang berselisih dengan pengarang. Singkatan saya tinggal dalam ",
		),
		tx("berkas legenda", code()),
		tx(
			" (bintang untuk benar, tanya untuk tak jelas, seru untuk salah, panah untuk tindak lanjut); legenda lengkap disematkan di ",
		),
		tx("arsip relatif", link("/id/writing/no-010-marginalia")),
		tx(", dan contoh-contoh historis terbaik disurvei di "),
		tx("situs seorang sarjana", link("https://example.com/marginalia")),
		tx(
			". Berdebatlah dengan kata kerja — menulis, mengklaim, mengasumsikan, mengabaikan — karena kata sifat memudar dan kata kerja menuduh dengan tepat. Indeks kertas akhirnya karena buku yang tak bisa dicari adalah percakapan yang tak bisa disambung.",
		),
	),
	heading(2, tx("Melawan pensil kesopanan")),
	para(
		tx(
			"Ada jenis anotasi yang menyanjung buku: garis bawah rapi pada kalimat yang sudah terkenal, tanda seru di tempat yang memang dimaksud pengarang, bintang-bintang kecil menghujani simpulan yang sudah Anda setujui sebelum membuka. Ini bukan berpikir. Ini tepuk tangan, dan tepuk tangan milik gedung pertunjukan. Margin layak lebih baik dari persetujuan. Ia layak kalimat yang nyaris Anda tulis dalam amarah lalu, setelah dibaca ulang, dipertahankan — keberatan yang selamat melewati malam. ",
		),
		sidenote(
			"1",
			tx(
				"Jika setiap tanda setuju dengan pengarang, Anda sedang mengulas, bukan membaca. Ajaklah bertengkar.",
			),
		),
		tx(
			" Saya punya aturan kini: tak ada buku yang tamat sampai sesuatu di dalamnya cukup mengganggu saya untuk dijawab. Jawaban-jawaban itu memalukan saya kemudian, sering dalam setahun. Rasa malu itu adalah kuitansinya. Ia membuktikan margin menjalankan tugasnya, yang tak pernah menjadi benar. Tugasnya adalah hadir — saksi bertanggal bahwa sebuah pikiran pernah di sini, bekerja, dan bersedia salah secara tertulis.",
		),
	),
	fig(
		"gurat-03",
		"Anotasi tinta murka memenuhi seluruh margin",
		"Margin itu melawan",
		"offset",
	),
	para(
		tx(
			"Membaca ulang buku beranotasi adalah perjalanan waktu dengan pemandu yang bermusuhan. Anda bertemu diri-Anda-lima-tahun-lalu di tengah argumen, percaya diri, salah tentang sesuatu yang kini Anda anggap jelas, dan margin memaksa konfrontasi yang akan dilewatkan memori dengan sopan. Inilah dividen sesungguhnya dari latihan ini, lebih besar dari manfaat temu kembali apa pun: catatan bertanggal tentang pikiran Anda sendiri yang berubah, dalam tulisan tangan Anda sendiri, berselisih dengan dirinya lintas tahun. ",
		),
		sidenote(
			"2",
			tx("Simpan tanda-tanda yang memalukan. Menghapusnya memalsukan catatan."),
		),
		tx(
			" Saya tak pernah menghapus, bahkan tanda yang membuat saya meringis. Menghapus memalsukan catatan, dan catatan itulah intinya. Siapa Anda dulu adalah data. Margin adalah buku lab tentang diri, dan buku lab tidak disunting demi martabat. Ia disimpan — noda kopi, jalan buntu, kepastian yang dicoret dan semua — karena bagian yang dicoret itulah tempat pembelajaran terlihat terjadi.",
		),
	),
	heading(2, tx("Melawan pensil kesopanan")),
	para(
		tx(
			"Kesopanan layak dengar pendapat kedua, karena ada satu buku yang berhak atasnya: buku pinjaman. Jangan pernah menganotasi buku yang bukan milik Anda. Itulah seluruh etika marginalia, dan ia muat dalam satu kalimat karena etika harus portabel. Buku pinjaman kembali bersih, selalu, tak peduli sekeras apa Anda membantah di kepala; argumen Anda masuk buku catatan Anda sendiri, bertanggal, dengan nomor halaman, di tempatnya. Kepemilikanlah yang membuat margin jujur — kebebasan untuk salah di tempat yang tak dinilai siapa pun. Buku pinjaman mendapat perilaku terbaik Anda, yaitu pemikiran Anda yang paling sedikit. Buku Anda sendiri mendapat kebenaran. Belilah buku yang ingin Anda perdebatkan. Itulah uang kuliah termurah untuk percakapan terpanjang yang mungkin.",
		),
	),
	fig(
		"gurat-04",
		"Dua edisi satu buku dengan anotasi yang bersaing",
		"Dua pembaca, satu buku",
		"pair",
	),
	fig(
		"gurat-05",
		"Bagian yang sama diperdebatkan dua tangan",
		"Tangan rival, halaman sama",
		"pair",
	),
	quote(
		para(
			tx(
				"Rak adalah furnitur. Margin adalah berpikir, dan berpikir meninggalkan bekas.",
			),
		),
	),
	heading(3, tx("Indeks kertas akhir")),
	para(
		tx(
			"Inilah seluruh metode temu kembali. Saat menamatkan buku, bukalah kertas akhir belakang dan daftarkan yang penting: tiga ide yang Anda inginkan setahun lagi, masing-masing dengan nomor halaman, dengan kata-kata Anda sendiri, bukan kata pengarang. Kata sendiri memaksa pemahaman; kutipan hanya membuktikan mata melewati teks. Enam bulan kemudian, saat argumen buku itu larut menjadi aura, indeks membangunnya kembali dalam hitungan menit — kata-kata Anda menuntun kembali ke bagian-bagiannya, yang menuntun kembali ke margin, yang menuntun kembali ke diri yang membacanya. Indeks adalah peta. Margin adalah wilayah. Wilayah bertanggal, sehingga Anda bisa melihat diri menyeberanginya berbeda setiap kali, yang merupakan hal terdekat dengan membaca ulang buku dan menemukannya berubah, padahal, dengan mulia, yang berubah adalah Anda.",
		),
	),
	fig(
		"gurat-06",
		"Tiga kertas akhir dengan sistem indeks yang bersaing",
		"Tiga indeks, tiga pikiran",
		"triptych",
	),
	fig(
		"gurat-07",
		"Kertas akhir kedua yang padat dengan nomor halaman",
		"Nomor halaman sebagai tali",
		"triptych",
	),
	fig(
		"gurat-08",
		"Yang ketiga dengan panah dan referensi silang",
		"Panah menunjuk maju",
		"triptych",
	),
	codeBlock(
		"text",
		"legenda margin:\n  * benar (sudah saya cek)\n  ? tak jelas (saya tak mengikuti)\n  ! salah (saya tak setuju, bertanggal)\n  -> tindak lanjut (halaman, judul, tanggal)",
	),
	para(
		tx(
			"Itulah seluruh legenda, dan muat di kartu yang diselipkan di sampul belakang, dan ia selamat sedekade kursi baca. Simbol kurang penting daripada penanggalan — setiap tanda membawa hari pembuatannya, karena kepastian tanpa tanggal adalah anotasi paling menyesatkan. Seru telanjang dari 2019 tak berarti apa-apa. Yang bertanggal berarti: di sinilah seseorang berdiri, pada hari ini, yakin akan ini, dan Anda bisa bertanya apa yang terjadi sejak itu. Legenda mengubah grafiti menjadi data. Data, yang bertanggal, menjadi diari. Dan diari perselisihan dengan pengarang yang telah wafat ternyata menjadi salah satu otobiografi paling jujur yang bisa Anda simpan.",
		),
	),
	fig(
		"gurat-09",
		"Meja lebar tertutup buku-buku terbuka beranotasi",
		"Pandangan lebar atas meja",
		"wide",
	),
	pullquote(
		para(
			tx(
				"Catatan bertanggal tentang pikiran Anda sendiri yang berubah, dalam tulisan tangan Anda sendiri, adalah dividen sesungguhnya.",
			),
		),
	),
	heading(2, tx("Pinjamkan bersih, simpan bertanda")),
	para(
		tx(
			"Aturan pinjam punya satu akibat yang layak dinyatakan: anotasilah buku-buku yang Anda pinjamkan secara terbalik. Saat teman meminta meminjam buku yang saya cintai, saya membelikan mereka salinannya sendiri — bekas, murah, bersih — dan menyimpan milik saya yang dirusak. Ini terlihat boros dan biayanya kurang dari makan malam. Yang dibelinya adalah dua objek jujur alih-alih satu yang dikompromikan: bacaan segar mereka, tanpa bayang-bayang kepastian saya, dan margin saya, tanpa terganggu kesopanan mereka. ",
		),
		tx("Kemurahan hati, ternyata, adalah strategi konservasi", link("#fn-1")),
		tx(
			". Buku-buku yang paling mengajari saya tak pernah yang bersih. Melainkan yang bertanda, membawa pikiran lain di marginnya — pensil seorang guru, seru seorang teman, inisial orang asing dalam temuan toko buku bekas. Kita membaca sendirian tetapi menganotasi bersama, lintas tahun, dalam tulisan tangan yang hidup lebih lama dari tangan-tangannya.",
		),
	),
	fig(
		"gurat-10",
		"Buku pinjaman kembali mulus di samping kembaran bertanda",
		"Lebar penuh, dua salinan",
		"full",
	),
	para(
		tx(
			"Jika Anda mengambil satu latihan dari esai ini, ambillah tanggal itu. Pensil, kertas akhir belakang, tanggal hari ini, tiga ide dengan kata-kata Anda sendiri. Segala yang lain — kata kerja, argumen, perkelahian dengan pengarang — tumbuh dari satu kebiasaan itu, karena tanda bertanggal adalah janji yang bisa ditagih diri-Anda-di-masa-depan. Kubu murni menyimpan rak lebih baik. Kubu beranotasi menyimpan pikiran lebih baik. Pilihlah margin. Tinggalkan bekas. Beri tanggal. Berdebatlah keras, dengan pensil, di tempat hanya diri masa depan Anda yang harus menjawab.",
		),
	),
	fig(
		"gurat-11",
		"Kursi baca dengan buku hari ini dibiarkan terbuka",
		"Buku hari ini, dibiarkan terbuka",
		"inline",
	),
	para(
		tx(
			"Buku-buku saya rusak dan saya tak pernah sekaya ini. Setiap rak adalah sedimen diri-diri terdahulu, bertanggal dan berselisih, berdebat dengan pengarang dan satu sama lain dalam tulisan tangan yang merentang dekade. Suatu hari seseorang akan mewarisi volume-volume rusak ini dan menemui saya di margin — percaya diri, salah, hadir. Saya harap mereka menyimpan tanda yang memalukan. Saya harap mereka menambah miliknya, bertanggal, dengan kata kerja. Percakapan berlanjut. Itulah selalu intinya: bukan buku yang tamat, melainkan pembaca yang belum selesai, masih berdebat, masih memberi tanggal pada bukti, masih dengan gembira, dengan menantang, meninggalkan bekas.",
		),
	),
	footnote(
		para(
			tx(
				"Marginalia Coleridge mencapai ratusan halaman dan masih dicetak. Margin hidup lebih lama dari manusianya.",
			),
		),
	),
	footnote(
		para(
			tx(
				"Aturan toko buku bekas: selalu cek margin sebelum harga. Salinan beranotasi dinilai terlalu rendah di mana-mana.",
			),
		),
	),
	footnote(
		para(
			tx(
				"Judul ganda esai ini me-render jangkar -2-nya dengan jujur: kesopanan, dipertanyakan dua kali.",
			),
		),
	),
);
// --- NO.011 · software + notes --------------------------------------------------
// Rotation slot n=4: fixtures gurat-07,08,09,10,11,12,13,14,01,02.

const EN_011 = doc(
	heading(2, tx("Your dashboard is a confession")),
	para(
		tx(
			"Open your analytics dashboard and read it like a diary, because that is what it is. Every widget you added was a worry you had on some Tuesday; every chart you never look at is a worry you outgrew but never buried. My own dashboard, audited last spring, confessed to four obsolete anxieties, two numbers nobody could define, and one graph — beautiful, expensive, real-time — tracking a metric no decision had ever used. Deleting it felt like confession in reverse: instead of admitting faults to feel better, I removed the evidence and actually became better. This essay proposes a quarterly rite of dashboard deletion, with the same tenderness you would bring to cleaning out a dead friend's desk. Something on that screen was once important to someone. Honor it by letting it go.",
		),
	),
	fig(
		"gurat-07",
		"A monitor full of dashboards nobody opens",
		"Every widget was a worry",
		"inline",
	),
	para(
		tx(
			"The audit takes one hour and needs only three questions, asked of every panel: ",
		),
		tx("who decided, what changed, when last", bold()),
		tx(
			". Who decided this number matters — a name, not a team. What changed the last time it moved — a decision, not a feeling. When last — a date, and if the date is older than a quarter, the panel is a memorial. Memorials belong elsewhere; I keep mine in a ",
		),
		tx("retired-metrics", italic()),
		tx(
			" note so the worry is honored without occupying pixels. The audit checklist itself is a ",
		),
		tx("short script", code()),
		tx(" I run against my own habits; the template lives in the "),
		tx("relative archive", link("/writing/no-011-delete-dashboard")),
		tx(", alongside a survey of teams who deleted more, on a "),
		tx("colleague's page", link("https://example.com/deleted-dashboards")),
		tx(
			". One hour, once a quarter. The screen gets emptier. The mind follows.",
		),
	),
	heading(2, tx("The metric that survived")),
	para(
		tx(
			"After three rounds of deletion, one number remained on my screen, and it surprised me. Not revenue, not growth, not the vanity with the hockey stick — but time-to-first-green-build for new contributors, a quiet little duration that measures how long a stranger waits before the project welcomes them. Everything noisy had been deleted. What survived was hospitality. I stared at that single graph for a long time and understood something about dashboards I had missed for years: they are not instruments, they are aspirations. ",
		),
		sidenote(
			"1",
			tx(
				"Keep the metric you would show a newcomer. Delete the ones you show investors.",
			),
		),
		tx(
			" You become what you measure, slowly, then all at once, which is why the deletion rite matters more than any single metric. The screen shapes the team that stares at it. Choose the shape on purpose, or it will be chosen by every worried Tuesday that ever added a widget.",
		),
	),
	fig(
		"gurat-08",
		"One graph left on an otherwise empty screen",
		"What survived the audit",
		"offset",
	),
	para(
		tx(
			"Deletion has a failure mode worth naming: the purge that deletes the memory along with the metric. I learned this the expensive way, removing a latency chart six months before a regression made that exact chart the thing everyone wished they had. The fix is not to keep everything — that is the disease, not the cure — but to delete loudly. Every deletion gets a dated note: what it was, why it went, what would justify its return. ",
		),
		sidenote(
			"2",
			tx("Delete loudly: a dated note survives longer than a dusty widget."),
		),
		tx(
			" The note costs thirty seconds and buys back the future. We did, eventually, bring one chart back — the latency one, vindicated, welcomed home like a dog that ran away and returned having learned something. Loud deletion means no deletion is final. It only means: not now, not here, and here is exactly why.",
		),
	),
	heading(2, tx("The metric that survived")),
	para(
		tx(
			"Survival deserves its second look, because the metric that survives your audit tells you what your team actually values, as opposed to what the all-hands says it values. Ours valued the stranger — the new contributor, the future maintainer, the person who has not arrived yet. A different team might keep uptime, or burn rate, or support response time, and each survivor would be a similarly honest portrait. Run the audit and read the remainder like tea leaves. If the survivor embarrasses you, that is information of the highest quality. Change the screen, then change the standup, then watch the quarter change. Metrics are downstream of attention, and attention is downstream of what you allow on the screen. The dashboard is a confession. Make it one you would sign.",
		),
	),
	fig(
		"gurat-09",
		"Before and after screenshots pinned side by side",
		"Before the audit",
		"pair",
	),
	fig(
		"gurat-10",
		"The after screenshot, mostly whitespace",
		"After: mostly whitespace",
		"pair",
	),
	quote(
		para(
			tx(
				"You become what you measure, slowly, then all at once. Choose the shape on purpose.",
			),
		),
	),
	heading(3, tx("The deletion rite, step by step")),
	para(
		tx(
			"Schedule it like a dentist appointment: quarterly, non-negotiable, one hour, with the whole team watching the screen share. Read every panel aloud and ask the three questions. Anything without a name, a decision, and a recent date gets a thirty-day notice — hidden, not deleted, with the dated note explaining why. At the next rite, the hidden ones go, unless someone brings a story of a decision they changed. Stories beat metrics. The rite ends with the survivor's portrait: one paragraph on what the remaining screen says the team values, read aloud, argued with, kept. The paragraph matters more than the panels. It is the confession, signed, and it will embarrass you within a year, which is how you will know the rite is working.",
		),
	),
	fig(
		"gurat-11",
		"Three sticky notes with deletion dates",
		"Thirty days notice",
		"triptych",
	),
	fig(
		"gurat-12",
		"A second batch, already curling",
		"The hidden ones",
		"triptych",
	),
	fig(
		"gurat-13",
		"A third batch with one reprieve circled",
		"One reprieve, one story",
		"triptych",
	),
	codeBlock(
		"text",
		"deletion rite:\n  ask: who decided / what changed / when last\n  hide for 30 days + dated note\n  next rite: delete or hear the story",
	),
	para(
		tx(
			"That is the whole rite, and it fits on the wall next to the screen, and three quarters of it have emptied my dashboard by half. The remaining half works harder than the original whole ever did, because every number on it has a name, a decision, and a recent date. Maintenance is not the absence of change. It is change with a good memory — loud deletions, dated notes, and the occasional welcome-home for the chart that turned out to matter after all.",
		),
	),
	fig(
		"gurat-14",
		"A wide empty wall where dashboards used to hang",
		"A wide view of the wall",
		"wide",
	),
	pullquote(
		para(
			tx(
				"The screen shapes the team that stares at it. Choose the shape on purpose.",
			),
		),
	),
	heading(2, tx("Confession, signed")),
	para(
		tx(
			"My screen today holds four numbers, and I can defend each one out loud: the stranger's wait, the error budget's remainder, the oldest unanswered question from users, and the age of the oldest deletion note — the last one measuring whether the rite itself is still alive. Four numbers, four names, four recent dates. A year ago there were nineteen, and I could defend perhaps three. ",
		),
		tx(
			"The rite did not make me data-driven; it made me data-honest",
			link("#fn-1"),
		),
		tx(
			", which is rarer and more useful. Driven is a direction. Honest is a discipline. The dashboard confesses either way — the only choice is whether you schedule the confession quarterly, with tenderness and witnesses, or wait for the outage that reads your screen aloud in front of everyone.",
		),
	),
	fig(
		"gurat-01",
		"Four numbers on a clean screen in full frame",
		"Full width, four numbers",
		"full",
	),
	para(
		tx(
			"If you take one practice from this essay, take the three questions. Walk to the nearest dashboard — yours, your team's, the one on the office TV — and ask of every panel: who decided, what changed, when last. You will find a memorial within minutes. Give it thirty days and a dated note. The screen gets emptier. The mind follows. And somewhere in the new whitespace, the number that actually matters finally has room to be seen.",
		),
	),
	fig(
		"gurat-02",
		"Morning light on the clean screen",
		"Morning, clean screen",
		"inline",
	),
	para(
		tx(
			"Dashboards are confessions we update daily without realizing we are confessing. Audit the confession. Delete the obsolete anxieties. Keep the hospitality. The screen you stare at all day is shaping the team you are becoming — make it a shape you would sign, date it, and read it aloud once a quarter, with witnesses. Boring screens, honest teams. That is the whole thesis, and it fits in the whitespace you just made.",
		),
	),
	footnote(
		para(
			tx(
				"The real-time vanity graph: beautiful, expensive, tracking a metric no decision ever used. Deleted spring last year, mourned by no one.",
			),
		),
	),
	footnote(
		para(
			tx(
				"The latency chart that came home: deleted loudly, missed precisely once, restored with honors and a better threshold.",
			),
		),
	),
	footnote(
		para(
			tx(
				"This essay's doubled heading keeps its -2 anchor audible: survival, examined twice.",
			),
		),
	),
);

const ID_011 = doc(
	heading(2, tx("Dasbor Anda adalah pengakuan")),
	para(
		tx(
			"Bukalah dasbor analitik Anda dan bacalah seperti diari, karena itulah adanya. Setiap widget yang Anda tambah adalah kekhawatiran yang Anda miliki pada suatu Selasa; setiap grafik yang tak pernah Anda lihat adalah kekhawatiran yang sudah Anda lampaui tetapi tak pernah dikubur. Dasbor saya sendiri, diaudit musim semi lalu, mengaku menyimpan empat kecemasan usang, dua angka yang tak bisa didefinisikan siapa pun, dan satu grafik — indah, mahal, real-time — yang melacak metrik yang tak pernah dipakai keputusan apa pun. Menghapusnya terasa seperti pengakuan terbalik: alih-alih mengakui kesalahan agar merasa lebih baik, saya menyingkirkan buktinya dan benar-benar menjadi lebih baik. Esai ini mengusulkan ritus penghapusan dasbor kuartalan, dengan kelembutan yang sama seperti membereskan meja mendiang sahabat. Sesuatu di layar itu pernah penting bagi seseorang. Hormatilah dengan melepaskannya.",
		),
	),
	fig(
		"gurat-07",
		"Monitor penuh dasbor yang tak pernah dibuka",
		"Setiap widget adalah kekhawatiran",
		"inline",
	),
	para(
		tx(
			"Audit butuh satu jam dan hanya memerlukan tiga pertanyaan, ditanyakan pada setiap panel: ",
		),
		tx("siapa memutuskan, apa berubah, kapan terakhir", bold()),
		tx(
			". Siapa memutuskan angka ini penting — nama, bukan tim. Apa berubah terakhir kali ia bergerak — keputusan, bukan perasaan. Kapan terakhir — tanggal, dan jika tanggalnya lebih tua dari kuartal, panel itu adalah memorial. Memorial milik tempat lain; saya menyimpan milik saya dalam catatan ",
		),
		tx("metrik-pensiun", italic()),
		tx(
			" agar kekhawatiran dihormati tanpa menempati piksel. Daftar periksa audit itu sendiri adalah ",
		),
		tx("skrip pendek", code()),
		tx(
			" yang saya jalankan terhadap kebiasaan saya sendiri; templatnya tinggal di ",
		),
		tx("arsip relatif", link("/id/writing/no-011-hapus-dasbor")),
		tx(", berdampingan survei tim-tim yang menghapus lebih banyak, di "),
		tx("laman seorang kolega", link("https://example.com/deleted-dashboards")),
		tx(". Satu jam, sekali kuartal. Layar makin kosong. Pikiran mengikuti."),
	),
	heading(2, tx("Metrik yang selamat")),
	para(
		tx(
			"Setelah tiga putaran penghapusan, satu angka tersisa di layar saya, dan ia mengejutkan saya. Bukan pendapatan, bukan pertumbuhan, bukan kesombongan bertongkat hoki — melainkan waktu-menuju-build-hijau-pertama bagi kontributor baru, durasi tenang yang mengukur berapa lama orang asing menunggu sebelum proyek menyambutnya. Segala yang berisik telah dihapus. Yang selamat adalah keramahan. Saya menatap grafik tunggal itu lama dan memahami sesuatu tentang dasbor yang terlewatkan saya bertahun-tahun: mereka bukan instrumen, mereka aspirasi. ",
		),
		sidenote(
			"1",
			tx(
				"Simpan metrik yang akan Anda tunjukkan pada pendatang baru. Hapus yang Anda tunjukkan pada investor.",
			),
		),
		tx(
			" Anda menjadi apa yang Anda ukur, perlahan, lalu sekaligus, itulah mengapa ritus penghapusan lebih penting daripada metrik tunggal mana pun. Layar membentuk tim yang menatapnya. Pilih bentuknya dengan sengaja, atau ia akan dipilih oleh setiap Selasa cemas yang pernah menambah widget.",
		),
	),
	fig(
		"gurat-08",
		"Satu grafik tersisa di layar yang kosong",
		"Yang selamat dari audit",
		"offset",
	),
	para(
		tx(
			"Penghapusan punya mode gagal yang layak dinamai: pembersihan yang menghapus ingatan beserta metriknya. Saya mempelajari ini dengan cara mahal, menyingkirkan grafik latensi enam bulan sebelum regresi membuat grafik itu persis hal yang diharapkan semua orang masih ada. Perbaikannya bukan menyimpan segalanya — itu penyakitnya, bukan obatnya — melainkan menghapus dengan lantang. Setiap penghapusan mendapat catatan bertanggal: apa itu, mengapa pergi, apa yang membenarkan kembalinya. ",
		),
		sidenote(
			"2",
			tx(
				"Hapuslah dengan lantang: catatan bertanggal hidup lebih lama dari widget berdebu.",
			),
		),
		tx(
			" Catatan butuh tiga puluh detik dan membeli kembali masa depan. Kami, akhirnya, membawa pulang satu grafik — yang latensi itu, terbukti benar, disambut pulang seperti anjing yang kabur dan kembali setelah mempelajari sesuatu. Penghapusan lantang berarti tak ada penghapusan yang final. Artinya hanya: bukan kini, bukan di sini, dan inilah tepat alasannya.",
		),
	),
	heading(2, tx("Metrik yang selamat")),
	para(
		tx(
			"Kelangsungan layak lihat kedua, karena metrik yang selamat dari audit Anda memberi tahu apa yang sebenarnya dihargai tim Anda, berbeda dari yang dikatakan all-hands. Milik kami menghargai orang asing — kontributor baru, pengelola masa depan, orang yang belum tiba. Tim lain mungkin menyimpan uptime, atau burn rate, atau waktu respons dukungan, dan setiap penyintas akan menjadi potret jujur yang sama. Jalankan audit dan bacalah sisanya seperti daun teh. Jika penyintasnya memalukan Anda, itulah informasi kualitas tertinggi. Ubah layar, lalu ubah standup, lalu saksikan kuartal berubah. Metrik adalah hilir perhatian, dan perhatian adalah hilir apa yang Anda izinkan di layar. Dasbor adalah pengakuan. Buatlah yang berani Anda tandatangani.",
		),
	),
	fig(
		"gurat-09",
		"Tangkapan sebelum dan sesudah disematkan berdampingan",
		"Sebelum audit",
		"pair",
	),
	fig(
		"gurat-10",
		"Tangkapan sesudah, kebanyakan ruang putih",
		"Sesudah: kebanyakan ruang putih",
		"pair",
	),
	quote(
		para(
			tx(
				"Anda menjadi apa yang Anda ukur, perlahan, lalu sekaligus. Pilih bentuknya dengan sengaja.",
			),
		),
	),
	heading(3, tx("Ritus penghapusan, langkah demi langkah")),
	para(
		tx(
			"Jadwalkan seperti janji dokter gigi: kuartalan, tak bisa ditawar, satu jam, dengan seluruh tim menyaksikan berbagi layar. Bacakan setiap panel dengan lantang dan ajukan tiga pertanyaan. Apa pun tanpa nama, keputusan, dan tanggal terkini mendapat pemberitahuan tiga puluh hari — disembunyikan, bukan dihapus, dengan catatan bertanggal yang menjelaskan mengapa. Pada ritus berikutnya, yang tersembunyi pergi, kecuali seseorang membawa kisah keputusan yang mereka ubah. Kisah mengalahkan metrik. Ritus berakhir dengan potret penyintas: satu paragraf tentang apa yang dikatakan layar tersisa mengenai nilai tim, dibacakan lantang, diperdebatkan, disimpan. Paragraf lebih penting dari panel. Itulah pengakuan, yang ditandatangani, dan ia akan memalukan Anda dalam setahun, begitulah Anda tahu ritus bekerja.",
		),
	),
	fig(
		"gurat-11",
		"Tiga catatan tempel dengan tanggal penghapusan",
		"Pemberitahuan tiga puluh hari",
		"triptych",
	),
	fig(
		"gurat-12",
		"Batch kedua, sudah melengkung",
		"Yang tersembunyi",
		"triptych",
	),
	fig(
		"gurat-13",
		"Batch ketiga dengan satu pengampunan dilingkari",
		"Satu pengampunan, satu kisah",
		"triptych",
	),
	codeBlock(
		"text",
		"ritus hapus:\n  tanya: siapa memutuskan / apa berubah / kapan terakhir\n  sembunyikan 30 hari + catatan bertanggal\n  ritus berikut: hapus atau dengar kisahnya",
	),
	para(
		tx(
			"Itulah seluruh ritus, dan muat di dinding samping layar, dan tiga kuartalnya telah mengosongkan dasbor saya separuhnya. Separuh tersisa bekerja lebih keras dari keseluruhan aslinya, karena setiap angka di dalamnya punya nama, keputusan, dan tanggal terkini. Pemeliharaan bukanlah ketiadaan perubahan. Ia adalah perubahan dengan ingatan yang baik — penghapusan lantang, catatan bertanggal, dan sesekali penyambutan pulang bagi grafik yang ternyata penting juga.",
		),
	),
	fig(
		"gurat-14",
		"Dinding kosong lebar tempat dasbor dulu tergantung",
		"Pandangan lebar atas dinding",
		"wide",
	),
	pullquote(
		para(
			tx(
				"Layar membentuk tim yang menatapnya. Pilih bentuknya dengan sengaja.",
			),
		),
	),
	heading(2, tx("Pengakuan, ditandatangani")),
	para(
		tx(
			"Layar saya hari ini memuat empat angka, dan masing-masing bisa saya bela dengan lantang: penantian orang asing, sisa anggaran error, pertanyaan pengguna tertua yang belum dijawab, dan umur catatan penghapusan tertua — yang terakhir mengukur apakah ritus itu sendiri masih hidup. Empat angka, empat nama, empat tanggal terkini. Setahun lalu ada sembilan belas, dan mungkin hanya tiga yang bisa saya bela. ",
		),
		tx(
			"Ritus tidak membuat saya berbasis data; ia membuat saya jujur-data",
			link("#fn-1"),
		),
		tx(
			", yang lebih langka dan lebih berguna. Berbasis adalah arah. Jujur adalah disiplin. Dasbor mengaku dengan cara apa pun — satu-satunya pilihan adalah apakah Anda menjadwalkan pengakuan itu kuartalan, dengan kelembutan dan saksi, atau menunggu insiden yang membacakan layar Anda dengan lantang di depan semua orang.",
		),
	),
	fig(
		"gurat-01",
		"Empat angka di layar bersih dalam bingkai penuh",
		"Lebar penuh, empat angka",
		"full",
	),
	para(
		tx(
			"Jika Anda mengambil satu latihan dari esai ini, ambillah tiga pertanyaan itu. Berjalanlah ke dasbor terdekat — milik Anda, milik tim, yang di TV kantor — dan tanyakan pada setiap panel: siapa memutuskan, apa berubah, kapan terakhir. Anda akan menemukan memorial dalam hitungan menit. Beri ia tiga puluh hari dan catatan bertanggal. Layar makin kosong. Pikiran mengikuti. Dan di suatu tempat dalam ruang putih baru itu, angka yang benar-benar penting akhirnya punya ruang untuk terlihat.",
		),
	),
	fig(
		"gurat-02",
		"Cahaya pagi di atas layar bersih",
		"Pagi, layar bersih",
		"inline",
	),
	para(
		tx(
			"Dasbor adalah pengakuan yang kita perbarui setiap hari tanpa sadar sedang mengaku. Audit pengakuan itu. Hapus kecemasan usang. Simpan keramahan. Layar yang Anda tatap seharian sedang membentuk tim yang Anda menjadi — buatlah bentuk yang berani Anda tandatangani, beri tanggal, dan bacakan lantang sekali kuartal, dengan saksi. Layar membosankan, tim jujur. Itulah seluruh tesis, dan ia muat di ruang putih yang baru Anda buat. Dan ruang putih itu bekerja lebih keras dari dasbor penuh mana pun: setiap angka yang tersisa kini punya nama, keputusan, dan tanggal terkini, sehingga pagi dimulai dengan kejelasan alih-alih kecemasan. Itulah imbalan ritus kuartalan — bukan layar yang lebih kecil, melainkan pikiran yang lebih jernih, yang tahu persis apa yang diawasi dan mengapa, setiap hari, tanpa kecuali, kuartal demi kuartal, tahun demi tahun.",
		),
	),
	footnote(
		para(
			tx(
				"Grafik kesombongan real-time itu: indah, mahal, melacak metrik yang tak pernah dipakai keputusan apa pun. Dihapus musim semi lalu, tak diratapi siapa pun.",
			),
		),
	),
	footnote(
		para(
			tx(
				"Grafik latensi yang pulang: dihapus dengan lantang, dirindukan tepat sekali, dipulihkan dengan hormat dan ambang lebih baik.",
			),
		),
	),
	footnote(
		para(
			tx(
				"Judul ganda esai ini menjaga jangkar -2-nya terdengar: kelangsungan, diperiksa dua kali.",
			),
		),
	),
);
// --- NO.012 · film + notes -------------------------------------------------------
// Rotation slot n=5: fixtures gurat-12,13,14,01,02,03,04,05,06,07.

const EN_012 = doc(
	heading(2, tx("Rooms without people")),
	para(
		tx(
			"There is a photograph I return to every winter: an empty room, morning light, one chair slightly turned as if someone just left or is about to arrive. Nobody is in it and everybody is. Empty rooms are the most honest portraits we have — they show the shape a life makes when the life steps out for a moment. Cinema knows this. The great room shots hold a beat after the actors leave, or arrive a beat before they enter, and in that unpeopled interval the space itself performs: dust in the light, a curtain still settling, the recent past still warm in the cushions. This essay is about those intervals, in film and in the rooms we actually live in, and about learning to see absence as a presence with its own posture.",
		),
	),
	fig(
		"gurat-12",
		"An empty room in morning light, one chair turned",
		"The chair, mid-thought",
		"inline",
	),
	para(
		tx("Directors use emptiness the way composers use "),
		tx("rests", bold()),
		tx(
			" — not as nothing, but as phrasing. A held empty shot after an argument lets the argument keep ringing; a room shown before its occupant enters arrives pre-loaded with expectation. The Japanese living rooms of Ozu, the motel corridors of the American night, the kitchens where nothing happens for minutes: these are not establishing shots. They are ",
		),
		tx("portraits of the recently left", italic()),
		tx(". My shot log is a plain "),
		tx("text file", code()),
		tx(
			" of timestamps and room descriptions; the annotated version lives in the ",
		),
		tx("relative archive", link("/writing/no-012-empty-rooms")),
		tx(
			", and a cinematographer's masterclass on negative space sits bookmarked on an ",
		),
		tx("interview page", link("https://example.com/empty-rooms")),
		tx(
			". Watch enough of them and you develop an ear for architecture the way musicians develop perfect pitch: this room is in a major key, that corridor resolves.",
		),
	),
	heading(2, tx("The interval performs")),
	para(
		tx(
			"The interval has a duration worth measuring. Too short and the room is scenery, flashing past on the way to the people. Too long and the audience revolts — I have felt the revolt, a physical itch at minute three of a locked-off hallway, followed by the strangest surrender. Somewhere past the itch the room stops being background and becomes subject, and you start noticing the way you notice things in your own home at 6 a.m.: peripherally, tenderly, without agenda. ",
		),
		sidenote(
			"1",
			tx(
				"The itch at minute three is the toll. Pay it; the room is worth more.",
			),
		),
		tx(
			" Filmmakers who trust the interval are trusting you — trusting that your attention, left alone with a space, will find the performance in it. Most of the time they are right. The room was performing all along. You were just never given the time to be its audience.",
		),
	),
	fig(
		"gurat-13",
		"A corridor in half-light, doors closed",
		"The corridor holds its breath",
		"offset",
	),
	para(
		tx(
			"I started photographing my own rooms the way those directors shoot theirs: after everyone leaves, before anyone returns, the interval when the apartment is most itself. The results embarrassed my housekeeping and vindicated my attention. A mug left mid-table tells you more about the morning than any diary entry; the dent in the sofa cushion is a portrait of the reader who just stood up. ",
		),
		sidenote(
			"2",
			tx(
				"Photograph the room right after leaving it. You will see who lives there.",
			),
		),
		tx(
			" We curate our spaces for visitors and neglect them for ourselves, but the camera in the interval sees the uncurated truth: the everyday debris of a life actually being lived. These photographs are the only ones I never post. They are not for showing. They are for seeing — private screenings of the film my rooms make when I am not performing in them.",
		),
	),
	heading(2, tx("The interval performs")),
	para(
		tx(
			"Performance deserves its encore, because the interval performs twice: once in the film, once in the viewer. The first performance is the room's — dust, settling curtains, cooling cushions. The second is yours — the memories that an empty kitchen summons uninvited, the grandmother's hallway, the apartment you left at twenty-three. Empty rooms are memory machines with the safeties off. Directors know this and aim the machine carefully; the locked-off shot is never really of the room on screen. It is of every room you have ever left, superimposed. That is why the interval lands differently at forty than at twenty. The machine has more footage to work with. The rooms accumulate. So do you.",
		),
	),
	fig(
		"gurat-14",
		"Two kitchens shot from the same doorway",
		"Two kitchens, one doorway",
		"pair",
	),
	fig(
		"gurat-01",
		"The same doorway in evening light",
		"Evening shift, same door",
		"pair",
	),
	quote(
		para(
			tx(
				"Empty rooms are the most honest portraits we have — the shape a life makes when it steps out.",
			),
		),
	),
	heading(3, tx("A practice of leaving")),
	para(
		tx(
			"Once a week, leave a room and come back with the camera. Not the big camera — the phone is fine, the practice is in the returning, not the gear. Shoot the interval: the desk as the work left it, the kitchen as breakfast abandoned it, the hallway holding the shape of whoever just passed. Do not tidy first. Tidying is lying to the only audience that matters, which is you, later. Date the photographs. In a year, open the folder and watch the film your rooms made while you were busy living in them. You will find performances you never attended: the season changing the angle of the light, the slow migration of objects toward the places they are actually used, the chair that turned, over months, to face the window instead of the television. Rooms direct themselves. The practice is just showing up to the screening.",
		),
	),
	fig(
		"gurat-02",
		"Three desks in three seasons of light",
		"Spring desk",
		"triptych",
	),
	fig("gurat-03", "A second desk in summer glare", "Summer desk", "triptych"),
	fig("gurat-04", "A third desk under winter lamp", "Winter desk", "triptych"),
	codeBlock(
		"text",
		"interval rite:\n  leave the room; return with camera\n  do not tidy; shoot as left\n  date it; review yearly",
	),
	para(
		tx(
			"That is the whole rite, and it costs nothing, and the yearly review has become my favorite film festival — one viewer, one screen, a program of rooms I lived in and never properly saw. Last year's program ran eleven minutes. I cried at the kitchen. Nobody will ever nominate these films for anything, which is precisely their value. They were not made to be watched. They were made by living, and watching them afterward is how the living finally gets seen.",
		),
	),
	fig(
		"gurat-05",
		"A wide living room with all its lived-in clutter",
		"A wide view of the living room",
		"wide",
	),
	pullquote(
		para(
			tx(
				"Rooms direct themselves. The practice is just showing up to the screening.",
			),
		),
	),
	heading(2, tx("The chair is still turned")),
	para(
		tx(
			"The winter photograph still hangs by my desk: the empty room, the morning light, the chair slightly turned. I have never straightened that chair in real life — it has become a small shrine to the interval, a reminder that absence has posture too. Visitors ask about the photograph. I tell them it is a portrait. They look for the person. ",
		),
		tx(
			"The person stepped out a beat ago and will return in a beat",
			link("#fn-1"),
		),
		tx(
			"; the portrait caught the room performing in between. That is all any portrait ever catches, really — the interval between arrivals. People are just rooms that move. Rooms are just people, holding still, waiting for the light to be right.",
		),
	),
	fig(
		"gurat-06",
		"The turned chair in full frame",
		"Full width, turned chair",
		"full",
	),
	para(
		tx(
			"If you take one practice from this essay, take the return. Leave the room, come back with the camera, do not tidy. The interval will perform whether or not you attend — dust, light, settling curtains — but attending changes the performance into a portrait, and the portrait into a record, and the record, dated and kept, into proof that a life was here, making its shape in the cushions, one unpeopled minute at a time.",
		),
	),
	fig(
		"gurat-07",
		"Evening in the same room, lamp on",
		"Evening, lamp on",
		"inline",
	),
	para(
		tx(
			"Rooms without people are not empty. They are full of the recently left and the about to arrive, full of dust performing in the light, full of chairs turned toward windows by months of quiet preference. Learn to see the interval and you learn to see everything else the same way: the pause in the conversation where the truth sits, the rest in the music where the feeling lives, the empty page where the essay waits. Absence is a presence with its own posture. Give it a beat. It will perform.",
		),
	),
	footnote(
		para(
			tx(
				"Ozu's hallways: tatami shots held past narrative function, the room as the film's memory.",
			),
		),
	),
	footnote(
		para(
			tx(
				"The itch at minute three has been measured in test screenings; the surrender after it has not.",
			),
		),
	),
	footnote(
		para(
			tx(
				"This essay's doubled heading performs its own interval: the same room, shot twice.",
			),
		),
	),
);

const ID_012 = doc(
	heading(2, tx("Ruangan tanpa orang")),
	para(
		tx(
			"Ada foto yang saya kunjungi setiap musim dingin: ruangan kosong, cahaya pagi, satu kursi sedikit miring seolah seseorang baru pergi atau akan tiba. Tak ada siapa pun di dalamnya dan semua orang ada. Ruangan kosong adalah potret paling jujur yang kita miliki — mereka menunjukkan bentuk yang dibuat hidup saat hidup itu keluar sejenak. Sinema tahu ini. Bidikan ruangan yang hebat bertahan seketuk setelah aktor pergi, atau tiba seketuk sebelum mereka masuk, dan dalam jeda tanpa manusia itu ruang itu sendiri tampil: debu dalam cahaya, gorden yang masih mereda, masa lalu yang baru saja masih hangat di bantal. Esai ini tentang jeda-jeda itu, dalam film maupun di ruangan yang benar-benar kita huni, dan tentang belajar melihat ketiadaan sebagai kehadiran dengan posturnya sendiri.",
		),
	),
	fig(
		"gurat-12",
		"Ruangan kosong dalam cahaya pagi, satu kursi miring",
		"Kursi itu, tengah berpikir",
		"inline",
	),
	para(
		tx("Sutradara memakai kekosongan seperti komponis memakai "),
		tx("tanda istirahat", bold()),
		tx(
			" — bukan sebagai ketiadaan, melainkan sebagai frasa. Bidikan kosong yang ditahan setelah pertengkaran membiarkan pertengkaran terus bergema; ruangan yang ditunjukkan sebelum penghuninya masuk tiba dengan muatan harapan. Ruang tamu Jepang ala Ozu, koridor motel malam Amerika, dapur tempat tak terjadi apa-apa selama menit-menit: ini bukan bidikan pembuka. Mereka adalah ",
		),
		tx("potret yang baru saja ditinggalkan", italic()),
		tx(". Log bidikan saya adalah "),
		tx("berkas teks", code()),
		tx(
			" polos berisi stempel waktu dan deskripsi ruangan; versi beranotasi tinggal di ",
		),
		tx("arsip relatif", link("/id/writing/no-012-ruang-kosong")),
		tx(
			", dan kelas master sinematografer tentang ruang negatif ter-markah di ",
		),
		tx("laman wawancara", link("https://example.com/empty-rooms")),
		tx(
			". Tonton cukup banyak dan Anda mengembangkan telinga untuk arsitektur seperti musisi mengembangkan nada absolut: ruangan ini bernada mayor, koridor itu meresolusi.",
		),
	),
	heading(2, tx("Jeda itu tampil")),
	para(
		tx(
			"Jeda punya durasi yang layak diukur. Terlalu pendek dan ruangan menjadi pemandangan, melintas menuju orang-orangnya. Terlalu panjang dan penonton memberontak — saya pernah merasakan pemberontakan itu, gatal fisik pada menit ketiga koridor terkunci, diikuti penyerahan paling aneh. Di suatu tempat melewati gatal ruangan berhenti menjadi latar dan menjadi subjek, dan Anda mulai memperhatikan seperti Anda memperhatikan di rumah sendiri pukul 6 pagi: periferal, lembut, tanpa agenda. ",
		),
		sidenote(
			"1",
			tx(
				"Gatal pada menit ketiga adalah tolnya. Bayarlah; ruangan itu lebih berharga.",
			),
		),
		tx(
			" Sineas yang memercayai jeda sedang memercayai Anda — memercayai bahwa perhatian Anda, ditinggal sendirian bersama ruang, akan menemukan pertunjukan di dalamnya. Kebanyakan mereka benar. Ruangan itu selama ini tampil. Anda saja tak pernah diberi waktu menjadi penontonnya.",
		),
	),
	fig(
		"gurat-13",
		"Koridor dalam setengah cahaya, pintu-pintu tertutup",
		"Koridor menahan napas",
		"offset",
	),
	para(
		tx(
			"Saya mulai memotret ruangan sendiri seperti para sutradara itu memotret miliknya: setelah semua orang pergi, sebelum siapa pun kembali, jeda saat apartemen paling menjadi dirinya. Hasilnya memalukan kerapian rumah saya dan membenarkan perhatian saya. Cangkir yang tertinggal di tengah meja memberi tahu lebih banyak tentang pagi itu daripada entri diari mana pun; lekuk di bantal sofa adalah potret pembaca yang baru berdiri. ",
		),
		sidenote(
			"2",
			tx(
				"Potret ruangan tepat setelah meninggalkannya. Anda akan melihat siapa tinggal di sana.",
			),
		),
		tx(
			" Kita menata ruang untuk tamu dan menelantarkannya untuk diri sendiri, tetapi kamera dalam jeda melihat kebenaran yang tak ditata: puing sehari-hari kehidupan yang benar-benar dijalani. Foto-foto ini satu-satunya yang tak pernah saya posting. Mereka bukan untuk ditunjukkan. Mereka untuk melihat — pemutaran privat atas film yang dibuat ruangan saya saat saya tidak tampil di dalamnya.",
		),
	),
	heading(2, tx("Jeda itu tampil")),
	para(
		tx(
			"Pertunjukan layak encore-nya, karena jeda tampil dua kali: sekali dalam film, sekali dalam penonton. Pertunjukan pertama milik ruangan — debu, gorden yang mereda, bantal yang mendingin. Yang kedua milik Anda — kenangan yang dipanggil dapur kosong tanpa diundang, lorong nenek, apartemen yang Anda tinggalkan di usia dua puluh tiga. Ruangan kosong adalah mesin memori dengan pengaman dilepas. Sutradara tahu ini dan mengarahkan mesin dengan hati-hati; bidikan terkunci tak pernah benar-benar tentang ruangan di layar. Ia tentang setiap ruangan yang pernah Anda tinggalkan, bertumpuk. Itulah mengapa jeda mendarat berbeda di usia empat puluh daripada dua puluh. Mesin punya lebih banyak rekaman untuk diolah. Ruangan-ruangan menumpuk. Anda pun.",
		),
	),
	fig(
		"gurat-14",
		"Dua dapur dibidik dari pintu yang sama",
		"Dua dapur, satu pintu",
		"pair",
	),
	fig(
		"gurat-01",
		"Pintu yang sama dalam cahaya senja",
		"Shift senja, pintu sama",
		"pair",
	),
	quote(
		para(
			tx(
				"Ruangan kosong adalah potret paling jujur yang kita miliki — bentuk yang dibuat hidup saat ia keluar.",
			),
		),
	),
	heading(3, tx("Latihan pergi")),
	para(
		tx(
			"Seminggu sekali, tinggalkan ruangan dan kembalilah dengan kamera. Bukan kamera besar — ponsel cukup, latihannya ada pada kembalinya, bukan pada giginya. Bidik jedanya: meja sebagaimana ditinggalkan pekerjaan, dapur sebagaimana ditinggalkan sarapan, lorong yang memegang bentuk siapa pun yang baru lewat. Jangan bereskan dulu. Membereskan adalah berbohong pada satu-satunya penonton yang penting, yaitu Anda, nanti. Beri tanggal pada foto. Dalam setahun, bukalah folder dan saksikan film yang dibuat ruangan Anda selagi Anda sibuk menghuninya. Anda akan menemukan pertunjukan yang tak pernah Anda hadiri: musim mengubah sudut cahaya, migrasi lambat benda ke tempat mereka benar-benar dipakai, kursi yang berputar, selama berbulan-bulan, menghadap jendela alih-alih televisi. Ruangan menyutradarai dirinya. Latihannya hanyalah datang ke pemutarannya.",
		),
	),
	fig("gurat-02", "Tiga meja dalam tiga musim cahaya", "Meja semi", "triptych"),
	fig(
		"gurat-03",
		"Meja kedua dalam silau musim panas",
		"Meja panas",
		"triptych",
	),
	fig(
		"gurat-04",
		"Meja ketiga di bawah lampu musim dingin",
		"Meja dingin",
		"triptych",
	),
	codeBlock(
		"text",
		"ritus jeda:\n  tinggalkan ruangan; kembali dengan kamera\n  jangan bereskan; bidik apa adanya\n  beri tanggal; tinjau tahunan",
	),
	para(
		tx(
			"Itulah seluruh ritus, dan gratis, dan tinjauan tahunan telah menjadi festival film favorit saya — satu penonton, satu layar, program ruangan yang saya huni dan tak pernah benar-benar saya lihat. Program tahun lalu berjalan sebelas menit. Saya menangis di dapur. Tak ada yang akan menominasikan film-film ini untuk apa pun, dan itulah tepat nilainya. Mereka tidak dibuat untuk ditonton. Mereka dibuat oleh hidup, dan menontonnya setelahnya adalah cara hidup itu akhirnya terlihat.",
		),
	),
	fig(
		"gurat-05",
		"Ruang tamu lebar dengan segala keserakan yang dihuni",
		"Pandangan lebar atas ruang tamu",
		"wide",
	),
	pullquote(
		para(
			tx(
				"Ruangan menyutradarai dirinya. Latihannya hanyalah datang ke pemutarannya.",
			),
		),
	),
	heading(2, tx("Kursi itu masih miring")),
	para(
		tx(
			"Foto musim dingin itu masih tergantung di samping meja saya: ruangan kosong, cahaya pagi, kursi sedikit miring. Saya tak pernah meluruskan kursi itu dalam hidup nyata — ia telah menjadi kuil kecil bagi jeda, pengingat bahwa ketiadaan pun punya postur. Pengunjung bertanya tentang foto itu. Saya bilang itu potret. Mereka mencari orangnya. ",
		),
		tx(
			"Orang itu keluar seketuk lalu dan akan kembali seketuk lagi",
			link("#fn-1"),
		),
		tx(
			"; potret menangkap ruangan yang tampil di antaranya. Itulah semua yang pernah ditangkap potret mana pun, sungguh — jeda di antara kedatangan. Manusia hanyalah ruangan yang bergerak. Ruangan hanyalah manusia, yang diam, menunggu cahaya yang tepat.",
		),
	),
	fig(
		"gurat-06",
		"Kursi miring dalam bingkai penuh",
		"Lebar penuh, kursi miring",
		"full",
	),
	para(
		tx(
			"Jika Anda mengambil satu latihan dari esai ini, ambillah kembali itu. Tinggalkan ruangan, kembalilah dengan kamera, jangan bereskan. Jeda akan tampil terlepas Anda hadir atau tidak — debu, cahaya, gorden yang mereda — tetapi menghadiri mengubah pertunjukan menjadi potret, dan potret menjadi catatan, dan catatan, yang bertanggal dan disimpan, menjadi bukti bahwa hidup pernah di sini, membuat bentuknya di bantal, satu menit tanpa manusia dalam satu waktu.",
		),
	),
	fig(
		"gurat-07",
		"Senja di ruangan yang sama, lampu menyala",
		"Senja, lampu menyala",
		"inline",
	),
	para(
		tx(
			"Ruangan tanpa orang tidak kosong. Mereka penuh dengan yang baru pergi dan yang akan tiba, penuh debu yang tampil dalam cahaya, penuh kursi yang berputar menuju jendela oleh preferensi tenang berbulan-bulan. Belajarlah melihat jeda dan Anda belajar melihat segala yang lain dengan cara sama: jeda dalam percakapan tempat kebenaran duduk, istirahat dalam musik tempat perasaan tinggal, halaman kosong tempat esai menunggu. Ketiadaan adalah kehadiran dengan posturnya sendiri. Beri ia seketuk. Ia akan tampil. Dan penampilan itu menular ke cara Anda memasuki setiap ruangan sesudahnya — lebih lambat, lebih memperhatikan, bertanya apa yang dilakukan cahaya sebelum bertanya apa yang harus dilakukan. Itulah hadiah latihan kembali: bukan foto-foto, melainkan mata yang membawanya pulang, yang kini melihat interval di mana-mana, menunggu seketuk, siap menjadi penonton bagi pertunjukan tenang yang tak pernah berhenti, musim demi musim, ruangan demi ruangan, tahun demi tahun yang penuh perhatian. Latihan ini tidak meminta bakat atau peralatan, hanya kesediaan untuk kembali dan melihat lagi, dengan mata yang segar setiap musimnya, memperhatikan cahaya yang berubah dan bayangan yang bergeser, selalu hadir.",
		),
	),
	footnote(
		para(
			tx(
				"Lorong-lorong Ozu: bidikan tatami yang ditahan melewati fungsi naratif, ruangan sebagai memori film.",
			),
		),
	),
	footnote(
		para(
			tx(
				"Gatal pada menit ketiga telah diukur dalam uji pemutaran; penyerahan setelahnya belum.",
			),
		),
	),
	footnote(
		para(
			tx(
				"Judul ganda esai ini menampilkan jedanya sendiri: ruangan yang sama, dibidik dua kali.",
			),
		),
	),
);
// --- NO.013 · music --------------------------------------------------------------
// Rotation slot n=6: fixtures gurat-03,04,05,06,07,08,09,10,11,12.

const EN_013 = doc(
	heading(2, tx("Sixty beats per minute")),
	para(
		tx(
			"The metronome is the most honest instrument I own. It has one job — sixty beats per minute, or ninety, or whatever merciless number I set — and it does it without interpretation, encouragement, or pity. Musicians have a complicated relationship with this little box. Beginners hate it because it exposes every wobble. Professionals love it for the same reason. I bought mine after a teacher listened to me rush through a difficult passage for the third time and said, very gently, that I was lying to both of us. She was right. Without the click I played the easy parts fast and the hard parts slow, which felt expressive and was actually just cowardice with rubato. The metronome ended the lying. This essay is about what sixty honest beats per minute taught me about music, work, and the heart underneath both.",
		),
	),
	fig(
		"gurat-03",
		"A metronome on a piano, needle mid-swing",
		"Sixty, merciless",
		"inline",
	),
	para(
		tx("The practice is brutally simple and therefore widely avoided: "),
		tx("slow it down until it is perfect, then speed up by four", bold()),
		tx(
			". Perfect means boring — every note even, every gap identical, no expressive rushing where the fingers get confident. My first honest tempo for the difficult passage was half what I had been pretending, a humiliation measured in ",
		),
		tx("maestoso dragging", italic()),
		tx(" that lasted weeks. The log is a "),
		tx("tempo diary", code()),
		tx(
			" (date, piece, honest bpm, target bpm); the method write-up sits in the ",
		),
		tx("relative archive", link("/writing/no-013-metronome-heart")),
		tx(", and the teacher's original exercise sheet is scanned on a "),
		tx("studio page", link("https://example.com/metronome-method")),
		tx(
			". Four beats per minute per day. No more. The metronome does not negotiate, which is exactly why it works: progress becomes a number, and numbers, unlike feelings, cannot be flattered.",
		),
	),
	heading(2, tx("The heart keeps its own tempo")),
	para(
		tx(
			"Here is the strange part nobody warns you about. After months of practicing against the click, I started hearing it everywhere — in footsteps, in windshield wipers, in the hospital corridor where I sat last winter counting my father's breathing against a wall clock. Sixty beats per minute is resting heart rate, roughly, and the body knows this long before the mind does. The metronome had been training something deeper than timing. It had been training steadiness: the ability to hold a pulse while everything around it wobbles. ",
		),
		sidenote(
			"1",
			tx(
				"Practice steadiness, not speed. Speed is steadiness that arrived early.",
			),
		),
		tx(
			" In the corridor, counting breaths against the clock, I understood what the teacher had really been teaching. Not the passage. Me. The music was the pretext. The pulse was the point — a steadiness you can carry out of the practice room into every room that needs it.",
		),
	),
	fig(
		"gurat-04",
		"Hands on keys with the metronome blurred behind",
		"Steadiness, foreground",
		"offset",
	),
	para(
		tx(
			"Work stole the method within a year, as work steals every good method. The four-bpm rule became the one-small-task rule: one honest unit of the hard thing per day, no heroic sessions, no expressive rushing through the easy parts. Code reviews got the metronome treatment — slow, even, every line, especially the ones that looked fine. Writing got it too: one paragraph a day at the honest tempo, the speed at which the thinking is actually clear, not the speed at which the deadline panics. ",
		),
		sidenote(
			"2",
			tx(
				"Find your honest tempo at work: the speed where the thinking stays clear.",
			),
		),
		tx(
			" Everything I had learned about cowardice with rubato applied perfectly to every craft with a difficult passage. The metronome is a small box. Its lessons are not small. They transfer the way steadiness transfers — quietly, completely, into rooms the box will never enter.",
		),
	),
	heading(2, tx("The heart keeps its own tempo")),
	para(
		tx(
			"Tempo deserves its reprise, because the heart keeps more than one. There is the resting sixty of ordinary days, the ninety of good news taken at speed, the one-twenty of the difficult conversation rehearsed in the car. The metronome taught me to hear these the way a musician hears time signatures: not as noise but as information about what the body believes is happening. Rushing through the easy parts of a day — the commute, the queue, the small talk — is the same cowardice as rushing the easy bars. The hard parts deserve slowness and the easy parts deserve presence, and the click, internalized after all those months, now marks both. I carry sixty honest beats everywhere. They cost nothing. They keep everything.",
		),
	),
	fig(
		"gurat-05",
		"Two metronomes set to different tempos",
		"Sixty against ninety",
		"pair",
	),
	fig(
		"gurat-06",
		"A second pair mid-swing, blurred",
		"The blur is the lesson",
		"pair",
	),
	quote(
		para(
			tx(
				"The metronome ended the lying. Progress becomes a number, and numbers cannot be flattered.",
			),
		),
	),
	heading(3, tx("The honest-tempo method")),
	para(
		tx(
			"Find the passage you rush — in music, in code, in the morning routine you sprint through. Set the click to half the speed you think you deserve. Play it perfectly at that tempo: boring, even, no expression, just accuracy. This will feel insulting for exactly as long as it needs to. Then add four beats per day, never more, logging the honest number each session. Some days the number drops; the log keeps those days too, because honesty includes the bad mornings. In weeks the passage plays itself at a tempo you once faked. The difference is audible to everyone in the room, but only you know what it cost: slowness, daily, without witnesses. The method works on everything with a difficult passage. Everything has a difficult passage. That is why the method works on everything.",
		),
	),
	fig(
		"gurat-07",
		"Three practice logs with climbing numbers",
		"Week one, week four, week nine",
		"triptych",
	),
	fig(
		"gurat-08",
		"A second log with one bad week inked over",
		"The bad week, kept",
		"triptych",
	),
	fig(
		"gurat-09",
		"A third log, target tempo circled",
		"Target, circled",
		"triptych",
	),
	codeBlock(
		"text",
		"honest-tempo method:\n  halve the speed you think you deserve\n  perfect = boring and even\n  +4 bpm per day, log every session",
	),
	para(
		tx(
			"That is the whole method, and it fits on the metronome's lid, and it has never failed a passage I actually practiced. Note the qualifier. The method fails constantly on passages I merely thought about practicing, read about practicing, or discussed practicing over coffee. Thinking is not practice. The click knows the difference — it counts only the beats you actually play. Everything else is silence, and the metronome, honest to the end, does not count silence.",
		),
	),
	fig(
		"gurat-10",
		"A wide practice room with instruments waiting",
		"A wide view of the practice room",
		"wide",
	),
	pullquote(para(tx("The music was the pretext. The pulse was the point."))),
	heading(2, tx("Coda: the corridor")),
	para(
		tx(
			"My father recovered, and the corridor stays with me anyway — the wall clock, the counted breathing, the steadiness I had not known I was training for. I told the teacher this story at my next lesson, expecting musical advice. She adjusted the metronome to sixty, set it ticking, and said nothing for a full minute while we both listened. ",
		),
		tx("That minute is the best lesson I have ever received", link("#fn-1")),
		tx(
			", and it contained no instruction at all. Just sixty honest beats, shared, in a room that needed them. The metronome does one thing. It turns out the one thing is almost everything: hold the pulse while the world wobbles, in music, in work, in hospital corridors at midnight. Sixty beats per minute. No interpretation. No pity. Just the steady truth, ticking.",
		),
	),
	fig(
		"gurat-11",
		"An empty chair beside a window in full frame",
		"Full width, sixty beats",
		"full",
	),
	para(
		tx(
			"If you take one practice from this essay, take the halving. Find the passage you rush, set the click to half, play it boring until it is perfect. Day nine will come for your patience the way it comes for every practice. Let it. What waits past it is not a faster tempo but an honest one — and honesty, held steady at sixty beats per minute, turns out to be fast enough for everything that matters.",
		),
	),
	fig(
		"gurat-12",
		"The metronome at rest, needle still",
		"At rest, still honest",
		"inline",
	),
	para(
		tx(
			"The metronome sits silent on the piano now, needle still, job done for the day. It asks nothing, keeps nothing, flatters nothing. Tomorrow I will wind it again and it will tell me the truth again, one honest beat at a time, until the difficult passage plays itself and I sit back and listen to steadiness doing what steadiness does: holding, holding, holding — the pulse underneath the music, the heart underneath the work, the sixty quiet beats that carry everything else.",
		),
	),
	footnote(
		para(
			tx(
				"The teacher's sentence, verbatim: 'You are lying to both of us, darling. The box does not lie. Start there.'",
			),
		),
	),
	footnote(
		para(
			tx(
				"Four bpm per day is slow enough to feel insulting and fast enough to double a tempo in a month. The math is the pedagogy.",
			),
		),
	),
	footnote(
		para(
			tx(
				"This essay's doubled heading keeps honest time: the same pulse, counted twice.",
			),
		),
	),
);

const ID_013 = doc(
	heading(2, tx("Enam puluh ketukan per menit")),
	para(
		tx(
			"Metronom adalah instrumen paling jujur yang saya miliki. Ia punya satu tugas — enam puluh ketukan per menit, atau sembilan puluh, atau angka tanpa ampun apa pun yang saya setel — dan ia melakukannya tanpa interpretasi, dorongan, atau iba. Musisi punya hubungan rumit dengan kotak kecil ini. Pemula membencinya karena ia mengekspos setiap goyangan. Profesional mencintainya karena alasan yang sama. Saya membelinya setelah seorang guru mendengarkan saya bergegas melewati bagian sulit untuk ketiga kalinya dan berkata, dengan sangat lembut, bahwa saya membohongi kami berdua. Ia benar. Tanpa klik saya memainkan bagian mudah dengan cepat dan bagian sulit dengan lambat, yang terasa ekspresif dan sebenarnya hanyalah kepengecutan berbalut rubato. Metronom mengakhiri kebohongan. Esai ini tentang apa yang diajarkan enam puluh ketukan jujur per menit kepada saya tentang musik, kerja, dan jantung di bawah keduanya.",
		),
	),
	fig(
		"gurat-03",
		"Metronom di atas piano, jarum di tengah ayunan",
		"Enam puluh, tanpa ampun",
		"inline",
	),
	para(
		tx("Latihannya sederhana secara brutal sehingga banyak dihindari: "),
		tx("perlambat sampai sempurna, lalu naikkan empat", bold()),
		tx(
			". Sempurna berarti membosankan — setiap not rata, setiap jeda identik, tanpa bergegas ekspresif di bagian jari percaya diri. Tempo jujur pertama saya untuk bagian sulit adalah setengah dari yang selama ini saya pura-purakan, penghinaan yang diukur dalam ",
		),
		tx("maestoso yang terseret", italic()),
		tx(" selama berminggu-minggu. Lognya adalah "),
		tx("diari tempo", code()),
		tx(" (tanggal, karya, bpm jujur, bpm target); tulisan metodenya ada di "),
		tx("arsip relatif", link("/id/writing/no-013-metronom-hati")),
		tx(", dan lembar latihan asli guru itu dipindai di "),
		tx("laman studio", link("https://example.com/metronome-method")),
		tx(
			". Empat ketukan per menit per hari. Tidak lebih. Metronom tidak bernegosiasi, dan justru itulah mengapa ia bekerja: kemajuan menjadi angka, dan angka, tak seperti perasaan, tak bisa disanjung.",
		),
	),
	heading(2, tx("Jantung menyimpan temponya sendiri")),
	para(
		tx(
			"Inilah bagian aneh yang tak diperingatkan siapa pun. Setelah berbulan-bulan berlatih melawan klik, saya mulai mendengarnya di mana-mana — dalam langkah kaki, dalam penghapus kaca, di koridor rumah sakit tempat saya duduk musim dingin lalu menghitung napas ayah saya terhadap jam dinding. Enam puluh ketukan per menit kira-kira adalah detak jantung istirahat, dan tubuh tahu ini jauh sebelum pikiran. Metronom telah melatih sesuatu yang lebih dalam dari ketepatan. Ia melatih keteguhan: kemampuan menahan denyut selagi segala di sekitarnya bergoyang. ",
		),
		sidenote(
			"1",
			tx(
				"Latihlah keteguhan, bukan kecepatan. Kecepatan adalah keteguhan yang tiba lebih awal.",
			),
		),
		tx(
			" Di koridor itu, menghitung napas terhadap jam, saya memahami apa yang sebenarnya diajarkan guru. Bukan bagiannya. Saya. Musik adalah dalih. Denyut adalah intinya — keteguhan yang bisa dibawa keluar ruang latihan ke setiap ruangan yang membutuhkannya.",
		),
	),
	fig(
		"gurat-04",
		"Tangan di atas tuts dengan metronom buram di belakang",
		"Keteguhan, latar depan",
		"offset",
	),
	para(
		tx(
			"Pekerjaan mencuri metode itu dalam setahun, seperti pekerjaan mencuri setiap metode baik. Aturan empat-bpm menjadi aturan satu-tugas-kecil: satu unit jujur hal sulit per hari, tanpa sesi heroik, tanpa bergegas ekspresif melewati bagian mudah. Tinjauan kode mendapat perlakuan metronom — lambat, rata, setiap baris, terutama yang tampak baik-baik saja. Menulis pun: satu paragraf sehari pada tempo jujur, kecepatan di mana pemikiran benar-benar jernih, bukan kecepatan di mana tenggat panik. ",
		),
		sidenote(
			"2",
			tx(
				"Temukan tempo jujur Anda di kerja: kecepatan di mana pemikiran tetap jernih.",
			),
		),
		tx(
			" Segala yang saya pelajari tentang kepengecutan berbalut rubato berlaku sempurna pada setiap keterampilan berbagian sulit. Metronom adalah kotak kecil. Pelajarannya tidak kecil. Mereka menular seperti keteguhan menular — diam-diam, sepenuhnya, ke ruangan yang takkan pernah dimasuki kotak itu.",
		),
	),
	heading(2, tx("Jantung menyimpan temponya sendiri")),
	para(
		tx(
			"Tempo layak ulangan, karena jantung menyimpan lebih dari satu. Ada enam puluh istirahat hari-hari biasa, sembilan puluh kabar baik yang diambil dengan kecepatan, seratus dua puluh percakapan sulit yang dilatih di mobil. Metronom mengajari saya mendengarnya seperti musisi mendengar tanda birama: bukan sebagai kebisingan melainkan sebagai informasi tentang apa yang diyakini tubuh sedang terjadi. Bergegas melewati bagian mudah hari — perjalanan, antrean, basa-basi — adalah kepengecutan yang sama seperti bergegas melewati bar mudah. Bagian sulit layak lambat dan bagian mudah layak hadir, dan klik, yang terinternalisasi setelah berbulan-bulan itu, kini menandai keduanya. Saya membawa enam puluh ketukan jujur ke mana-mana. Gratis. Mereka menjaga segalanya.",
		),
	),
	fig(
		"gurat-05",
		"Dua metronom disetel pada tempo berbeda",
		"Enam puluh lawan sembilan puluh",
		"pair",
	),
	fig(
		"gurat-06",
		"Pasangan kedua di tengah ayunan, buram",
		"Buram itulah pelajarannya",
		"pair",
	),
	quote(
		para(
			tx(
				"Metronom mengakhiri kebohongan. Kemajuan menjadi angka, dan angka tak bisa disanjung.",
			),
		),
	),
	heading(3, tx("Metode tempo-jujur")),
	para(
		tx(
			"Temukan bagian yang Anda bergegas — dalam musik, dalam kode, dalam rutinitas pagi yang Anda sprinti. Setel klik pada setengah kecepatan yang menurut Anda pantas. Mainkan sempurna pada tempo itu: membosankan, rata, tanpa ekspresi, hanya akurasi. Ini akan terasa menghina tepat selama yang dibutuhkan. Lalu tambah empat ketukan per hari, jangan lebih, catat angka jujur setiap sesi. Ada hari angka turun; log menyimpan hari-hari itu juga, karena kejujuran mencakup pagi yang buruk. Dalam hitungan minggu bagian itu memainkan dirinya pada tempo yang dulu Anda palsukan. Bedanya terdengar oleh semua orang di ruangan, tetapi hanya Anda tahu harganya: lambat, harian, tanpa saksi. Metode bekerja pada segala yang berbagian sulit. Segala punya bagian sulit. Itulah mengapa metode bekerja pada segala.",
		),
	),
	fig(
		"gurat-07",
		"Tiga log latihan dengan angka menanjak",
		"Minggu satu, empat, sembilan",
		"triptych",
	),
	fig(
		"gurat-08",
		"Log kedua dengan satu minggu buruk bertinta",
		"Minggu buruk, disimpan",
		"triptych",
	),
	fig(
		"gurat-09",
		"Log ketiga, tempo target dilingkari",
		"Target, dilingkari",
		"triptych",
	),
	codeBlock(
		"text",
		"metode tempo-jujur:\n  belah dua kecepatan yang menurutmu pantas\n  sempurna = membosankan dan rata\n  +4 bpm per hari, catat setiap sesi",
	),
	para(
		tx(
			"Itulah seluruh metode, dan muat di tutup metronom, dan ia tak pernah gagal pada bagian yang benar-benar saya latih. Perhatikan kualifikasinya. Metode gagal terus pada bagian yang hanya saya pikirkan untuk dilatih, saya baca tentang melatihnya, atau saya diskusikan melatihnya sambil ngopi. Berpikir bukan berlatih. Klik tahu bedanya — ia hanya menghitung ketukan yang benar-benar Anda mainkan. Segala yang lain adalah hening, dan metronom, yang jujur sampai akhir, tidak menghitung keheningan.",
		),
	),
	fig(
		"gurat-10",
		"Ruang latihan lebar dengan instrumen menunggu",
		"Pandangan lebar atas ruang latihan",
		"wide",
	),
	pullquote(para(tx("Musik adalah dalih. Denyut adalah intinya."))),
	heading(2, tx("Koda: koridor itu")),
	para(
		tx(
			"Ayah saya pulih, dan koridor itu tetap tinggal bersama saya — jam dinding, napas yang dihitung, keteguhan yang tak saya tahu sedang saya latih. Saya menceritakan kisah ini pada guru di pelajaran berikutnya, mengharapkan nasihat musikal. Ia menyetel metronom ke enam puluh, membunyikannya, dan tidak berkata apa-apa selama satu menit penuh selagi kami berdua mendengarkan. ",
		),
		tx(
			"Satu menit itu adalah pelajaran terbaik yang pernah saya terima",
			link("#fn-1"),
		),
		tx(
			", dan tidak berisi instruksi sama sekali. Hanya enam puluh ketukan jujur, bersama, di ruangan yang membutuhkannya. Metronom melakukan satu hal. Ternyata satu hal itu hampir segalanya: tahan denyut selagi dunia bergoyang, dalam musik, dalam kerja, di koridor rumah sakit tengah malam. Enam puluh ketukan per menit. Tanpa interpretasi. Tanpa iba. Hanya kebenaran yang stabil, berdetak.",
		),
	),
	fig(
		"gurat-11",
		"Kursi kosong di samping jendela dalam bingkai penuh",
		"Lebar penuh, enam puluh ketukan",
		"full",
	),
	para(
		tx(
			"Jika Anda mengambil satu latihan dari esai ini, ambillah pembelahan itu. Temukan bagian yang Anda bergegas, setel klik pada setengahnya, mainkan membosankan sampai sempurna. Hari kesembilan akan datang untuk kesabaran Anda seperti ia datang untuk setiap latihan. Biarkan. Yang menunggu melewatinya bukanlah tempo lebih cepat melainkan tempo yang jujur — dan kejujuran, yang ditahan stabil pada enam puluh ketukan per menit, ternyata cukup cepat untuk segala yang penting.",
		),
	),
	fig(
		"gurat-12",
		"Metronom beristirahat, jarum diam",
		"Beristirahat, tetap jujur",
		"inline",
	),
	para(
		tx(
			"Metronom duduk diam di atas piano kini, jarum berhenti, tugas hari ini selesai. Ia tak meminta apa-apa, tak menyimpan apa-apa, tak menyanjung apa-apa. Besok saya akan memutarnya lagi dan ia akan mengatakan kebenaran lagi, satu ketukan jujur dalam satu waktu, sampai bagian sulit memainkan dirinya dan saya bersandar dan mendengarkan keteguhan melakukan apa yang dilakukan keteguhan: menahan, menahan, menahan — denyut di bawah musik, jantung di bawah kerja, enam puluh ketukan tenang yang menggendong segala yang lain. Dan gendongan itu adalah warisan latihan: keteguhan yang dibangun di ruang latihan berjalan keluar bersamanya, memasuki rapat dan koridor dan pagi-pagi yang sulit, menahan denyut selagi dunia bergoyang. Kotak kecil itu mengajarkan satu hal, setiap hari, tanpa kecuali, dengan sabar dan setia. Satu hal itu ternyata hampir segalanya.",
		),
	),
	footnote(
		para(
			tx(
				"Kalimat guru itu, verbatim: 'Kamu membohongi kami berdua, sayang. Kotak itu tidak berbohong. Mulailah dari sana.'",
			),
		),
	),
	footnote(
		para(
			tx(
				"Empat bpm per hari cukup lambat untuk terasa menghina dan cukup cepat untuk menggandakan tempo dalam sebulan. Matematika adalah pedagoginya.",
			),
		),
	),
	footnote(
		para(
			tx(
				"Judul ganda esai ini menjaga waktu jujur: denyut yang sama, dihitung dua kali.",
			),
		),
	),
);
// --- NO.014 · software (featured) ------------------------------------------------
// Rotation slot n=7: fixtures gurat-08,09,10,11,12,13,14,01,02,03.

const EN_014 = doc(
	heading(2, tx("The photograph comes first")),
	para(
		tx(
			"This page you are reading was built backwards. Most essays start with words and decorate them with pictures; this one started with fourteen photographs and asked the words to earn their place beside them. The photographs came first — real light, real rooms, fixed seeds so the layout proof would be deterministic — and everything you see around them, the numbered figures, the side captions, the pairs and triptychs, was designed as furniture for the images rather than the other way around. It felt unnatural for exactly one day. Then it felt obvious, the way all good constraints feel obvious in retrospect. Words argue. Photographs witness. A page that leads with witnessing reads differently: slower, quieter, with the text doing the humble work of labeling what the eye already knows.",
		),
	),
	fig(
		"gurat-08",
		"The desk where this page was laid out",
		"Where this page was built",
		"inline",
	),
	para(
		tx("The method has a name around here now: "),
		tx("photo-first editorial", bold()),
		tx(
			". It means every essay ships with its images chosen before its outline, and the outline bends to what the images actually show rather than what the draft wishes they showed. Captions are written last and cut first — if a paragraph says what the photograph says, the paragraph loses. The layout vocabulary is deliberately small: ",
		),
		tx("seven numbered groups", italic()),
		tx(", each counted and labeled, tracked in a "),
		tx("figure ledger", code()),
		tx("; the full specification lives in the "),
		tx("relative archive", link("/writing/no-014-photo-first")),
		tx(", and the reference photography that inspired it is catalogued on a "),
		tx("moodboard page", link("https://example.com/photo-first")),
		tx(
			". Small vocabularies force honesty. With only seven moves, every figure has to justify itself, and the ones that cannot are deleted, which is the highest compliment an editor can pay a layout.",
		),
	),
	heading(2, tx("Numbering is a promise")),
	para(
		tx(
			"Every figure on this page wears a number — 01 / 07 through 07 / 07 — and the numbers are a contract with the reader. They say: this essay has exactly seven visual thoughts, in this order, and none of them is decoration. Numbering disciplines the author more than the reader. An unnumbered image can sneak in to fill space; a numbered one must answer what number five means that number four did not. ",
		),
		sidenote(
			"1",
			tx(
				"Count your figures before you publish. If one has no job, delete it.",
			),
		),
		tx(
			" I have deleted more photographs from this series than I kept, and every deletion improved the survivors. The numbers also give readers a map: six of seven means the end is near, which changes how the last image lands. Structure is hospitality. Numbering is structure you can see, which is the most hospitable kind.",
		),
	),
	fig(
		"gurat-09",
		"Contact sheet with deletions marked in red",
		"What the numbers replaced",
		"offset",
	),
	para(
		tx(
			"Side captions were the hardest fight in the design, and the fight tells you what they are for. A caption under a photograph explains the photograph. A caption beside it converses with it — same image, different posture, the text standing next to the picture like a friend rather than sitting beneath it like a label. On narrow screens the conversation stacks vertically, which is fine; friendship survives stacking. ",
		),
		sidenote(
			"2",
			tx(
				"If the caption merely describes the image, delete the caption. Keep the image.",
			),
		),
		tx(
			" The rule for side captions is the rule for all captions, sharpened: add what the eye cannot know — the when, the why, the thing outside the frame. Everything the eye already knows is clutter wearing a caption's clothes. Strip it.",
		),
	),
	heading(2, tx("Numbering is a promise")),
	para(
		tx(
			"Promises deserve repeating, because the second promise is to yourself. Numbering promised the reader seven visual thoughts; it promises the author something stricter: no eighth thought smuggled in after the design is done. Every editorial project accumulates almosts — the photograph that almost fits, the aside that almost belongs. The numbers are a fence against almosts. Seven means seven. When the eighth image knocks, and it always knocks, the answer is the next essay, not a longer one. Constraint feels like loss for a week and like identity forever. This series has an identity now: seven figures, numbered, no almosts. The fence holds. The work inside the fence gets better every time, because all the energy that would have gone to the eighth image goes to the seven that earned their numbers.",
		),
	),
	fig(
		"gurat-10",
		"Two prints arguing on a light table",
		"Two prints, one survives",
		"pair",
	),
	fig("gurat-11", "The survivor pinned alone", "The survivor, alone", "pair"),
	quote(para(tx("Words argue. Photographs witness. Lead with witnessing."))),
	heading(3, tx("Pairs and triptychs, honestly")),
	para(
		tx(
			"Two photographs side by side are an argument; three are a rhythm. The pair says compare — before and after, wide and close, claim and evidence. The triptych says sequence — morning, noon, night; spring, summer, winter — time chopped into beats the eye can hold. Both fail the same way: as decoration, images related by vibe rather than by thought. The test is brutal and quick. Cover each image in turn and ask what the group loses. If the answer is nothing, the group is decoration wearing argument's clothes. Delete the weakest cell, or delete the group. What remains will be smaller and better, which is the direction all editing points. A pair that survives the test hits harder than any single image, because the reader did the comparing themselves, and conclusions readers reach themselves outlast any conclusion handed to them.",
		),
	),
	fig("gurat-12", "Three windows at three hours", "Morning window", "triptych"),
	fig("gurat-13", "A second window at noon", "Noon window", "triptych"),
	fig("gurat-14", "A third window at dusk", "Dusk window", "triptych"),
	codeBlock(
		"text",
		"figure ledger:\n  01 inline · 02 offset · 03 pair · 04 triptych\n  05 wide · 06 full · 07 inline",
	),
	para(
		tx(
			"That is the whole ledger for this essay, and it fits on a card, and every image on this page answers to it. The ledger is the fence made visible: seven groups, fixed order, no almosts. New essays get new ledgers, but the discipline is the same — choose the images first, number them honestly, delete the ones without jobs. The card for this page is pinned above the desk. It has coffee on it. That feels right. Ledgers should look used. The numbers should look inevitable. Between those two facts sits everything this series is trying to be.",
		),
	),
	fig(
		"gurat-01",
		"A wide studio wall of pinned essays",
		"A wide view of the series wall",
		"wide",
	),
	pullquote(
		para(
			tx(
				"With only seven moves, every figure has to justify itself. The ones that cannot are deleted.",
			),
		),
	),
	heading(2, tx("Build pages like this")),
	para(
		tx(
			"If this page persuades you, steal the method — it was built to be stolen. Start with the photographs, not the outline. Choose fewer than feels safe. Number them before you write a word, in the order the eye should travel, and let the numbers veto the almosts. Write captions last, cut them first, keep only what the eye cannot know. Let pairs argue and triptychs keep time. ",
		),
		tx(
			"Treat the layout as furniture for the images, not frames for the text",
			link("#fn-1"),
		),
		tx(
			". Then publish, and watch how differently the page reads: slower, quieter, witnessed first and argued second. The words will feel humbler. That is not a loss. Humility in text is what lets photographs speak, and the photographs, chosen first and numbered honestly, turn out to have been saying the essay all along.",
		),
	),
	fig(
		"gurat-02",
		"The finished page on screen in full frame",
		"Full width, finished page",
		"full",
	),
	para(
		tx(
			"If you take one practice from this essay, take the photographs-first. Before the next piece, choose its images: fixed, finite, numbered. Write the outline around what they actually show. Delete the words that repeat them. What remains will be shorter than your draft and truer than your draft, because the witness came first and the argument learned its place. Seven figures, numbered, no almosts. Start there. The page will do the rest.",
		),
	),
	fig(
		"gurat-03",
		"Morning light on the finished desk",
		"Morning, finished desk",
		"inline",
	),
	para(
		tx(
			"This is the fourteenth essay in the series and the first one about the series itself — the page explaining the page, the furniture describing the furniture. It has seven figures, like all the others, numbered 01 / 07 through 07 / 07, and every number was earned the hard way: by deleting the eighth. Somewhere in the drafts there is a folder of almosts, unnumbered, unloved, waiting for the next essay. They will get their numbers. Every photograph gets its essay eventually. That is the other promise, the one the numbers imply but never state: nothing witnessed is wasted. It just waits its turn, patiently, for its seven.",
		),
	),
	footnote(
		para(
			tx(
				"The fourteen fixtures: fixed picsum seeds, deterministic, real photographs — layout proof with honest pixels.",
			),
		),
	),
	footnote(
		para(
			tx(
				"The eighth image: always knocks, never admitted. It gets the next essay, where it becomes the first.",
			),
		),
	),
	footnote(
		para(
			tx(
				"This essay's doubled heading numbers itself twice, as is only proper on this page.",
			),
		),
	),
);

const ID_014 = doc(
	heading(2, tx("Foto lebih dulu")),
	para(
		tx(
			"Halaman yang Anda baca ini dibangun secara terbalik. Kebanyakan esai bermula dari kata dan dihias dengan gambar; yang ini bermula dari empat belas foto dan meminta kata-kata membuktikan tempatnya di sampingnya. Foto-foto lebih dulu — cahaya nyata, ruangan nyata, seed tetap agar bukti tata letak deterministik — dan segala yang Anda lihat di sekitarnya, figur-figur bernomor, keterangan samping, pasangan dan triptik, dirancang sebagai furnitur bagi gambar bukan sebaliknya. Terasa tidak alami tepat sehari. Lalu terasa jelas, seperti semua kendala baik terasa jelas belakangan. Kata berargumen. Foto bersaksi. Halaman yang memimpin dengan kesaksian terbaca berbeda: lebih lambat, lebih tenang, dengan teks melakukan kerja rendah hati melabeli apa yang sudah diketahui mata.",
		),
	),
	fig(
		"gurat-08",
		"Meja tempat halaman ini ditata",
		"Tempat halaman ini dibangun",
		"inline",
	),
	para(
		tx("Metode ini kini punya nama di sini: "),
		tx("editorial foto-dulu", bold()),
		tx(
			". Artinya setiap esai dikirim dengan gambarnya dipilih sebelum kerangkanya, dan kerangka menekuk pada apa yang benar-benar ditunjukkan gambar bukan pada apa yang diharapkan draf. Keterangan ditulis terakhir dan dipotong pertama — jika sebuah paragraf mengatakan apa yang dikatakan foto, paragraf kalah. Kosakata tata letak sengaja kecil: ",
		),
		tx("tujuh grup bernomor", italic()),
		tx(", masing-masing dihitung dan dilabeli, dilacak dalam "),
		tx("buku besar figur", code()),
		tx("; spesifikasi lengkap tinggal di "),
		tx("arsip relatif", link("/id/writing/no-014-foto-dulu")),
		tx(", dan fotografi acuan yang menginspirasinya dikatalogkan di "),
		tx("laman moodboard", link("https://example.com/photo-first")),
		tx(
			". Kosakata kecil memaksa kejujuran. Dengan hanya tujuh langkah, setiap figur harus membenarkan dirinya, dan yang tak bisa dibenarkan dihapus, yang merupakan pujian tertinggi yang bisa diberikan editor pada tata letak.",
		),
	),
	heading(2, tx("Penomoran adalah janji")),
	para(
		tx(
			"Setiap figur di halaman ini memakai nomor — 01 / 07 sampai 07 / 07 — dan nomor-nomor itu adalah kontrak dengan pembaca. Katanya: esai ini punya tepat tujuh gagasan visual, dalam urutan ini, dan tak satu pun dekorasi. Penomoran mendisiplinkan penulis lebih dari pembaca. Gambar tanpa nomor bisa menyelundup untuk mengisi ruang; yang bernomor harus menjawab apa arti nomor lima yang tak dimiliki nomor empat. ",
		),
		sidenote(
			"1",
			tx("Hitung figur Anda sebelum terbit. Jika satu tak punya tugas, hapus."),
		),
		tx(
			" Saya telah menghapus lebih banyak foto dari seri ini daripada yang saya simpan, dan setiap penghapusan memperbaiki yang selamat. Nomor juga memberi pembaca peta: enam dari tujuh berarti akhir dekat, yang mengubah cara gambar terakhir mendarat. Struktur adalah keramahan. Penomoran adalah struktur yang bisa dilihat, yaitu jenis paling ramah.",
		),
	),
	fig(
		"gurat-09",
		"Lembar kontak dengan hapusan bertanda merah",
		"Apa yang digantikan nomor",
		"offset",
	),
	para(
		tx(
			"Keterangan samping adalah pertarungan tersulit dalam desain, dan pertarungan itu memberi tahu apa gunanya. Keterangan di bawah foto menjelaskan foto. Keterangan di sampingnya berdialog dengannya — gambar yang sama, postur berbeda, teks berdiri di samping gambar seperti kawan bukan duduk di bawahnya seperti label. Di layar sempit dialog menumpuk vertikal, dan itu baik-baik saja; persahabatan selamat ditumpuk. ",
		),
		sidenote(
			"2",
			tx(
				"Jika keterangan hanya mendeskripsikan gambar, hapus keterangan. Simpan gambar.",
			),
		),
		tx(
			" Aturan keterangan samping adalah aturan semua keterangan, dipertajam: tambahkan yang tak bisa diketahui mata — kapan, mengapa, hal di luar bingkai. Segala yang sudah diketahui mata adalah kekacauan berbaju keterangan. Lucuti.",
		),
	),
	heading(2, tx("Penomoran adalah janji")),
	para(
		tx(
			"Janji layak diulang, karena janji kedua untuk diri sendiri. Penomoran menjanjikan pembaca tujuh gagasan visual; ia menjanjikan penulis sesuatu yang lebih ketat: tak ada gagasan kedelapan yang diselundupkan setelah desain selesai. Setiap proyek editorial menumpuk hampir — foto yang hampir cocok, sisipan yang hampir milik. Nomor adalah pagar melawan hampir. Tujuh berarti tujuh. Saat gambar kedelapan mengetuk, dan ia selalu mengetuk, jawabannya adalah esai berikutnya, bukan yang lebih panjang. Kendala terasa seperti kehilangan seminggu dan seperti identitas selamanya. Seri ini kini punya identitas: tujuh figur, bernomor, tanpa hampir. Pagar bertahan. Kerja di dalam pagar membaik setiap kali, karena semua energi yang akan pergi ke gambar kedelapan pergi ke tujuh yang meraih nomornya.",
		),
	),
	fig(
		"gurat-10",
		"Dua cetakan berdebat di atas meja cahaya",
		"Dua cetakan, satu selamat",
		"pair",
	),
	fig(
		"gurat-11",
		"Yang selamat disematkan sendirian",
		"Yang selamat, sendirian",
		"pair",
	),
	quote(para(tx("Kata berargumen. Foto bersaksi. Pimpin dengan kesaksian."))),
	heading(3, tx("Pasangan dan triptik, dengan jujur")),
	para(
		tx(
			"Dua foto berdampingan adalah argumen; tiga adalah ritme. Pasangan berkata bandingkan — sebelum dan sesudah, lebar dan dekat, klaim dan bukti. Triptik berkata urutan — pagi, siang, malam; semi, panas, dingin — waktu dicacah menjadi ketukan yang bisa dipegang mata. Keduanya gagal dengan cara sama: sebagai dekorasi, gambar-gambar yang terkait oleh vibe bukan oleh gagasan. Ujinya brutal dan cepat. Tutup setiap gambar bergiliran dan tanyakan apa yang hilang dari grup. Jika jawabannya tidak ada, grup itu dekorasi berbaju argumen. Hapus sel terlemah, atau hapus grup. Yang tersisa akan lebih kecil dan lebih baik, yaitu arah semua penyuntingan. Pasangan yang selamat dari uji menghantam lebih keras daripada gambar tunggal mana pun, karena pembaca melakukan perbandingan sendiri, dan simpulan yang dicapai pembaca sendiri bertahan lebih lama daripada simpulan mana pun yang diserahkan.",
		),
	),
	fig("gurat-12", "Tiga jendela pada tiga jam", "Jendela pagi", "triptych"),
	fig("gurat-13", "Jendela kedua pada siang", "Jendela siang", "triptych"),
	fig("gurat-14", "Jendela ketiga pada senja", "Jendela senja", "triptych"),
	codeBlock(
		"text",
		"buku besar figur:\n  01 inline · 02 offset · 03 pair · 04 triptych\n  05 wide · 06 full · 07 inline",
	),
	para(
		tx(
			"Itulah seluruh buku besar untuk esai ini, dan muat di kartu, dan setiap gambar di halaman ini bertanggung jawab padanya. Buku besar adalah pagar yang dibuat terlihat: tujuh grup, urutan tetap, tanpa hampir. Esai baru mendapat buku besar baru, tetapi disiplinnya sama — pilih gambar dulu, beri nomor jujur, hapus yang tanpa tugas. Kartu untuk halaman ini disematkan di atas meja. Ada kopinya. Itu terasa benar. Buku besar harus tampak dipakai. Nomor harus tampak tak terhindarkan. Di antara dua fakta itu duduk segala yang coba menjadi seri ini.",
		),
	),
	fig(
		"gurat-01",
		"Dinding studio lebar berisi esai-esai tersemat",
		"Pandangan lebar atas dinding seri",
		"wide",
	),
	pullquote(
		para(
			tx(
				"Dengan hanya tujuh langkah, setiap figur harus membenarkan dirinya. Yang tak bisa dibenarkan dihapus.",
			),
		),
	),
	heading(2, tx("Bangun halaman seperti ini")),
	para(
		tx(
			"Jika halaman ini meyakinkan Anda, curilah metodenya — ia dibangun untuk dicuri. Mulailah dengan foto, bukan kerangka. Pilih lebih sedikit daripada yang terasa aman. Beri nomor sebelum menulis sepatah kata, dalam urutan yang harus ditempuh mata, dan biarkan nomor memveto yang hampir. Tulis keterangan terakhir, potong pertama, simpan hanya yang tak bisa diketahui mata. Biarkan pasangan berargumen dan triptik menjaga waktu. ",
		),
		tx(
			"Perlakukan tata letak sebagai furnitur bagi gambar, bukan bingkai bagi teks",
			link("#fn-1"),
		),
		tx(
			". Lalu terbitkan, dan saksikan betapa berbeda halaman terbaca: lebih lambat, lebih tenang, disaksikan dulu dan diperdebatkan kemudian. Kata-kata akan terasa lebih rendah hati. Itu bukan kehilangan. Kerendahan hati dalam teks adalah yang membiarkan foto berbicara, dan foto-foto itu, yang dipilih dulu dan diberi nomor jujur, ternyata selama ini mengatakan esai.",
		),
	),
	fig(
		"gurat-02",
		"Halaman jadi di layar dalam bingkai penuh",
		"Lebar penuh, halaman jadi",
		"full",
	),
	para(
		tx(
			"Jika Anda mengambil satu latihan dari esai ini, ambillah foto-dulu itu. Sebelum karya berikutnya, pilih gambar-gambarnya: tetap, terbatas, bernomor. Tulis kerangka mengelilingi apa yang benar-benar mereka tunjukkan. Hapus kata yang mengulanginya. Yang tersisa akan lebih pendek dari draf Anda dan lebih benar dari draf Anda, karena saksi lebih dulu dan argumen belajar tempatnya. Tujuh figur, bernomor, tanpa hampir. Mulailah di sana. Halaman akan mengerjakan sisanya.",
		),
	),
	fig(
		"gurat-03",
		"Cahaya pagi di atas meja yang selesai",
		"Pagi, meja selesai",
		"inline",
	),
	para(
		tx(
			"Ini esai keempat belas dalam seri dan yang pertama tentang seri itu sendiri — halaman yang menjelaskan halaman, furnitur yang menggambarkan furnitur. Ia punya tujuh figur, seperti semua yang lain, bernomor 01 / 07 sampai 07 / 07, dan setiap nomor diraih dengan cara sulit: dengan menghapus yang kedelapan. Di suatu tempat dalam draf ada folder berisi yang-hampir, tanpa nomor, tanpa cinta, menunggu esai berikutnya. Mereka akan mendapat nomornya. Setiap foto akhirnya mendapat esainya. Itulah janji lain, yang disiratkan nomor tetapi tak pernah dinyatakan: tak ada kesaksian yang sia-sia. Ia hanya menunggu giliran, dengan sabar, untuk tujuhnya. Dan kesabaran itu adalah metode yang lengkap: pilih dulu, beri nomor jujur, hapus tanpa ampun, terbitkan tanpa hampir. Seri ini dibangun dari penolakan sebanyak dari penerimaan, dan penolakan itulah yang membuat setiap nomor berarti.",
		),
	),
	footnote(
		para(
			tx(
				"Keempat belas fixture: seed picsum tetap, deterministik, foto nyata — bukti tata letak dengan piksel jujur.",
			),
		),
	),
	footnote(
		para(
			tx(
				"Gambar kedelapan: selalu mengetuk, tak pernah diterima. Ia mendapat esai berikutnya, tempat ia menjadi yang pertama.",
			),
		),
	),
	footnote(
		para(
			tx(
				"Judul ganda esai ini menomori dirinya dua kali, sebagaimana pantas di halaman ini.",
			),
		),
	),
);

// --- posts, tags, links ----------------------------------------------------------

const DRAFT_DOC = doc(
	heading(2, tx("Work in progress")),
	para(tx("Draft body.")),
);

const FUTURE_DOC = doc(
	heading(2, tx("Terjadwal")),
	para(tx("Isi tulisan terjadwal.")),
);

interface EssayDef {
	n: string;
	ageDays: number;
	enSlug: string;
	enTitle: string;
	enExcerpt: string;
	enBody: string;
	idSlug: string;
	idTitle: string;
	idExcerpt: string;
	idBody: string;
	tags: string[];
}

const ESSAYS: EssayDef[] = [
	{
		n: "007",
		ageDays: 90,
		enSlug: "no-007-quiet-discipline",
		enTitle: "The quiet discipline of boring software",
		enExcerpt: "In praise of systems that never page.",
		enBody: EN_007,
		idSlug: "no-007-disiplin-tenang",
		idTitle: "Disiplin tenang perangkat lunak yang membosankan",
		idExcerpt: "Pujian bagi sistem yang tak pernah memanggil.",
		idBody: ID_007,
		tags: ["tag-software"],
	},
	{
		n: "008",
		ageDays: 78,
		enSlug: "no-008-slow-films",
		enTitle: "What slow films taught me about attention",
		enExcerpt: "Four minutes of rain, and the negotiation.",
		enBody: EN_008,
		idSlug: "no-008-film-lambat",
		idTitle: "Apa yang diajarkan film lambat tentang perhatian",
		idExcerpt: "Empat menit hujan, dan negosiasi itu.",
		idBody: ID_008,
		tags: ["tag-film"],
	},
	{
		n: "009",
		ageDays: 66,
		enSlug: "no-009-one-album",
		enTitle: "Listening to one album for a month",
		enExcerpt: "Thirty days, one record, day nine.",
		enBody: EN_009,
		idSlug: "no-009-satu-album",
		idTitle: "Mendengarkan satu album selama sebulan",
		idExcerpt: "Tiga puluh hari, satu rekaman, hari kesembilan.",
		idBody: ID_009,
		tags: ["tag-music"],
	},
	{
		n: "010",
		ageDays: 54,
		enSlug: "no-010-marginalia",
		enTitle: "A field guide to marginalia",
		enExcerpt: "Date everything, argue in verbs.",
		enBody: EN_010,
		idSlug: "no-010-marginalia",
		idTitle: "Panduan catatan pinggir",
		idExcerpt: "Beri tanggal pada semua, berdebatlah dengan kata kerja.",
		idBody: ID_010,
		tags: ["tag-notes"],
	},
	{
		n: "011",
		ageDays: 42,
		enSlug: "no-011-delete-dashboard",
		enTitle: "Delete the dashboard",
		enExcerpt: "Your screen is a confession. Audit it.",
		enBody: EN_011,
		idSlug: "no-011-hapus-dasbor",
		idTitle: "Hapus dasbornya",
		idExcerpt: "Layar Anda adalah pengakuan. Auditlah.",
		idBody: ID_011,
		tags: ["tag-software", "tag-notes"],
	},
	{
		n: "012",
		ageDays: 30,
		enSlug: "no-012-empty-rooms",
		enTitle: "Portraits of empty rooms",
		enExcerpt: "Absence has posture. Give it a beat.",
		enBody: EN_012,
		idSlug: "no-012-ruang-kosong",
		idTitle: "Potret ruang-ruang kosong",
		idExcerpt: "Ketiadaan punya postur. Beri ia seketuk.",
		idBody: ID_012,
		tags: ["tag-film", "tag-notes"],
	},
	{
		n: "013",
		ageDays: 18,
		enSlug: "no-013-metronome-heart",
		enTitle: "The metronome and the heart",
		enExcerpt: "Sixty honest beats per minute.",
		enBody: EN_013,
		idSlug: "no-013-metronom-hati",
		idTitle: "Metronom dan detak jantung",
		idExcerpt: "Enam puluh ketukan jujur per menit.",
		idBody: ID_013,
		tags: ["tag-music"],
	},
	{
		n: "014",
		ageDays: 2,
		enSlug: "no-014-photo-first",
		enTitle: "Photo first: notes on building this page",
		enExcerpt: "Seven figures, numbered, no almosts.",
		enBody: EN_014,
		idSlug: "no-014-foto-dulu",
		idTitle: "Foto dulu: catatan membangun halaman ini",
		idExcerpt: "Tujuh figur, bernomor, tanpa hampir.",
		idBody: ID_014,
		tags: ["tag-software"],
	},
];

// Rotation: each essay body references 10 distinct fixtures (plan: no photo
// twice in one essay, each photo in ≤6 essays). `post_media` rows derive
// from the figures actually present in the body — single source of truth.
function bodyFigureMediaIds(body: string): string[] {
	const json: unknown = JSON.parse(body);
	const ids: string[] = [];
	const walk = (node: unknown): void => {
		if (typeof node !== "object" || node === null) return;
		const n = node as Record<string, unknown>;
		if (n.type === "figure") {
			const attrs = n.attrs as Record<string, unknown>;
			if (typeof attrs.mediaId === "string") ids.push(attrs.mediaId);
		}
		if (Array.isArray(n.content)) for (const c of n.content) walk(c);
	};
	walk(json);
	return [...new Set(ids)];
}

const POSTS: SeedPost[] = [];
ESSAYS.forEach((e) => {
	const publishedAt = NOW - e.ageDays * DAY;
	const enSeeds = bodyFigureMediaIds(e.enBody);
	const idSeeds = bodyFigureMediaIds(e.idBody);
	if (enSeeds.length !== 10 || idSeeds.length !== 10) {
		throw new Error(
			`seed: essay ${e.n} must reference exactly 10 figures (en=${enSeeds.length}, id=${idSeeds.length})`,
		);
	}
	POSTS.push(
		{
			id: `post-en-${e.n}`,
			locale: "en",
			group: `group-no-${e.n}`,
			slug: e.enSlug,
			title: e.enTitle,
			excerpt: e.enExcerpt,
			status: "published",
			publishedAt,
			body: e.enBody,
			ageDays: e.ageDays,
			figureMediaIds: enSeeds,
		},
		{
			id: `post-id-${e.n}`,
			locale: "id",
			group: `group-no-${e.n}`,
			slug: e.idSlug,
			title: e.idTitle,
			excerpt: e.idExcerpt,
			status: "published",
			publishedAt,
			body: e.idBody,
			ageDays: e.ageDays,
			figureMediaIds: idSeeds,
		},
	);
});

// One EN draft + one ID scheduled post (behavior-matrix fixtures).
POSTS.push(
	{
		id: "post-en-draft",
		locale: "en",
		group: null,
		slug: "unfinished-draft",
		title: "Unfinished draft",
		excerpt: "Not yet published.",
		status: "draft",
		publishedAt: null,
		body: DRAFT_DOC,
		ageDays: 1,
		figureMediaIds: [],
	},
	{
		id: "post-id-future",
		locale: "id",
		group: null,
		slug: "catatan-terjadwal",
		title: "Catatan terjadwal",
		excerpt: "Terjadwal.",
		status: "published",
		publishedAt: NOW + 7 * DAY,
		body: FUTURE_DOC,
		ageDays: 1,
		figureMediaIds: [],
	},
);

const TAGS = [
	["tag-software", "software", "Software", "Perangkat Lunak"],
	["tag-film", "film", "Film", "Film"],
	["tag-music", "music", "Music", "Musik"],
	["tag-notes", "notes", "Notes", "Catatan"],
] as const;

// --- SQL emission ------------------------------------------------------------
// Validate every doc against the content schema before emitting; log word
// counts to stderr (plan band 1200–1800 per essay; draft/scheduled excluded).

for (const p of POSTS) {
	try {
		validateDoc(JSON.parse(p.body));
	} catch (err) {
		throw new Error(
			`seed: invalid doc for ${p.id}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	const words = wordCount(p.body);
	const inCorpus = p.group !== null;
	const outOfBand = words < 1200 || words > 1800;
	console.error(
		`seed: ${p.id} ${words} words${inCorpus && outOfBand ? "  <-- OUT OF BAND" : ""}`,
	);
	if (inCorpus && outOfBand) {
		throw new Error(`seed: ${p.id} word count ${words} outside 1200–1800 band`);
	}
}

const POST_TAGS: [string, string][] = [];
ESSAYS.forEach((e) => {
	for (const tagId of e.tags) {
		POST_TAGS.push([`post-en-${e.n}`, tagId], [`post-id-${e.n}`, tagId]);
	}
});

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
		`INSERT INTO posts (id, locale, translation_group_id, slug, title, excerpt, status, published_at, content_json, content_html, toc_json, created_at, updated_at) VALUES (${esc(p.id)}, ${esc(p.locale)}, ${p.group === null ? "NULL" : esc(p.group)}, ${esc(p.slug)}, ${esc(p.title)}, ${esc(p.excerpt)}, ${esc(p.status)}, ${p.publishedAt === null ? "NULL" : String(p.publishedAt)}, ${esc(p.body)}, ${esc("<p>TODO rerender</p>")}, ${esc("[]")}, ${created}, ${created});`,
	);
	for (const mediaId of p.figureMediaIds) {
		lines.push(
			`INSERT INTO post_media (post_id, media_id) VALUES (${esc(p.id)}, ${esc(mediaId)});`,
		);
	}
}
for (const [postId, tagId] of POST_TAGS) {
	lines.push(
		`INSERT INTO post_tags (post_id, tag_id) VALUES (${esc(postId)}, ${esc(tagId)});`,
	);
}

console.log(lines.join("\n"));
