import { Router, type Request, type Response } from "express";
import { fetchFreshSummaries } from "../lib/summarySources";
import { SUMMARY_SOURCES } from "../lib/summarySources";

const router = Router();

const ADMIN_PASSWORD = process.env["ADMIN_PASSWORD"] ?? "85097110";

// Serves the subsystem summaries fetched DIRECTLY from their origin APIs on
// every page load. Previously read from a 20-minute DB cache; now real-time
// so the portal shows current data (with the caveat that Vikunja's busyness
// index is still yesterday's since it only computes once per day).
//
// Private subsystems' data is redacted unless the caller unlocks with the
// same admin password used for the private link zone.
router.get("/dashboard", async (req: Request, res: Response) => {
  const unlocked = req.headers["x-admin-password"] === ADMIN_PASSWORD;

  try {
    const freshMap = await fetchFreshSummaries();

    const summaries = SUMMARY_SOURCES.map((source: { id: string; name: string; isPrivate: boolean }) => {
      const row = freshMap.get(source.id);
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
        name: row.name,
        isPrivate: row.isPrivate,
        status: row.status,
        errorMessage: row.errorMessage,
        fetchedAt: row.fetchedAt,
        data: row.isPrivate && !unlocked ? null : row.data,
      };
    });

    res.json({ summaries });
  } catch (err) {
    // If the real-time fetch itself crashes (e.g. DB unreachable), fall back
    // to the old cached rows so the page isn't completely blank.
    const { db, subsystemSummariesTable } = await import("@workspace/db");
    const rows = await db.select().from(subsystemSummariesTable);
    const bySubsystem = new Map<string, any>(rows.map((row: any) => [row.subsystemId, row]));

    const summaries = SUMMARY_SOURCES.map((source: { id: string; name: string; isPrivate: boolean }) => {
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
        name: row.name,
        isPrivate: row.isPrivate,
        status: row.status,
        errorMessage: row.errorMessage,
        fetchedAt: row.fetchedAt,
        data: row.isPrivate && !unlocked ? null : row.data,
      };
    });

    res.json({ summaries });
  }
});

export default router;
