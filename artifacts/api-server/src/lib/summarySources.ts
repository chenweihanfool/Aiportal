import { db, busynessIndexHistoryTable, happinessIndexHistoryTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  HAPPINESS_CONFIG,
  computeDisplayedScore,
  computeHappinessComponents,
  getHappinessConfigVersion,
} from "./happinessIndex";
import { fetchMindIndex } from "./mindIndex";
import { fetchTravelIndex } from "./adventureLog";

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

export function taipeiDateString(date: Date): string {
  // en-CA formats as YYYY-MM-DD, which is both what Postgres DATE columns
  // expect and directly sortable/comparable as a string.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// Add one entry per subsystem as it comes online. summaryFetchJob polls
// every source on the same schedule and caches the result in
// subsystem_summaries as a fallback for when the real-time dashboard fetch
// (fetchFreshSummaries, below) can't reach the DB at all. "hhi" is computed
// separately in fetchFreshSummaries from the other three's live results, so
// it's not listed here.
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
    id: "mind-index",
    name: "心智指標",
    isPrivate: true,
    fetch: fetchMindIndex,
  },
  {
    id: "travel",
    name: "旅遊生活",
    isPrivate: true,
    fetch: fetchTravelIndex,
  },
];
// REAL-TIME FETCH — for /api/dashboard on page load (not cached)
// ─────────────────────────────────────────────

export interface DashboardSummary {
  subsystemId: string;
  name: string;
  isPrivate: boolean;
  status: "ok" | "error" | "pending";
  errorMessage: string | null;
  fetchedAt: string | null;
  data: Record<string, unknown> | null;
}

/** Fetch all subsystem data directly from their origin APIs (or DB history
 *  for sources like Vikunja that are already persisted). Returns a map
 *  keyed by subsystemId so the dashboard route can assemble the response.
 *  On failure, returns the error as the data payload so the UI shows
 *  "暫時無法取得資料" rather than crashing. */
export async function fetchFreshSummaries(): Promise<Map<string, DashboardSummary>> {
  const results = new Map<string, DashboardSummary>();

  // Fetch the three raw sources concurrently (pf-cwh, fitnessforge, vikunja)
  // hhi is derived from them, so it's computed after.
  const rawSources = SUMMARY_SOURCES.filter((s) => s.id !== "hhi");
  const fetchPromises = rawSources.map(async (source) => {
    try {
      const data = await source.fetch();
      return {
        subsystemId: source.id,
        name: source.name,
        isPrivate: source.isPrivate,
        status: "ok" as const,
        errorMessage: null,
        fetchedAt: new Date().toISOString(),
        data: data as Record<string, unknown>,
      };
    } catch (err) {
      const message = (err as Error).message;
      return {
        subsystemId: source.id,
        name: source.name,
        isPrivate: source.isPrivate,
        status: "error" as const,
        errorMessage: message,
        fetchedAt: new Date().toISOString(),
        data: null,
      };
    }
  });

  const rawResults = await Promise.all(fetchPromises);
  rawResults.forEach((r) => results.set(r.subsystemId, r));

  // Compute HHI from the raw results we just fetched (not from DB cache).
  const pf = results.get("pf-cwh");
  const ff = results.get("fitnessforge");
  const vk = results.get("vikunja");
  const mi = results.get("mind-index");
  const tv = results.get("travel");

  const lifeFreedomScore = pf?.status === "ok" ? (pf.data)?.lifeFreedomIndex as number | null : null;
  const fitnessHabitScore = ff?.status === "ok" ? (ff.data)?.habitIndex as number | null : null;
  const busynessScore = vk?.status === "ok" ? (vk.data)?.busyIndex as number | null : null;
  // 2026-08-20 起改讀 dailyEngagementScore（當天日記篇數＋完成任務數），不再
  // 讀知識庫健康分數 score——那組分數還留著給 MindIndexCard 顯示，只是不計
  // 入 HHI 了。daily-life-score.py 補這個欄位之前，這裡會是 null，跟其他
  // 缺資料的維度一樣走重新正規化，不會顯示假分數。
  const mindScore = mi?.status === "ok" ? (mi.data)?.dailyEngagementScore as number | null : null;
  // The file read can succeed while HERMES's own scoring script hasn't run
  // in a while — that's a stale *score*, not a fetch failure, so it doesn't
  // show up as mi.status === "error". Surfaced via usingStaleData instead.
  const mindStale = mi?.status === "ok" ? (mi.data)?.stale === true : false;
  const travelScore = tv?.status === "ok" ? (tv.data)?.travelScore as number | null : null;

  const result = computeHappinessComponents({
    lifeFreedomScore,
    fitnessHabitScore,
    busynessScore,
    mindScore,
    travelScore,
  });

  const hhiData = await computeHappinessIndexFresh(result, busynessScore, mindStale);
  const hhiEntry: DashboardSummary = {
    subsystemId: "hhi",
    name: "翰翰仔幸福指數",
    isPrivate: true,
    status: hhiData.finalScore !== null ? "ok" : "pending",
    errorMessage: hhiData.finalScore !== null ? null : "資料準備中",
    fetchedAt: new Date().toISOString(),
    data: hhiData,
  };
  results.set("hhi", hhiEntry);

  return results;
}

/** Recompute HHI from a live fetch and upsert today's row to
 *  happiness_index_history, keyed by date — safe to call on every page load
 *  since it's idempotent, not just once a day. This is now the only place
 *  that writes to that table (the old cron-based writer was removed when the
 *  dashboard switched to real-time fetch). Reads yesterday's displayedScore
 *  from the DB so day-over-day smoothing keeps working. */
async function computeHappinessIndexFresh(
  result: import("./happinessIndex").HappinessResult,
  busynessScore: number | null,
  mindStale: boolean
): Promise<Record<string, unknown>> {
  // Every other input here is a genuinely fresh live fetch — the one
  // exception is mind-index, where a successful file read can still carry a
  // score HERMES's own scoring script hasn't updated in a while (see
  // mindIndex.ts). That's the only source of staleness left since the
  // real-time-fetch switch, so it drives this directly.
  const usingStaleData = mindStale;
  const configVersion = getHappinessConfigVersion();
  const weights = {
    lifeFreedomWeight: HAPPINESS_CONFIG.lifeFreedomWeight,
    fitnessWeight: HAPPINESS_CONFIG.fitnessWeight,
    calmWeight: HAPPINESS_CONFIG.calmWeight,
    mindWeight: HAPPINESS_CONFIG.mindWeight,
    travelWeight: HAPPINESS_CONFIG.travelWeight,
  };

  if (result.finalScore === null) {
    // All inputs missing — nothing to persist, nothing fake to show.
    return {
      finalScore: null,
      displayedScore: null,
      baseScore: null,
      weakestScore: null,
      weakestComponent: null,
      lifeFreedomScore: null,
      fitnessHabitScore: null,
      calmScore: null,
      mindScore: null,
      travelScore: null,
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
    mindScore: result.components.mindScore,
    travelScore: result.components.travelScore,
    busynessScore,
    availableComponents: result.components.availableComponents,
    usingStaleData,
    configVersion,
    weights,
  };
}