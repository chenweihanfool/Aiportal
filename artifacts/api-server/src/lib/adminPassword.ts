// Every private-zone route (HHI dimensions, HERMES 戰情室, site admin CRUD)
// is gated by nothing more than `req.headers["x-admin-password"] ===
// ADMIN_PASSWORD`. Five route files used to each independently write
// `process.env["ADMIN_PASSWORD"] ?? "85097110"` — meaning a missing/blank
// env var silently armed every one of them with a password that's also
// sitting in this repo's git history in plaintext, visible to anyone with
// read access. No log line, no crash, nothing to notice until someone
// actually tries that password.
//
// Same "throw at module load" pattern as index.ts's PORT check: import this
// module before anything else touches ADMIN_PASSWORD, and a missing or
// placeholder value takes the whole process down at boot instead of quietly
// shipping a broken lock.
const INSECURE_DEFAULT_PASSWORD = "85097110";

const raw = process.env["ADMIN_PASSWORD"];

if (!raw) {
  throw new Error(
    "ADMIN_PASSWORD environment variable is required but was not provided. " +
      "Copy .env.example to .env and set a real secret — every private-zone route in this app is gated by it.",
  );
}
if (raw === INSECURE_DEFAULT_PASSWORD) {
  throw new Error(
    `ADMIN_PASSWORD is set to "${INSECURE_DEFAULT_PASSWORD}", the placeholder value that used to be hardcoded as a fallback in this codebase and is visible in git history to anyone with repo read access. Set a real secret instead.`,
  );
}

export const ADMIN_PASSWORD = raw;
