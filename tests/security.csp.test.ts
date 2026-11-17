import { describe, expect, it } from "vitest";
import {
	adminCsp,
	mediaOriginFrom,
	publicCsp,
} from "../src/server/security/csp";

describe("mediaOriginFrom", () => {
	it("returns null for empty or missing values", () => {
		expect(mediaOriginFrom(null)).toBeNull();
		expect(mediaOriginFrom(undefined)).toBeNull();
		expect(mediaOriginFrom("")).toBeNull();
	});

	it("extracts the origin from an absolute URL", () => {
		expect(mediaOriginFrom("https://media.example.com")).toBe(
			"https://media.example.com",
		);
		expect(mediaOriginFrom("https://media.example.com/some/path")).toBe(
			"https://media.example.com",
		);
	});

	it("never throws on a bad value", () => {
		expect(mediaOriginFrom("not a url")).toBeNull();
		expect(mediaOriginFrom("///")).toBeNull();
	});
});

describe("publicCsp", () => {
	it("is self-only when no media origin is set", () => {
		const csp = publicCsp(null);
		expect(csp).toContain("default-src 'self'");
		expect(csp).toContain("img-src 'self'");
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).toContain("base-uri 'none'");
		expect(csp).toContain("form-action 'self'");
		expect(csp).toContain("style-src 'self' 'unsafe-inline'");
		// Hash-only scripts: never 'unsafe-inline', no data:, no remote hosts.
		expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
		expect(csp).not.toContain("data:");
		expect(csp).not.toContain("https://");
		// Exactly the two pinned Base.astro script hashes.
		expect(csp.match(/sha256-/g)).toHaveLength(2);
	});

	it("appends the media origin to img-src only", () => {
		const csp = publicCsp("https://media.example.com");
		expect(csp).toContain("img-src 'self' https://media.example.com");
		expect(csp).toContain("default-src 'self'");
		expect(csp).not.toMatch(/script-src[^;]*media\.example\.com/);
	});
});

describe("adminCsp", () => {
	it("allows same-origin scripts only", () => {
		const csp = adminCsp();
		expect(csp).toContain("script-src 'self'");
		expect(csp).not.toContain("sha256-");
		expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
		expect(csp).toContain("frame-ancestors 'none'");
	});
});
