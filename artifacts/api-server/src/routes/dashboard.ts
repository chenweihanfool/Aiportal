import { Router, type Request, type Response } from "express";
import { db, subsystemSummariesTable } from "@workspace/db";
import { SUMMARY_SOURCES } from "../lib/summarySources";

const router = Router();

const ADMIN_PASSWORD = process.env["ADMIN_PASSWORD"] ?? "85097110";

// Serves the cached subsystem summaries — read by both the portal's own
// dashboard UI and, per design, any AI agent that wants structured status
// instead of parsing the rendered page. Private subsystems' `data` is
// redacted unless the caller unlocks with the same admin password used for
// the private link zone.
router.get("/dashboard", async (req: Request, res: Response) => {
  const unlocked = req.headers["x-admin-password"] === ADMIN_PASSWORD;

  const rows = await db.select().from(subsystemSummariesTable);
  const bySubsystem = new Map(rows.map((row) => [row.subsystemId, row]));

  const summaries = SUMMARY_SOURCES.map((source) => {
    const row = bySubsystem.get(source.id);
    if (!row) {
      return {
        subsystemId: source.id,
        name: source.name,
        isPrivate: source.isPrivate,
        status: "pending" as const,
        errorMessage: null,
        fetchedAt: null,
        data: null,
      };
    }
    return {
      subsystemId: row.subsystemId,
      name: source.name,
      isPrivate: row.isPrivate,
      status: row.status,
      errorMessage: row.errorMessage,
      fetchedAt: row.fetchedAt,
      data: row.isPrivate && !unlocked ? null : row.data,
    };
  });

  res.json({ summaries });
});

export default router;
