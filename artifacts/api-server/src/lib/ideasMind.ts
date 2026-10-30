import type { HermesIdea } from "@workspace/db"

// 💡 心智分數（想法版）：幸福指數心智維度的 80%。
// 使用者 2026-10-09：「心智分數要改成跟這個想法卡片掛勾 不要再粗略地數日記篇數了 … 以一星期為單位
// 這周產生了多少想法 佔一個分數 有多少想法付諸實行 也佔一個比例」；比重裁定「產生 40%／實行 60%」。
//
// 2026-10-30 改固定目標：舊公式連續多日 100，心智分數等於只剩 AI 自評在動。原因是產生分對照「自己過去 8 週中位數」，
// 而想法庫 10/09 才開始，基準幾乎是 0；實行分的分子分母又混進回補資料（10/09 一天補登 44 筆 done，實行率 72.8%，目標才 20%）。
// 改用和每日評分同樣的遞減曲線，不看比率也不看自己過去的基準，回補資料不算：
//   產生分＝100×(1−0.5^(近 7 天新想法÷6))：3 個 29、6 個 50、10 個 68、20 個 90
//   實行分＝100×(1−0.5^(近 28 天實行÷8))：2 個 16、8 個 50、18 個 79、32 個 94
// 目標取自實際節奏（10/12 起每週新想法 9～12 個、實行 3～9 個），做得更多分數還看得到差別，不會頂到 100。

export const BIRTH_WEIGHT = 0.4
export const ACTION_WEIGHT = 0.6
/** 近 7 天幾個新想法拿 50 分 */
export const BIRTH_HALF = 6
/** 近 28 天實行幾個想法拿 50 分 */
export const ACTION_HALF = 8
const DAY = 86_400_000

export interface IdeasMind {
  score: number // 0-100，一位小數
  birth: { score: number; born7: number; half: number; weekly: number[] }
  action: { score: number; done28: number; half: number }
  formula: string
}

const dayStart = (ymd: string) => Date.parse(`${ymd}T00:00:00+08:00`)
const round1 = (x: number) => Math.round(x * 10) / 10
const curve = (n: number, half: number) => 100 * (1 - 0.5 ** (n / half))

/** today＝台北日期 YYYY-MM-DD；窗口都含今天（今天 00:00 到明天 00:00 也算在「近 7 天」裡） */
export function computeIdeasMind(ideas: HermesIdea[], today: string): IdeasMind {
  const end = dayStart(today) + DAY // 明天 00:00（台北）
  const live = ideas.filter((i) => !i.backfill)
  const born = live.map((i) => Date.parse(i.bornAt)).filter((t) => Number.isFinite(t))
  const inWin = (t: number, from: number, to: number) => t >= from && t < to

  const born7 = born.filter((t) => inWin(t, end - 7 * DAY, end)).length
  // 近 8 個完整 7 天窗口的新想法數（舊→新，含本窗口的前一個），給卡片畫走勢
  const weekly = Array.from({ length: 8 }, (_, k) => {
    const to = end - 7 * DAY * (k + 1)
    return born.filter((t) => inWin(t, to - 7 * DAY, to)).length
  }).reverse()
  const birthScore = curve(born7, BIRTH_HALF)

  const winStart = end - 28 * DAY
  const done28 = live.filter((it) => it.history.some((h) => h.status === "done" && inWin(Date.parse(h.at), winStart, end))).length
  const actionScore = curve(done28, ACTION_HALF)

  const score = round1(BIRTH_WEIGHT * birthScore + ACTION_WEIGHT * actionScore)
  return {
    score,
    birth: { score: round1(birthScore), born7, half: BIRTH_HALF, weekly },
    action: { score: round1(actionScore), done28, half: ACTION_HALF },
    formula: `產生 ${round1(birthScore)} × 40% ＋ 實行 ${round1(actionScore)} × 60% ＝ ${score}`,
  }
}
