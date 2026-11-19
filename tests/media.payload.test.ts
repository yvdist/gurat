import { describe, expect, it } from "vitest";
import {
	type MediaPayloadItem,
	serializeMediaPayload,
} from "../src/lib/admin/mediaPayload";

// Adversarial alt text / ids / slugs: anything `renameMediaService` accepts
// (free text up to 200 chars) ends up verbatim in the embedded `media-data`
// payload, so the serializer must neutralize script-breaking sequences while
// round-tripping byte-identically through `JSON.parse`.
function item(
	altDefault: string,
	extra: Partial<MediaPayloadItem> = {},
): MediaPayloadItem {
	return {
		id: "550e8400-e29b-41d4-a716-446655440000",
		altDefault,
		width: 1600,
		height: 900,
		variantsJson: '[{"w":400},{"w":1600}]',
		useCount: 2,
		posts: ["hello-world", "second-post"],
		...extra,
	};
}

const hostileAlts = [
	"</script><script>alert(1)</script>",
	"</ScRiPt>", // case variations close the element too
	"<!--", // script "escaped" state: confuses parsing the same way
	"-->]]>", // CDATA-close sequences, harmless but must round-trip
	"quotes \"double\" 'single' backslash \\ newline\ntab\t",
	"unicode  emoji 😀 <b>bold</b> &amp;",
];

describe("serializeMediaPayload", () => {
	it("emits no sequence that can break out of a script element", () => {
		for (const alt of hostileAlts) {
			const out = serializeMediaPayload([item(alt)]);
			// Every `</` is escaped, so none of `</script`, `<!--` (or any
			// other close/confusion sequence) can appear, any casing.
			expect(out).not.toContain("</");
			expect(out.toLowerCase()).not.toContain("</script");
			expect(out).not.toContain("<!--");
		}
	});

	it("round-trips byte-identically through JSON.parse", () => {
		const items = hostileAlts.map((alt) => item(alt));
		// Hostility can also arrive via ids and post slugs.
		items.push(
			item("plain", {
				id: "x</script>y",
				posts: ["a<!--b", "c</script>d"],
			}),
		);
		const out = serializeMediaPayload(items);
		expect(JSON.parse(out)).toEqual(items);
	});
});
