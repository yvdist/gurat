export const SITE = {
	name: "Gurat",
	// Placeholder subdomain until the owner confirms the real hostname.
	url: "https://gurat.yvdist.com",
	locales: ["en", "id"] as const,
	defaultLocale: "en",
	timezone: "Asia/Jakarta",
	// Privacy-friendly analytics (spec 06 §6.7). Off by default: `Base`
	// renders no beacon markup while false (zero JS-budget impact). Enabling
	// later means flipping this flag, adding the beacon URL, and updating
	// the Phase-7 CSP.
	analytics: false,
} as const;

export type Locale = (typeof SITE.locales)[number];
