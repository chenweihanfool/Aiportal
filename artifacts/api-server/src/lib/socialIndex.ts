import { db, socialIndexHistoryTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { roundHalfUp } from "./happinessIndex";

// 社交指標 — 全被動日記萃取，資料來源是 HERMES 自己的 L1/L2 日記處理流程
// 額外寫出的 social_interactions.jsonl（\\NASD723\...\Vault\社交\ 下），跟
// people.yaml 的 alias 正規化一樣，都是 HERMES 自己的責任，Aiportal 只讀不寫。
// social_interactions.jsonl 只有 collect.ps1（host-side，有真實 NAS UNC 存
// 取）讀得到，跟心智指標的日記讀取是同一個限制（見 mindIndex.ts 的說明）。
// collect.ps1 因此只做檔案解析、產出聚合計數（觀測日數／不重複人數／加權
// 互動點數／有互動天數），這個檔案的職責是那之後「聚合計數 -> 三個子分數 ->
// 綜合分數」這段值得單元測試的算術，比照 happinessIndex.ts「Pure
// calculation — no DB/network access」的既有慣例。
//
// 已知限制：心智指標跟社交指標都源自日記，寫作頻率會造成部分共線；本版無
// 主觀孤獨感錨點，量的是「可觀測的社交活動」而非「主觀連結感」。

// 2026-10-27 起 v2（SOCIAL_V2_SINCE，見 happinessDimensionHistory.ts）。v1 是 7 天窗口、
// 廣度 5 人封頂、強度 15 點封頂：一般的一週很容易兩項都頂到 100，原始分數多半貼著上限，
// 再排百分位就變成「頂到 100＝100 分、差一點＝掉到 30 幾」的大幅跳動；同事、代書、機關的
// 業務往來也跟家人朋友等權，忙工作的一週反而社交分數高。v2 只改計分，資料來源不變
// （L1 快掃順帶萃取的 social_interactions.jsonl，不新增管線）：
//   - 窗口改 14 天（kb-pipeline social-index-pusher 計算），單週的起伏不會整段翻掉
//   - 同事類（category=colleague）互動點數 × COLLEAGUE_WEIGHT，且不算進廣度與連結率
//   - 廣度／強度改用遞減報酬曲線 100 × (1 − e^(−x/k))，不封頂：多一個人、多一次見面都還看得出差別
export interface SocialCounts {
  observedDayCount: number; // 0-14：近 14 天有日記的天數
  distinctPersonCount: number; // 同窗口內不重複的非同事 person_id 數
  weightedInteractionPoints: number; // Σ 類型點數（見面 3／通話 2／訊息 1）× 類別權重（同事 0.25，其他 1）
  daysWithInteraction: number; // 窗口內至少 1 筆非同事互動的天數
}

export interface SocialIndexResult {
  breadthScore: number | null;
  intensityScore: number | null;
  connectionRateScore: number | null;
  socialScore: number | null; // null iff observedDayCount === 0（"資料準備中"）
}

// 給 kb-pipeline social-index-pusher 對照用的文件常數——實際加總在推送端做，這裡不重算，
// 只是讓兩邊的權重值有一個共同可核對的地方。
export const FACE_TO_FACE_WEIGHT = 3;
export const CALL_WEIGHT = 2;
export const TEXT_WEIGHT = 1;
export const COLLEAGUE_WEIGHT = 0.25;
export const SOCIAL_WINDOW_DAYS = 14;

const BREADTH_SCALE_PEOPLE = 4; // 4 人 ≈ 63、8 人 ≈ 86
const INTENSITY_SCALE_POINTS = 20; // 20 點（約 7 次見面）≈ 63、40 點 ≈ 86
const WEIGHTS = { breadth: 0.35, intensity: 0.35, connectionRate: 0.3 } as const;

const saturating = (x: number, scale: number): number => roundHalfUp(100 * (1 - Math.exp(-Math.max(0, x) / scale)));

// observedDayCount === 0（近 14 天完全沒寫日記，觀測缺失）跟 observedDayCount
// >= 1 但零互動紀錄（真的沒有社交，是有效的 0 分）語意不能混淆——前者回傳
// 全 null 讓上層當成缺資料處理（權重重新分配，不當假的 0 分），後者是真實訊
// 號，正常參與加權平均與最弱項判定。
export function computeSocialIndex(counts: SocialCounts): SocialIndexResult {
  if (counts.observedDayCount <= 0) {
    return { breadthScore: null, intensityScore: null, connectionRateScore: null, socialScore: null };
  }

  const breadthScore = saturating(counts.distinctPersonCount, BREADTH_SCALE_PEOPLE);
  const intensityScore = saturating(counts.weightedInteractionPoints, INTENSITY_SCALE_POINTS);
  const connectionRateScore = Math.min(100, roundHalfUp((counts.daysWithInteraction / counts.observedDayCount) * 100));
  const socialScore = roundHalfUp(
    WEIGHTS.breadth * breadthScore + WEIGHTS.intensity * intensityScore + WEIGHTS.connectionRate * connectionRateScore
  );

  return { breadthScore, intensityScore, connectionRateScore, socialScore };
}

// ── DB reader（比照 lib/mindIndex.ts 的 fetchMindIndex）─────────────────

const STALE_THRESHOLD_MS = 36 * 60 * 60 * 1000; // 跟心智指標同樣的門檻/理由：collect.ps1 每 ~10 分鐘推一次

export interface SocialIndexData {
  observedDayCount: number | null;
  distinctPersonCount: number | null;
  personNames: string[] | null;
  weightedInteractionPoints: number | null;
  daysWithInteraction: number | null;
  breadthScore: number | null;
  intensityScore: number | null;
  connectionRateScore: number | null;
  socialScore: number | null;
  updatedAt: string | null;
  stale: boolean;
}

export async function fetchSocialIndex(): Promise<SocialIndexData> {
  const [row] = await db
    .select()
    .from(socialIndexHistoryTable)
    .orderBy(desc(socialIndexHistoryTable.date))
    .limit(1);

  if (!row) {
    throw new Error(
      "social_index_history has no rows yet — has collect.ps1 POSTed to /api/admin/social-index at least once?"
    );
  }

  const stale = Date.now() - row.computedAt.getTime() > STALE_THRESHOLD_MS;

  return {
    observedDayCount: row.observedDayCount,
    distinctPersonCount: row.distinctPersonCount,
    personNames: row.personNames,
    weightedInteractionPoints: row.weightedInteractionPoints,
    daysWithInteraction: row.daysWithInteraction,
    breadthScore: row.breadthScore,
    intensityScore: row.intensityScore,
    connectionRateScore: row.connectionRateScore,
    socialScore: row.socialScore,
    updatedAt: row.computedAt.toISOString(),
    stale,
  };
}
