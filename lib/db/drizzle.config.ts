import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

// Plain forward-slash relative paths, not path.join(__dirname, ...) — on
// Windows, path.join produces backslashes, and drizzle-kit's schema-path
// resolution treats that string as a glob pattern, where backslash is an
// escape character. That silently breaks glob matching and drizzle-kit
// reports "No schema files found" even though the path is correct. This is
// why `db-migrate` has always run inside the Linux Docker container instead
// of directly on the Windows deploy host — forward slashes here means this
// also now works if ever run directly on Windows (e.g. local `generate`).
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
