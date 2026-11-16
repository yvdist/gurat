import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";

// The database handle used by all repositories. Named at the module that owns
// the value (not ReturnType): consumers import `Db` from here.
export type Db = DrizzleD1Database;

// Creates the Drizzle client from a D1 binding. Takes the D1Database as a
// parameter — never reads env itself (env isolation: see src/lib/env.ts).
export function createDb(d1: D1Database): Db {
	return drizzle(d1);
}
