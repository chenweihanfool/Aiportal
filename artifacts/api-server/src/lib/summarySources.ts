import { db, busynessIndexHistoryTable, happinessIndexHistoryTable } from "@workspace/db";
import { desc, eq, lt } from "drizzle-orm";
import {
  HAPPINESS_CONFIG,
  PERCENTILE_WINDOW_DAYS,
  clamp,
  computeDisplayedScore,
  computeHappinessComponents,
  getHappinessConfigVersion,
  percentileRank,
  type HappinessInputs,
  type HappinessResult,
} from "./happinessIndex";
import { fetchMindIndex } from "./mindIndex";
import { fetchTravelIndex } from "./adventureLog";
import { fetchSocialIndex } from "./socialIndex";

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
  {
    id: "social-index",
    name: "社交指標",
    isPrivate: true,
    fetch: fetchSocialIndex,
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

/** Fetches every raw subsystem source (pf-cwh, fitnessforge, vikunja,
 *  mind-index, travel, social-index, ...) concurrently and returns the
 *  results keyed by subsystemId — no "hhi" entry, no DB write. Shared by
 *  both fetchFreshSummaries (display path, below) and
 *  computeAndPersistDailySnapshot (23:55 persist path, further below) so
 *  neither has to duplicate the fetch-and-catch loop or trigger it twice. */
async function fetchRawSummaryResults(): Promise<Map<string, DashboardSummary>> {
  const results = new Map<string, DashboardSummary>();

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
  return results;
}

/** Fetch all subsystem data directly from their origin APIs (or DB history
 *  for sources like Vikunja that are already persisted). Returns a map
 *  keyed by subsystemId so the dashboard route can assemble the response.
 *  On failure, returns the error as the data payload so the UI shows
 *  "暫時無法取得資料" rather than crashing. */
export async function fetchFreshSummaries(): Promise<Map<string, DashboardSummary>> {
  const results = await fetchRawSummaryResults();

  const today = taipeiDateString(new Date());
  const history = await fetchDimensionHistory(today);
  const { result, busynessScore, usingStaleData } = await extractHappinessResult(results, history);
  const hhiData = await buildHappinessDisplayData(result, busynessScore, usingStaleData);
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

export interface DimensionHistory {
  lifeFreedom: number[];
  fitness: number[];
  calm: number[];
  mind: number[];
  travel: number[];
  social: number[];
}

const EMPTY_HISTORY: DimensionHistory = {
  lifeFreedom: [],
  fitness: [],
  calm: [],
  mind: [],
  travel: [],
  social: [],
};

/** Reads each dimension's *raw* (pre-normalization) scores from the trailing
 *  PERCENTILE_WINDOW_DAYS days strictly before `beforeDate`, for
 *  percentileRank() to rank today's raw score against. Only the 23:55
 *  snapshot job ever writes these columns, so a dimension with no history
 *  yet (or one that was null on a given day) simply contributes fewer
 *  entries — percentileRank() itself falls back to the raw score unchanged
 *  below MIN_HISTORY_DAYS_FOR_PERCENTILE. */
async function fetchDimensionHistory(beforeDate: string): Promise<DimensionHistory> {
  const rows = await db
    .select({
      lifeFreedomRaw: happinessIndexHistoryTable.lifeFreedomRaw,
      fitnessHabitRaw: happinessIndexHistoryTable.fitnessHabitRaw,
      calmRaw: happinessIndexHistoryTable.calmRaw,
      mindRaw: happinessIndexHistoryTable.mindRaw,
      travelRaw: happinessIndexHistoryTable.travelRaw,
      socialRaw: happinessIndexHistoryTable.socialRaw,
    })
    .from(happinessIndexHistoryTable)
    .where(lt(happinessIndexHistoryTable.date, beforeDate))
    .orderBy(desc(happinessIndexHistoryTable.date))
    .limit(PERCENTILE_WINDOW_DAYS);

  const pick = (key: keyof (typeof rows)[number]): number[] =>
    rows.map((r) => r[key]).filter((v): v is number => v !== null);

  return {
    lifeFreedom: pick("lifeFreedomRaw"),
    fitness: pick("fitnessHabitRaw"),
    calm: pick("calmRaw"),
    mind: pick("mindRaw"),
    travel: pick("travelRaw"),
    social: pick("socialRaw"),
  };
}

/** Pure(ish) extraction step shared by the display path (fetchFreshSummaries,
 *  above) and the 23:55 daily-persist path (computeAndPersistDailySnapshot,
 *  below) — pulls each dimension's *raw* score out of the already-fetched
 *  raw results, percentile-ranks it against `history` (HHI v3, see
 *  percentileRank() in happinessIndex.ts), then runs
 *  computeHappinessComponents on the normalized values. No DB write happens
 *  here — `history` itself is a DB read, done by the caller via
 *  fetchDimensionHistory so both callers share one query shape. */
async function extractHappinessResult(
  results: Map<string, DashboardSummary>,
  history: DimensionHistory = EMPTY_HISTORY
): Promise<{
  result: HappinessResult;
  rawComponents: HappinessInputs;
  busynessScore: number | null;
  usingStaleData: boolean;
}> {
  const pf = results.get("pf-cwh");
  const ff = results.get("fitnessforge");
  const vk = results.get("vikunja");
  const mi = results.get("mind-index");
  const tv = results.get("travel");
  const si = results.get("social-index");

  const lifeFreedomRaw = pf?.status === "ok" ? (pf.data)?.lifeFreedomIndex as number | null : null;
  const fitnessHabitRaw = ff?.status === "ok" ? (ff.data)?.habitIndex as number | null : null;
  const busynessScore = vk?.status === "ok" ? (vk.data)?.busyIndex as number | null : null;
  // 2026-08-20 起改讀 dailyEngagementScore（2026-08-21 起是近 3 天滾動窗口日
  // 記篇數，見 HHI v2），不再讀知識庫健康分數 score——那組分數還留著給
  // MindIndexCard 顯示，只是不計入 HHI 了。daily-life-score.py 補這個欄位之
  // 前，這裡會是 null，跟其他缺資料的維度一樣走重新正規化，不會顯示假分數。
  const mindRaw = mi?.status === "ok" ? (mi.data)?.dailyEngagementScore as number | null : null;
  const travelRaw = tv?.status === "ok" ? (tv.data)?.travelScore as number | null : null;
  const socialRaw = si?.status === "ok" ? (si.data)?.socialScore as number | null : null;

  // 心智指標／社交指標都是同一種「檔案讀取成功，但值本身可能是舊的」情境
  // （collect.ps1 停止推送一段時間），跟其他來源的 fetch 失敗（status ===
  // "error"）是不同概念——兩者都算進 usingStaleData，避免只有心智過期會顯
  // 示過期警示、社交過期卻默默不顯示的不一致。
  const mindStale = mi?.status === "ok" ? (mi.data)?.stale === true : false;
  const socialStale = si?.status === "ok" ? (si.data)?.stale === true : false;
  const usingStaleData = mindStale || socialStale;

  // calmRaw is busyness inverted to "higher is better" BEFORE percentile
  // ranking (percentileRank always ranks "higher is better" raw values —
  // see its doc comment in happinessIndex.ts).
  const calmRaw = busynessScore === null ? null : clamp(100 - busynessScore, 0, 100);

  const lifeFreedomScore = lifeFreedomRaw === null ? null : percentileRank(lifeFreedomRaw, history.lifeFreedom);
  const fitnessHabitScore = fitnessHabitRaw === null ? null : percentileRank(fitnessHabitRaw, history.fitness);
  const calmScore = calmRaw === null ? null : percentileRank(calmRaw, history.calm);
  const mindScore = mindRaw === null ? null : percentileRank(mindRaw, history.mind);
  const travelScore = travelRaw === null ? null : percentileRank(travelRaw, history.travel);
  const socialScore = socialRaw === null ? null : percentileRank(socialRaw, history.social);

  // computeHappinessComponents inverts busynessScore internally
  // (calmScore = 100 - busynessScore) — it was kept unchanged (and its
  // existing tests with it) rather than reworked to take calmScore
  // directly, so we invert calmScore back here to cancel that internal
  // inversion out and land on exactly the percentile-normalized calmScore
  // computed above.
  const normalizedBusynessInput = calmScore === null ? null : 100 - calmScore;

  const result = computeHappinessComponents({
    lifeFreedomScore,
    fitnessHabitScore,
    busynessScore: normalizedBusynessInput,
    mindScore,
    travelScore,
    socialScore,
  });

  const rawComponents: HappinessInputs = {
    lifeFreedomScore: lifeFreedomRaw,
    fitnessHabitScore: fitnessHabitRaw,
    busynessScore,
    mindScore: mindRaw,
    travelScore: travelRaw,
    socialScore: socialRaw,
  };

  return { result, rawComponents, busynessScore, usingStaleData };
}

const HAPPINESS_WEIGHTS = {
  lifeFreedomWeight: HAPPINESS_CONFIG.lifeFreedomWeight,
  fitnessWeight: HAPPINESS_CONFIG.fitnessWeight,
  calmWeight: HAPPINESS_CONFIG.calmWeight,
  mindWeight: HAPPINESS_CONFIG.mindWeight,
  travelWeight: HAPPINESS_CONFIG.travelWeight,
  socialWeight: HAPPINESS_CONFIG.socialWeight,
};

/** Builds the /api/dashboard display payload — reads happiness_index_history
 *  but never writes it (writing is now exclusively jobs/dailySnapshotJob.ts's
 *  job, once/day at 23:55 Taipei). Before today's row has been snapshotted,
 *  this returns a live recompute (isSnapshotFinal: false, "今日暫定") smoothed
 *  against the most recent already-persisted day; once today's snapshot
 *  exists, it freezes on that exact stored row (isSnapshotFinal: true) so the
 *  number stops moving for the rest of the day and stays byte-identical to
 *  what /api/happiness/history will later show for today. */
async function buildHappinessDisplayData(
  result: HappinessResult,
  busynessScore: number | null,
  usingStaleData: boolean
): Promise<Record<string, unknown>> {
  const configVersion = getHappinessConfigVersion();

  if (result.finalScore === null) {
    // All inputs missing — nothing to persist, nothing fake to show.
    return {
      finalScore: null,
      displayedScore: null,
      baseScore: null,
      weakestScore: null,
      weakestComponent: null,
      isSnapshotFinal: false,
      lifeFreedomScore: null,
      fitnessHabitScore: null,
      calmScore: null,
      mindScore: null,
      travelScore: null,
      socialScore: null,
      busynessScore: null,
      availableComponents: [],
      usingStaleData,
      configVersion,
      weights: HAPPINESS_WEIGHTS,
    };
  }

  const today = taipeiDateString(new Date());
  const [rawTodayRow] = await db
    .select()
    .from(happinessIndexHistoryTable)
    .where(eq(happinessIndexHistoryTable.date, today))
    .limit(1);

  // 只有 configVersion 跟現在這版公式一致，才算是「今天已經快照過」——不然
  // 舊版程式碼在改版部署前寫的「今天」那筆（舊版是每次開頁面就即時 upsert，
  // 不是固定 23:55 才寫）會被誤當成這版的快照凍結顯示，六個原始維度分數是
  // 用新公式即時算的，但 weakestComponent/baseScore 卻是舊公式（例如少了
  // 社交指標）算出來的舊值，兩邊對不上。改版部署後的第一天，直到當晚 23:55
  // 計時器真的用新公式寫入前，都會走下面的即時計算分支，這是預期行為。
  const todayRow =
    rawTodayRow && rawTodayRow.configVersion === getHappinessConfigVersion() ? rawTodayRow : undefined;

  let finalScore: number;
  let displayedScore: number;
  let baseScore: number;
  let weakestScore: number;
  let weakestComponent: string;
  let isSnapshotFinal: boolean;

  if (todayRow) {
    // 今天 23:55 已經快照過了——直接凍結用已存的那筆，不要再即時重算，這樣
    // 數字整天不會跳動，也保證跟 /api/happiness/history 之後顯示的今天完全
    // 一致。這正是「今日暫定」語意的關鍵：一旦快照過，就不再是暫定的。
    finalScore = todayRow.finalScore;
    displayedScore = todayRow.displayedScore;
    baseScore = todayRow.baseScore;
    weakestScore = todayRow.weakestScore;
    weakestComponent = todayRow.weakestComponent;
    isSnapshotFinal = true;
  } else {
    // 今天還沒被快照——這就是「今日暫定」：即時 finalScore，跟「最近一筆已
    // 存在的 displayedScore」平滑（不是嚴格等於「昨天」日期，見
    // computeAndPersistDailySnapshot 旁的穩健性說明，這裡是同一個查詢）。
    const [priorRow] = await db
      .select({ displayedScore: happinessIndexHistoryTable.displayedScore })
      .from(happinessIndexHistoryTable)
      .where(lt(happinessIndexHistoryTable.date, today))
      .orderBy(desc(happinessIndexHistoryTable.date))
      .limit(1);
    finalScore = result.finalScore;
    displayedScore = computeDisplayedScore(finalScore, priorRow?.displayedScore ?? null);
    baseScore = result.baseScore!;
    weakestScore = result.weakestScore!;
    weakestComponent = result.weakestComponent!;
    isSnapshotFinal = false;
  }

  return {
    finalScore,
    displayedScore,
    baseScore,
    weakestScore,
    weakestComponent,
    isSnapshotFinal,
    lifeFreedomScore: result.components.lifeFreedomScore,
    fitnessHabitScore: result.components.fitnessHabitScore,
    calmScore: result.components.calmScore,
    mindScore: result.components.mindScore,
    travelScore: result.components.travelScore,
    socialScore: result.components.socialScore,
    busynessScore,
    availableComponents: result.components.availableComponents,
    usingStaleData,
    configVersion,
    weights: HAPPINESS_WEIGHTS,
  };
}

/** Called ONLY by jobs/dailySnapshotJob.ts's 23:55 Asia/Taipei timer — the
 *  only writer of happiness_index_history going forward (previously
 *  /api/dashboard upserted on every page load; see this module's other
 *  functions for why that changed).
 *
 *  穩健性說明（刻意的小偏離，不是隨口改動）：把「找昨天」從 `date = yesterday`
 *  的精確比對改成 `date < today ORDER BY date DESC LIMIT 1`。這是必要的，不
 *  只是順手更好：以前每次開頁面都會重新 upsert，就算漏了一天，下次請求就自
 *  我修復；改成一天只快照一次之後，如果剛好某天 23:55 那次計時器失敗，嚴格
 *  比對「昨天」會找不到任何 row，永久打斷平滑鏈——即使更早之前明明有資料。
 *  `<` + `ORDER BY DESC LIMIT 1` 在正常情況下行為完全一樣，但在計時器偶爾
 *  失敗時更正確。 */
export async function computeAndPersistDailySnapshot(): Promise<void> {
  const results = await fetchRawSummaryResults();
  const today = taipeiDateString(new Date());
  const history = await fetchDimensionHistory(today);
  const { result, rawComponents } = await extractHappinessResult(results, history);

  if (result.finalScore === null) return; // 沒東西可存，維持「資料準備中」

  const [priorRow] = await db
    .select({ displayedScore: happinessIndexHistoryTable.displayedScore })
    .from(happinessIndexHistoryTable)
    .where(lt(happinessIndexHistoryTable.date, today))
    .orderBy(desc(happinessIndexHistoryTable.date))
    .limit(1);
  const displayedScore = computeDisplayedScore(result.finalScore, priorRow?.displayedScore ?? null);

  // calmRaw stored here mirrors extractHappinessResult's own calmRaw
  // (100-busyness, clamped) — recomputed rather than threaded through
  // rawComponents since rawComponents.busynessScore intentionally still
  // holds the raw (uninverted) busyness score for display purposes.
  const calmRaw = rawComponents.busynessScore === null ? null : clamp(100 - rawComponents.busynessScore, 0, 100);

  const historyRow = {
    date: today,
    finalScore: result.finalScore,
    displayedScore,
    baseScore: result.baseScore!,
    weakestScore: result.weakestScore!,
    weakestComponent: result.weakestComponent!,
    availableComponents: result.components.availableComponents,
    configVersion: getHappinessConfigVersion(),
    lifeFreedomRaw: rawComponents.lifeFreedomScore,
    fitnessHabitRaw: rawComponents.fitnessHabitScore,
    calmRaw,
    mindRaw: rawComponents.mindScore,
    travelRaw: rawComponents.travelScore,
    socialRaw: rawComponents.socialScore,
  };

  await db
    .insert(happinessIndexHistoryTable)
    .values(historyRow)
    .onConflictDoUpdate({
      target: happinessIndexHistoryTable.date,
      set: { ...historyRow, computedAt: new Date() },
    });
}