import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { beforeAll } from "vitest";
import migrationSql from "../migrations/0000_naive_korg.sql?raw";
import { createDb } from "../src/server/db/client";

// Applies the initial migration to the test isolate's D1 before tests run.
// `?raw` inlines the SQL at bundle time (no node:fs in workerd). Splits on
// drizzle-kit's statement-breakpoints and runs each through a prepared
// statement (bound-parameter path, no string-concat execution).
beforeAll(async () => {
	const db = createDb(env.DB);
	const statements = migrationSql
		.split("--> statement-breakpoint")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	for (const stmt of statements) {
		await db.run(sql.raw(stmt));
	}
});
