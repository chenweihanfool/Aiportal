import type { HermesIdea } from "@workspace/db"

// 💡 心智分數（想法版，2026-10-09 第四期）：取代「近 3 天日記篇數」當幸福指數的心智維度。
// 使用者 2026-10-09：「心智分數要改成跟這個想法卡片掛勾 不要再粗略地數日記篇數了 … 以一星期為單位
// 這周產生了多少想法 佔一個分數 有多少想法付諸實行 也佔一個比例」；比重裁定「產生 40%／實行 60%」。
//
//   產生分（40%）＝ 近 7 天新想法數 ÷ 自己過去 8 週（第 8～63 天）每週新想法數的中位數，上限 100
//   實行分（60%）＝ 近 28 天轉為「已實行」的數量 ÷ 有機會實行的想法數，÷ 實行目標（20%）後上限 100
//       有機會實行＝出生超過 7 天、且在 28 天窗口開始前還沒結束（已實行／擱置／放棄）的想法
//
// 先並行兩週（只記錄、顯示，不計入幸福指數），看數字合不合理再切換。實行目標 20% 是起始值，並行期間可調。
// 只用 hermes_ideas_snapshot（HERMES 每個 L1 班次推上來的整份想法庫），不需要新的 pusher。

export const BIRTH_WEIGHT = 0.4
export const ACTION_WEIGHT = 0.6
export const ACTION_TARGET = 0.2 // 28 天內實行「有機會實行的想法」的 20% 就算滿分
const DAY = 86_400_000
const CLOSED = new Set(["done", "shelved", "dropped", "absorbed"])

export interface IdeasMind {
  score: number // 0-100，一位小數
  birth: { score: number; born7: number; baseline: number; weekly: number[] }
  action: { score: number; done28: number; eligible: number; rate: number; target: number }
  formula: string
}

const dayStart = (ymd: string) => Date.parse(`${ymd}T00:00:00+08:00`)
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length === 0 ? 0 : s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const round1 = (x: number) => Math.round(x * 10) / 10

/** today＝台北日期 YYYY-MM-DD；窗口都含今天（今天 00:00 到明天 00:00 也算在「近 7 天」裡） */
export function computeIdeasMind(ideas: HermesIdea[], today: string): IdeasMind {
  const end = dayStart(today) + DAY // 明天 00:00（台北）
  const born = ideas.map((i) => Date.parse(i.bornAt)).filter((t) => Number.isFinite(t))

  // 產生分：近 7 天 vs 過去 8 個完整 7 天窗口的中位數（基準至少 1，避免除以 0 或一篇就爆表）
  const inWin = (t: number, from: number, to: number) => t >= from && t < to
  const born7 = born.filter((t) => inWin(t, end - 7 * DAY, end)).length
  const weekly = Array.from({ length: 8 }, (_, k) => {
    const to = end - 7 * DAY * (k + 1)
    return born.filter((t) => inWin(t, to - 7 * DAY, to)).length
  })
  const baseline = Math.max(1, median(weekly))
  const birthScore = Math.min(100, (100 * born7) / baseline)

  // 實行分：28 天窗口
  const winStart = end - 28 * DAY
  let eligible = 0
  let done28 = 0
  for (const it of ideas) {
    const b = Date.parse(it.bornAt)
    if (!Number.isFinite(b) || b >= end - 7 * DAY) continue // 出生未滿 7 天的不算分母
    if (it.status === "absorbed") continue // 🔀 被併入的想法由承接者代表，不算分母（不論何時併入）
    const closedBefore = it.history.some((h) => CLOSED.has(h.status) && Date.parse(h.at) < winStart)
      && !it.history.some((h) => !CLOSED.has(h.status) && Date.parse(h.at) >= winStart) // 窗口前結束、之後沒重開
    if (closedBefore) continue
    eligible++
    if (it.history.some((h) => h.status === "done" && inWin(Date.parse(h.at), winStart, end))) done28++
  }
  const rate = eligible ? done28 / eligible : 0
  const actionScore = eligible ? Math.min(100, (100 * rate) / ACTION_TARGET) : 0

  const score = round1(BIRTH_WEIGHT * birthScore + ACTION_WEIGHT * actionScore)
  return {
    score,
    birth: { score: round1(birthScore), born7, baseline, weekly: weekly.slice().reverse() },
    action: { score: round1(actionScore), done28, eligible, rate: Math.round(rate * 1000) / 1000, target: ACTION_TARGET },
    formula: `產生 ${round1(birthScore)} × 40% ＋ 實行 ${round1(actionScore)} × 60% ＝ ${score}`,
  }
}

