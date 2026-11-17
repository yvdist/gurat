import { describe, expect, it } from "vitest";
import type { FeedPost } from "../src/server/discovery/feed";
import {
	absolutizeFeedHtml,
	buildFeedXml,
	feedLastModified,
} from "../src/server/discovery/feed";
import { isFresh } from "../src/server/discovery/http";

const BASE: FeedPost = {
	id: "post-1",
	slug: "hello-world",
	title: "Hello <World> & friends",
	excerpt: "Short & sweet",
	seoDescription: null,
	contentHtml: `<p>Body with <img src="/media/abc/800.webp"> and <a href="/writing/x">link</a>.</p>`,
	publishedAt: 1_769_000_000_000,
	updatedAt: 1_769_000_100_000,
};

function input(posts: FeedPost[] = [BASE]) {
	return {
		locale: "en" as const,
		siteUrl: "https://example.com",
		mediaBase: "",
		posts,
		siteName: "Gurat",
	};
}

describe("feed builder", () => {
	it("escapes titles and descriptions, keeps single CDATA for content", () => {
		const xml = buildFeedXml(input());
		expect(xml).toContain("<title>Hello &lt;World&gt; &amp; friends</title>");
		expect(xml).toContain("<description>Short &amp; sweet</description>");
		expect(xml).toContain(
			'<content:encoded><![CDATA[<p>Body with <img src="https://example.com/media/abc/800.webp">',
		);
		// Exactly one CDATA section per item (content only).
		expect(xml.match(/<!\[CDATA\[/g)).toHaveLength(1);
		expect(xml).toContain("<language>en</language>");
	});

	it("uses stable urn:uuid guids and permalinks in links", () => {
		const a = buildFeedXml(input());
		const renamed = buildFeedXml(
			input([{ ...BASE, slug: "new-slug", title: "New title" }]),
		);
		expect(a).toContain('<guid isPermaLink="false">urn:uuid:post-1</guid>');
		expect(renamed).toContain(
			'<guid isPermaLink="false">urn:uuid:post-1</guid>',
		);
		expect(renamed).toContain(
			"<link>https://example.com/writing/new-slug</link>",
		);
	});

	it("breaks CDATA terminators inside content", () => {
		const xml = buildFeedXml(input([{ ...BASE, contentHtml: "<p>a]]>b</p>" }]));
		expect(xml).toContain("<![CDATA[<p>a]]&gt;b</p>]]>");
	});

	it("absolutizes same-origin media and relative hrefs", () => {
		expect(
			absolutizeFeedHtml(
				'<img src="/media/a/1.webp"><a href="/tags/x">t</a><a href="https://other.example/y">e</a>',
				"https://cdn.example",
			),
		).toBe(
			'<img src="https://cdn.example/media/a/1.webp"><a href="https://cdn.example/tags/x">t</a><a href="https://other.example/y">e</a>',
		);
	});

	it("reports max updatedAt as last-modified, null when empty", () => {
		expect(feedLastModified([BASE, { ...BASE, id: "p2", updatedAt: 5 }])).toBe(
			1_769_000_100_000,
		);
		expect(feedLastModified([])).toBeNull();
	});

	it("emits Indonesian language for the id locale", () => {
		const xml = buildFeedXml({ ...input(), locale: "id" });
		expect(xml).toContain("<language>id</language>");
		expect(xml).toContain("<link>https://example.com/id</link>");
		expect(xml).toContain("<description>Gurat — /id/feed.xml</description>");
	});
});

describe("conditional GET helper", () => {
	const etag = '"abc123"';
	const lastMod = 1_769_000_000_000;

	it("matches exact and wildcard If-None-Match", () => {
		expect(
			isFresh(
				new Request("https://x/", { headers: { "If-None-Match": etag } }),
				etag,
				lastMod,
			),
		).toBe(true);
		expect(
			isFresh(
				new Request("https://x/", { headers: { "If-None-Match": "*" } }),
				etag,
				lastMod,
			),
		).toBe(true);
		expect(
			isFresh(
				new Request("https://x/", { headers: { "If-None-Match": '"other"' } }),
				etag,
				lastMod,
			),
		).toBe(false);
	});

	it("honors If-Modified-Since at second precision", () => {
		const date = new Date(lastMod).toUTCString();
		expect(
			isFresh(
				new Request("https://x/", { headers: { "If-Modified-Since": date } }),
				'"other"',
				lastMod,
			),
		).toBe(true);
		expect(
			isFresh(
				new Request("https://x/", {
					headers: {
						"If-Modified-Since": new Date(lastMod - 60_000).toUTCString(),
					},
				}),
				'"other"',
				lastMod,
			),
		).toBe(false);
	});
});

describe("sitemap builder", () => {
	it("renders valid namespaces, alternates only for translated pairs", async () => {
		const { buildSitemapEntries, renderSitemapXml } = await import(
			"../src/server/discovery/sitemap"
		);
		const postHrefs = new Map<string, { en: string | null; id: string | null }>(
			[["g1", { en: "/writing/a-en", id: "/id/writing/a-id" }]],
		);
		const entries = buildSitemapEntries({
			locale: "en",
			staticPaths: ["/", "/writing"],
			tags: [{ slug: "film", lastModified: 1000 }],
			posts: [
				{ slug: "a-en", updatedAt: 2000, locale: "en", groupId: "g1" },
				{ slug: "solo", updatedAt: 1500, locale: "en", groupId: null },
			],
			postHrefs,
		});
		const xml = renderSitemapXml("https://example.com", entries);
		expect(xml).toContain(
			'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
		);
		expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
		// Translated pair carries en + id + x-default.
		expect(xml).toContain(
			'hreflang="id" href="https://example.com/id/writing/a-id"',
		);
		expect(xml).toContain(
			'hreflang="x-default" href="https://example.com/writing/a-en"',
		);
		// Untranslated post carries only self, no x-default.
		const solo =
			xml.split("<url>").find((u) => u.includes("/writing/solo")) ?? "";
		expect(solo).toContain('hreflang="en"');
		expect(solo).not.toContain('hreflang="id"');
		expect(solo).not.toContain("x-default");
		// Tag lastmod shape, static without lastmod.
		expect(xml).toContain("<loc>https://example.com/tags/film</loc><lastmod>");
		expect(xml).toContain("<loc>https://example.com/</loc>");
	});
});
