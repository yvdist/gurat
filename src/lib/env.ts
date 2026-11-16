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
	[k: string]: unknown;
}

export function getEnv(): Env {
	return env as unknown as Env;
}
