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

export interface SocialCounts {
  observedDayCount: number; // 0-7：近 7 天內符合日記篇數規則（>=1 篇）的天數
  distinctPersonCount: number; // 同窗口內不重複 person_id 數
  weightedInteractionPoints: number; // face_to_face*3 + call*2 + text*1 加總
  daysWithInteraction: number; // 窗口內至少 1 筆互動紀錄的天數
}

export interface SocialIndexResult {
  breadthScore: number | null;
  intensityScore: number | null;
  connectionRateScore: number | null;
  socialScore: number | null; // null iff observedDayCount === 0（"資料準備中"）
}

// 給 collect.ps1 對照用的文件常數（互動類型加權）——實際加總在 PowerShell
// 那邊做，這裡不重算，只是讓兩邊的權重值有一個共同可核對的地方。
export const FACE_TO_FACE_WEIGHT = 3;
export const CALL_WEIGHT = 2;
export const TEXT_WEIGHT = 1;

const BREADTH_PER_PERSON = 20; // 5 人封頂 (5*20=100)
const INTENSITY_TARGET_POINTS = 15; // 加權點數達此值 = 100 分

// observedDayCount === 0（近 7 天完全沒寫日記，觀測缺失）跟 observedDayCount
// >= 1 但零互動紀錄（真的沒有社交，是有效的 0 分）語意不能混淆——前者回傳
// 全 null 讓上層當成缺資料處理（權重重新分配，不當假的 0 分），後者是真實訊
// 號，正常參與加權平均與最弱項判定。
export function computeSocialIndex(counts: SocialCounts): SocialIndexResult {
  if (counts.observedDayCount <= 0) {
    return { breadthScore: null, intensityScore: null, connectionRateScore: null, socialScore: null };
  }

  const breadthScore = Math.min(100, counts.distinctPersonCount * BREADTH_PER_PERSON);
  const intensityScore = Math.min(
    100,
    roundHalfUp((counts.weightedInteractionPoints / INTENSITY_TARGET_POINTS) * 100)
  );
  const connectionRateScore = roundHalfUp((counts.daysWithInteraction / counts.observedDayCount) * 100);
  const socialScore = roundHalfUp(0.4 * breadthScore + 0.4 * intensityScore + 0.2 * connectionRateScore);

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
