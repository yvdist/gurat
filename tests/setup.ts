import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { beforeAll } from "vitest";
import { createDb } from "../src/server/db/client";

// All flat `migrations/*.sql` in filename order. `?raw` inlines each at
// bundle time (no node:fs in workerd). Splits on drizzle-kit's
// statement-breakpoints and runs each through a prepared statement
// (bound-parameter path, no string-concat execution).
const migrationModules = import.meta.glob<string>("../migrations/*.sql", {
	query: "?raw",
	import: "default",
	eager: true,
});

beforeAll(async () => {
	const db = createDb(env.DB);
	const files = Object.keys(migrationModules).sort();
	for (const file of files) {
		const statements = migrationModules[file]
			.split("--> statement-breakpoint")
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
		for (const stmt of statements) {
			await db.run(sql.raw(stmt));
		}
	}
});
