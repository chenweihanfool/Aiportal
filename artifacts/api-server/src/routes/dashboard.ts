import { Router, type Request, type Response } from "express";
import { db, happinessIndexHistoryTable } from "@workspace/db";
import { desc } from "drizzle-orm";
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

    // Iterate the map itself, not SUMMARY_SOURCES — "hhi" is computed from
    // the other three's results rather than being one of the fetched
    // sources, so it's only present in freshMap, never in SUMMARY_SOURCES.
    const summaries = Array.from(freshMap.values()).map((row) => ({
      subsystemId: row.subsystemId,
      name: row.name,
      isPrivate: row.isPrivate,
      status: row.status,
      errorMessage: row.errorMessage,
      fetchedAt: row.fetchedAt,
      data: row.isPrivate && !unlocked ? null : row.data,
    }));

    // Explicit signal for "was the caller's password actually accepted",
    // separate from any individual private source's data being null — a
    // private source's own fetch can fail (wrong/missing token, origin
    // down, ...) for a correctly-unlocked caller too, and `data === null`
    // looks identical in both cases. The frontend used to *infer* a
    // rejected password from "some private summary has data === null",
    // which was wrong the moment any private source could fail on its own
    // (first hit by the travel/AdventureLog source) — it would silently
    // clear a perfectly valid stored password and re-lock the UI.
    res.json({ summaries, unlocked });
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

    res.json({ summaries, unlocked });
  }
});

// Daily HHI history for the trend-line chart on the happiness card — a
// separate endpoint from /dashboard because this data only changes once a
// day and there's no reason to re-send a growing history array on every
// page-load poll. Same private-zone password gate as /dashboard.
router.get("/happiness/history", async (req: Request, res: Response) => {
  const unlocked = req.headers["x-admin-password"] === ADMIN_PASSWORD;
  if (!unlocked) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }

  const daysParam = Number(req.query["days"]);
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 30;

  // weakestComponent included so the frontend can derive "本月最常見短板"
  // and similar stats without a new endpoint — it's already computed and
  // stored here daily, just never surfaced past the single day it's for.
  const rows = await db
    .select({
      date: happinessIndexHistoryTable.date,
      finalScore: happinessIndexHistoryTable.finalScore,
      displayedScore: happinessIndexHistoryTable.displayedScore,
      weakestComponent: happinessIndexHistoryTable.weakestComponent,
    })
    .from(happinessIndexHistoryTable)
    .orderBy(desc(happinessIndexHistoryTable.date))
    .limit(days);

  // Reverse to chronological order (oldest first) — easier for the frontend
  // chart to plot left-to-right without re-sorting.
  return res.json({ history: rows.reverse() });
});

export default router;
