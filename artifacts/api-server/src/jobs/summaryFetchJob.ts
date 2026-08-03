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

export function startSummaryFetchJob(): void {
  const runAll = () => {
    for (const source of SUMMARY_SOURCES) {
      void fetchOne(source);
    }
  };
  runAll();
  setInterval(runAll, INTERVAL_MS);
}
