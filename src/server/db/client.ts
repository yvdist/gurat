import type { D1Database } from "@cloudflare/workers-types";
import { type DrizzleD1Database, drizzle } from "drizzle-orm/d1";

// The database handle used by all repositories. Named at the module that owns
// the value (not ReturnType): consumers import `Db` from here.
export type Db = DrizzleD1Database;

// Creates the Drizzle client from a D1 binding. Takes the D1Database as a
// parameter — never reads env itself (env isolation: see src/lib/env.ts).
export function createDb(d1: D1Database): Db {
	return drizzle(d1);
}
