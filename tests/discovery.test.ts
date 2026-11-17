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
