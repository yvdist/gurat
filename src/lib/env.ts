import { env } from "cloudflare:workers";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

// Single typed accessor for bindings/vars/secrets. This module is the ONLY
// place that touches the adapter's env API (`cloudflare:workers`); every
// other module imports `Env`/`getEnv` from here. Verified against:
// https://docs.astro.build/en/guides/integrations-guide/cloudflare/#environment-variables-and-bindings
export interface Env {
	DB: D1Database;
	MEDIA: R2Bucket;
	SITE_URL: string;
	/** `https://<team>.cloudflareaccess.com` — Access JWT `iss` + JWKS base. */
	ACCESS_TEAM_DOMAIN: string;
	/** Application Audience (AUD) tag from the Access application. */
	ACCESS_AUD: string;
	/** Comma-separated owner emails allowed into `/admin`. */
	ADMIN_EMAILS: string;
	/** Local-only bypass flag; honored only when `import.meta.env.DEV`. */
	ADMIN_DEV_BYPASS?: string;
	[k: string]: unknown;
}

export function getEnv(): Env {
	return env as unknown as Env;
}
