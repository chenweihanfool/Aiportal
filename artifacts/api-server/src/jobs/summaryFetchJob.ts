import { db, subsystemSummariesTable } from "@workspace/db";
import { SUMMARY_SOURCES, type SummarySource } from "../lib/summarySources";
import { logger } from "../lib/logger";

const INTERVAL_MS = 20 * 60 * 1000; // 20 minutes — within the 15-30 min cache window

async function fetchOne(source: SummarySource): Promise<void> {
  try {
    const data = await source.fetch();

    await db
      .insert(subsystemSummariesTable)
      .values({
        subsystemId: source.id,
        data,
        status: "ok",
        errorMessage: null,
        isPrivate: source.isPrivate,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: subsystemSummariesTable.subsystemId,
        set: { data, status: "ok", errorMessage: null, isPrivate: source.isPrivate, fetchedAt: new Date() },
      });

    logger.info({ subsystem: source.id }, "Fetched subsystem summary");
  } catch (err) {
    const message = (err as Error).message;
    logger.warn({ subsystem: source.id, err: message }, "Failed to fetch subsystem summary; keeping last cached value");

    // On failure, only update status/error — leave `data`/`fetchedAt` alone so
    // the dashboard keeps serving the last known-good snapshot instead of
    // going blank when a subsystem is briefly unreachable.
    await db
      .insert(subsystemSummariesTable)
      .values({
        subsystemId: source.id,
        data: {},
        status: "error",
        errorMessage: message,
        isPrivate: source.isPrivate,
        fetchedAt: new Date(0),
      })
      .onConflictDoUpdate({
        target: subsystemSummariesTable.subsystemId,
        set: { status: "error", errorMessage: message, isPrivate: source.isPrivate },
      });
  }
}

// This cron only maintains the subsystem_summaries fallback cache used when
// the real-time dashboard fetch (fetchFreshSummaries, in summarySources.ts)
// can't reach the DB at all — /api/dashboard no longer reads this cache in
// the normal path. "hhi" isn't in SUMMARY_SOURCES, so it isn't cached here;
// it's computed fresh from live data on every dashboard request instead.
export function startSummaryFetchJob(): void {
  // Sequential, not concurrent — no strict ordering requirement anymore, but
  // this keeps origin API load spread out rather than hitting pf-cwh and
  // FitnessForge at the exact same instant.
  const runAll = async () => {
    for (const source of SUMMARY_SOURCES) {
      await fetchOne(source);
    }
  };
  void runAll();
  setInterval(() => void runAll(), INTERVAL_MS);
}
