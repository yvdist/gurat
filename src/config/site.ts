export const SITE = {
	name: "Gurat",
	// Placeholder subdomain until the owner confirms the real hostname.
	url: "https://gurat.yvdist.com",
	locales: ["en", "id"] as const,
	defaultLocale: "en",
	timezone: "Asia/Jakarta",
} as const;

export type Locale = (typeof SITE.locales)[number];
