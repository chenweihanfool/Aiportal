// 旅遊分數的純計分數學（recency／frequency／期待加分）——不碰網路與資料庫。
// 原本與 AdventureLog 的連線也在這個檔（2026-10-16 AdventureLog 棄用後移除）；現在的資料來源是遊記＋美食地圖，見 travelTrips.ts。
import { clamp, roundHalfUp } from "./happinessIndex";

const DAY_MS = 24 * 60 * 60 * 1000;

// 2026-08-21（HHI v2）：期待加分開關，預設開啟——程式碼常數，不走 env，比照
// HAPPINESS_CONFIG 本身也是硬編常數的慣例，不需要每個維度的每個子參數都做
// 成環境變數。
const ANTICIPATION_BONUS_ENABLED = true;
const ANTICIPATION_BONUS_POINTS = 5;
const FREQUENCY_WINDOW_DAYS = 180;
const FREQUENCY_TARGET_TRIP_DAYS = 20; // 180 天內累積行程天數達此值 = 頻率分 100

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
