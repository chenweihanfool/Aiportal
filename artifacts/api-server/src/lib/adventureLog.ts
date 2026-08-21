// 旅遊生活 — reads trip recency/frequency/anticipation from a self-hosted
// AdventureLog instance (https://github.com/seanmorley15/AdventureLog).
// Unlike mind-index/busyness-index, this doesn't need a host-side collector
// or a Postgres history table: AdventureLog has a public HTTPS API api-server
// can call directly (same pattern as the Vikunja integration), and everything
// below only ever needs "now" + the full visits list, so it's cheap to
// recompute live on every dashboard request.
//
// Auth confirmed against the real instance: `Authorization: Api-Key <token>`
// (not Bearer) — AdventureLog's API keys use Django REST Framework's
// APIKey scheme, not OAuth-style bearer tokens.
import { clamp, roundHalfUp } from "./happinessIndex";

const ADVENTURELOG_API_BASE_URL = process.env["ADVENTURELOG_API_BASE_URL"] ?? "https://adventure.cwh2023.synology.me";
const ADVENTURELOG_API_TOKEN = process.env["ADVENTURELOG_API_TOKEN"];

const DAY_MS = 24 * 60 * 60 * 1000;

// 2026-08-21（HHI v2）：期待加分開關，預設開啟——程式碼常數，不走 env，比照
// HAPPINESS_CONFIG 本身也是硬編常數的慣例，不需要每個維度的每個子參數都做
// 成環境變數。
const ANTICIPATION_BONUS_ENABLED = true;
const ANTICIPATION_BONUS_POINTS = 5;
const FREQUENCY_WINDOW_DAYS = 180;
const FREQUENCY_TARGET_TRIP_DAYS = 20; // 180 天內累積行程天數達此值 = 頻率分 100

interface AdventureLogVisit {
  id: string;
  start_date: string;
  end_date: string;
}

export interface TravelIndexData {
  travelScore: number | null;
  daysSinceLastTrip: number | null;
  lastTripEndDate: string | null;
  recencyScore: number | null; // scoreFromDaysSince 的輸出，獨立暴露給卡片顯示
  frequencyScore: number | null;
  tripDaysLast180: number | null; // 180 天內累積行程天數（原始值，供卡片支援統計顯示）
  anticipationBonus: number; // 0 或 ANTICIPATION_BONUS_POINTS，一定有值（不隨 travelScore 一起變 null）
  hasUpcomingTrip: boolean;
}

// 3 天內剛玩回來 = 滿分；之後線性遞減，約 93 天沒出去玩 = 0 分。使用者明確選
// 了「最近有沒有出去玩」（recency），不是「有計畫中的行程就加分」，所以只看
// 已經結束的行程，還沒發生的行程（is_visited=false 那種）不算。
export function scoreFromDaysSince(daysSinceLastTrip: number): number {
  if (daysSinceLastTrip <= 3) return 100;
  return Math.max(0, Math.round(100 - (daysSinceLastTrip - 3) * (100 / 90)));
}

export interface TravelScoreInputs {
  daysSinceLastTrip: number;
  tripDaysLast180: number;
  hasUpcomingTrip: boolean;
}

export interface TravelScoreResult {
  travelScore: number;
  recencyScore: number;
  frequencyScore: number;
  anticipationBonus: number;
}

// 純計分數學，跟 fetchTravelIndex 的 HTTP/資料整形分開，比照 socialIndex.ts
// 的 computeSocialIndex 同樣的「pure calculation, separate from I/O」慣例，
// 讓封頂/開關/四捨五入順序這些邏輯可以直接單元測試，不用 mock fetch。
export function computeTravelScore(inputs: TravelScoreInputs): TravelScoreResult {
  const recencyScore = scoreFromDaysSince(inputs.daysSinceLastTrip);
  const frequencyScore = Math.min(100, roundHalfUp((inputs.tripDaysLast180 / FREQUENCY_TARGET_TRIP_DAYS) * 100));
  const anticipationBonus =
    ANTICIPATION_BONUS_ENABLED && inputs.hasUpcomingTrip ? ANTICIPATION_BONUS_POINTS : 0;
  // 四捨五入順序：先把 recency/frequency 的 0.5/0.5 混合結果 round，再加期待
  // 加分，最後才 clamp——不是加完分再 round，這是規格明確要求的順序。
  const travelScore = clamp(roundHalfUp(0.5 * recencyScore + 0.5 * frequencyScore) + anticipationBonus, 0, 100);
  return { travelScore, recencyScore, frequencyScore, anticipationBonus };
}

export async function fetchTravelIndex(): Promise<TravelIndexData> {
  if (!ADVENTURELOG_API_TOKEN) {
    throw new Error("ADVENTURELOG_API_TOKEN is not set");
  }

  const res = await fetch(`${ADVENTURELOG_API_BASE_URL}/api/visits/`, {
    headers: { Authorization: `Api-Key ${ADVENTURELOG_API_TOKEN}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`AdventureLog HTTP ${res.status}`);

  const visits = (await res.json()) as AdventureLogVisit[];
  const now = Date.now();

  // 沒有對 API 做日期篩選，一次抓全量再本地過濾——AdventureLog 的
  // /api/visits/ 本來就不支援伺服器端日期篩選，規格明確允許這個做法。
  const completed = visits
    .map((v) => ({ ...v, startMs: new Date(v.start_date).getTime(), endMs: new Date(v.end_date).getTime() }))
    .filter((v) => Number.isFinite(v.endMs) && v.endMs <= now);

  const hasUpcomingTrip = visits.some((v) => {
    const startMs = new Date(v.start_date).getTime();
    return Number.isFinite(startMs) && startMs > now;
  });
  const anticipationBonus = ANTICIPATION_BONUS_ENABLED && hasUpcomingTrip ? ANTICIPATION_BONUS_POINTS : 0;

  if (completed.length === 0) {
    // 帳號剛開始用、或還沒有任何已結束的行程——資料不足，不是錯誤，跟其他
    // 指標一樣顯示「資料準備中」而不是編一個假分數。anticipationBonus/
    // hasUpcomingTrip 不受這個影響，照常回傳（雖然目前沒有東西會用到它們，
    // 因為 travelScore 本身還是 null）。
    return {
      travelScore: null,
      daysSinceLastTrip: null,
      lastTripEndDate: null,
      recencyScore: null,
      frequencyScore: null,
      tripDaysLast180: null,
      anticipationBonus,
      hasUpcomingTrip,
    };
  }

  const lastTripEndMs = Math.max(...completed.map((v) => v.endMs));
  const daysSinceLastTrip = Math.floor((now - lastTripEndMs) / DAY_MS);

  const windowStartMs = now - FREQUENCY_WINDOW_DAYS * DAY_MS;
  const tripDaysLast180 = completed
    .filter((v) => v.endMs >= windowStartMs)
    .reduce((sum, v) => sum + Math.round((v.endMs - v.startMs) / DAY_MS) + 1, 0); // 含頭尾一天算 1 天

  const { travelScore, recencyScore, frequencyScore } = computeTravelScore({
    daysSinceLastTrip,
    tripDaysLast180,
    hasUpcomingTrip,
  });

  return {
    travelScore,
    daysSinceLastTrip,
    lastTripEndDate: new Date(lastTripEndMs).toISOString(),
    recencyScore,
    frequencyScore,
    tripDaysLast180,
    anticipationBonus,
    hasUpcomingTrip,
  };
}
