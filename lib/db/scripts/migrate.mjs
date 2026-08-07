// Applies pending SQL migrations from ../migrations against DATABASE_URL.
// Plain .mjs (not .ts) deliberately — this is invoked directly with `node`
// in the db-migrate container, no build step or TS runner needed.
//
// Not going through the `drizzle-kit migrate` CLI subcommand: it's a thin
// wrapper anyway, and this direct call to drizzle-orm's own migrate() means
// there's exactly one thing to reason about when this fails, not "which
// layer" it failed in.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, "..", "migrations");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

console.log(`Applying pending migrations from ${migrationsFolder} ...`);
await migrate(db, { migrationsFolder });
console.log("Migrations applied successfully (or already up to date).");
await pool.end();
