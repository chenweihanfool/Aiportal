import { db, subsystemSummariesTable, busynessIndexHistoryTable, happinessIndexHistoryTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  HAPPINESS_CONFIG,
  computeDisplayedScore,
  computeHappinessComponents,
  getHappinessConfigVersion,
} from "./happinessIndex";

export interface SummarySource {
  id: string;
  name: string;
  isPrivate: boolean;
  // Returns the JSON payload to cache as-is.
  fetch: () => Promise<unknown>;
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Vikunja's busyness score is no longer computed here — it's now the
// production output of the standalone Python service
// (services/busyness-index/), which writes to busyness_index_history on its
// own daily cron. This just reads the latest row.
async function fetchVikunjaBusynessFromHistory(): Promise<unknown> {
  const [row] = await db
    .select()
    .from(busynessIndexHistoryTable)
    .orderBy(desc(busynessIndexHistoryTable.date))
    .limit(1);
  if (!row) {
    throw new Error(
      "busyness_index_history has no rows yet — has services/busyness-index/compute_daily.py run at least once?"
    );
  }
  return {
    busyIndex: row.score,
    overdueScore: row.overdueScore,
    loadScore: row.loadScore,
    stagnationScore: row.stagnationScore,
    completionScore: row.completionScore,
    nullComponents: row.nullComponents,
    approximatedCount: row.approximatedCount,
    configVersion: row.configVersion,
    computedAt: row.computedAt,
  };
}

async function readCachedScore(
  subsystemId: string,
  field: string
): Promise<{ value: number | null; stale: boolean }> {
  const [row] = await db
    .select()
    .from(subsystemSummariesTable)
    .where(eq(subsystemSummariesTable.subsystemId, subsystemId))
    .limit(1);
  if (!row) return { value: null, stale: false };
  const data = row.data as Record<string, unknown>;
  const value = typeof data[field] === "number" ? (data[field] as number) : null;
  return { value, stale: row.status === "error" };
}

function taipeiDateString(date: Date): string {
  // en-CA formats as YYYY-MM-DD, which is both what Postgres DATE columns
  // expect and directly sortable/comparable as a string.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// 翰翰仔幸福指數 — derived from the OTHER three sources' already-cached
// subsystem_summaries rows (not re-fetched from their origin APIs), so this
// must run AFTER pf-cwh/fitnessforge/vikunja in the same sequential
// summaryFetchJob pass. See jobs/summaryFetchJob.ts for why the pass is
// sequential rather than concurrent — this is the reason.
async function computeAndPersistHappinessIndex(): Promise<unknown> {
  const [lifeFreedom, fitness, vikunja] = await Promise.all([
    readCachedScore("pf-cwh", "lifeFreedomIndex"),
    readCachedScore("fitnessforge", "habitIndex"),
    readCachedScore("vikunja", "busyIndex"),
  ]);

  const result = computeHappinessComponents({
    lifeFreedomScore: lifeFreedom.value,
    fitnessHabitScore: fitness.value,
    busynessScore: vikunja.value,
  });

  const usingStaleData = lifeFreedom.stale || fitness.stale || vikunja.stale;
  const configVersion = getHappinessConfigVersion();
  // Sent to the frontend so it displays the weight percentages next to each
  // contribution without hardcoding a second copy of HAPPINESS_CONFIG that
  // could silently drift out of sync with this one.
  const weights = {
    lifeFreedomWeight: HAPPINESS_CONFIG.lifeFreedomWeight,
    fitnessWeight: HAPPINESS_CONFIG.fitnessWeight,
    calmWeight: HAPPINESS_CONFIG.calmWeight,
  };

  if (result.finalScore === null) {
    // All three inputs missing — nothing to persist, nothing fake to show.
    return {
      finalScore: null,
      displayedScore: null,
      baseScore: null,
      weakestScore: null,
      weakestComponent: null,
      lifeFreedomScore: null,
      fitnessHabitScore: null,
      calmScore: null,
      busynessScore: null,
      availableComponents: [],
      usingStaleData,
      configVersion,
      weights,
    };
  }

  const now = new Date();
  const today = taipeiDateString(now);
  const yesterday = taipeiDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  const [yesterdayRow] = await db
    .select({ displayedScore: happinessIndexHistoryTable.displayedScore })
    .from(happinessIndexHistoryTable)
    .where(eq(happinessIndexHistoryTable.date, yesterday))
    .limit(1);

  const displayedScore = computeDisplayedScore(result.finalScore, yesterdayRow?.displayedScore ?? null);

  const historyRow = {
    date: today,
    finalScore: result.finalScore,
    displayedScore,
    baseScore: result.baseScore!,
    weakestScore: result.weakestScore!,
    weakestComponent: result.weakestComponent!,
    availableComponents: result.components.availableComponents,
    configVersion,
  };

  await db
    .insert(happinessIndexHistoryTable)
    .values(historyRow)
    .onConflictDoUpdate({
      target: happinessIndexHistoryTable.date,
      set: { ...historyRow, computedAt: new Date() },
    });

  return {
    finalScore: result.finalScore,
    displayedScore,
    baseScore: result.baseScore,
    weakestScore: result.weakestScore,
    weakestComponent: result.weakestComponent,
    lifeFreedomScore: result.components.lifeFreedomScore,
    fitnessHabitScore: result.components.fitnessHabitScore,
    calmScore: result.components.calmScore,
    busynessScore: vikunja.value,
    availableComponents: result.components.availableComponents,
    usingStaleData,
    configVersion,
    weights,
  };
}

// Add one entry per subsystem as it comes online. summaryFetchJob polls
// every source on the same schedule and caches the result in
// subsystem_summaries. Order matters: "hhi" reads the other three's cached
// rows, so it must stay last.
export const SUMMARY_SOURCES: SummarySource[] = [
  {
    id: "pf-cwh",
    name: "人生進度管理系統",
    isPrivate: true,
    fetch: () =>
      fetchJson(process.env["PF_CWH_SUMMARY_URL"] ?? "https://cwh2023.synology.me/pf/api/public/summary"),
  },
  {
    id: "fitnessforge",
    name: "運動 APP 系統",
    isPrivate: true,
    fetch: () =>
      fetchJson(process.env["FITNESSFORGE_SUMMARY_URL"] ?? "https://cwh2023.synology.me/fitness/api/public/summary"),
  },
  {
    id: "vikunja",
    name: "任務追蹤系統",
    isPrivate: true,
    fetch: fetchVikunjaBusynessFromHistory,
  },
  {
    id: "hhi",
    name: "翰翰仔幸福指數",
    isPrivate: true,
    fetch: computeAndPersistHappinessIndex,
  },
];
