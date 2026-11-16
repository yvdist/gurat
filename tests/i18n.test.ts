import { describe, expect, it } from "vitest";
import { detectLocaleFromPath, localizePath, t } from "../src/i18n";
import en from "../src/i18n/en.json";
import id from "../src/i18n/id.json";

describe("i18n core", () => {
	it("keeps en/id dictionaries in key lockstep", () => {
		const enKeys = Object.keys(en).sort();
		const idKeys = Object.keys(id).sort();
		expect(idKeys).toEqual(enKeys);
	});

	it("types t() keys and resolves per locale", () => {
		expect(t("en", "feed.title")).toBe(en["feed.title"]);
		expect(t("id", "feed.title")).toBe(id["feed.title"]);
	});

	it("localizes and detects paths", () => {
		expect(localizePath("/about", "id")).toBe("/id/about");
		expect(localizePath("/about", "en")).toBe("/about");
		expect(localizePath("/", "id")).toBe("/id");
		expect(detectLocaleFromPath("/id/x")).toBe("id");
		expect(detectLocaleFromPath("/x")).toBe("en");
	});
});
