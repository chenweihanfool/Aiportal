// 數字格式、分數等級（顏色與文字）的純函式。
import { COLOR } from './theme'

// ─────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────
export function formatTWD(n: number): string {
  return `NT$ ${Math.round(n).toLocaleString('zh-TW')}`
}

export function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '資料不足'
  const pct = n * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

export function formatMinutesAgo(iso: string | null): string {
  if (!iso) return '尚未取得'
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return '剛剛更新'
  if (mins < 60) return `${mins} 分鐘前更新`
  return `${Math.round(mins / 60)} 小時前更新`
}

// ─────────────────────────────────────────────
// Score bands — thresholds/labels are domain logic (kept verbatim from the
// glass-card version); only the returned colors changed, from the old
// cyan/green/amber/orange/red palette to this palette's ok/warn/concern/crit
// semantic tones (kept separate from the amber accent per design system).
// ─────────────────────────────────────────────
export function heroTone(score: number | null, invert: boolean): { color: string; label: string } {
  if (score === null) return { color: COLOR.steelDim, label: '資料不足' }
  const s = invert ? 100 - score : score
  if (s >= 80) return { color: COLOR.ok, label: invert ? '輕鬆' : '優異' }
  if (s >= 50) return { color: COLOR.warn, label: '普通' }
  return { color: COLOR.crit, label: invert ? '緊繃' : '待加強' }
}

export function hhiTone(score: number): { color: string; label: string } {
  if (score >= 80) return { color: COLOR.amber, label: '很幸福' }
  if (score >= 65) return { color: COLOR.ok, label: '穩定前進' }
  if (score >= 50) return { color: COLOR.warn, label: '尚可，需留意' }
  if (score >= 35) return { color: COLOR.concern, label: '需調整' }
  return { color: COLOR.crit, label: '警報，先照顧自己' }
}

type Band = [threshold: number, color: string, label: string]

export function bandTone(score: number | null, bands: Band[]): { color: string; label: string } {
  if (score === null) return { color: COLOR.steelDim, label: '資料不足' }
  for (const [threshold, color, label] of bands) {
    if (score >= threshold) return { color, label }
  }
  return { color: COLOR.steelDim, label: '資料不足' }
}

export function pctTone(pct: number | null): string {
  if (pct === null) return COLOR.steelDim
  if (pct >= 90) return COLOR.crit
  if (pct >= 75) return COLOR.warn
  return COLOR.ok
}

export const MIND_SCORE_BANDS: Band[] = [[80, COLOR.ok, '優良'], [60, COLOR.warn, '普通'], [40, COLOR.concern, '偏弱'], [0, COLOR.crit, '停滯']]
export const SOCIAL_SCORE_BANDS: Band[] = [[80, COLOR.ok, '熱絡'], [60, COLOR.warn, '普通'], [40, COLOR.concern, '偏冷'], [0, COLOR.crit, '疏離']]

export function formatGb(n: number): string {
  return `${n.toFixed(1)} GB`
}
