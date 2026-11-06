// 社交面向「近 14 天」明細：純函式，資料來自 feed companion 的 socialDays（names／types 由推送端 2026-11 起提供）。
import type { CompanionData } from './companion'

export type SocialLevel = 'face' | 'call' | 'text' | 'none'
export interface StripCell { date: string; level: SocialLevel; names: string[] }
export interface CompareWindow { people: number; days: number; meets: number }
export interface SocialRecent {
  strip: StripCell[]
  people: Array<{ name: string; count: number }>
  compare: {
    current: CompareWindow
    previous: CompareWindow
    /** 沒有 names 的日子，人數用每天 people 的最大值近似 */
    approx: boolean
  }
  hasDetail: boolean
}

const DAY_MS = 86_400_000
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)

export function socialRecent(c: CompanionData | null, today: string): SocialRecent {
  const days = new Map((c?.socialDays ?? []).map((d) => [d.date, d]))
  const hasDetail = (c?.socialDays ?? []).some((d) => (d.names?.length ?? 0) > 0 || !!d.types)

  const levelOf = (d: CompanionData['socialDays'][number] | undefined): SocialLevel => {
    if (!d) return 'none'
    if (d.types) {
      if (d.types.face_to_face > 0) return 'face'
      if (d.types.call > 0) return 'call'
      if (d.types.text > 0) return 'text'
    }
    return d.people > 0 ? 'text' : 'none'
  }

  const strip: StripCell[] = []
  for (let i = 13; i >= 0; i--) {
    const date = shift(today, -i)
    const d = days.get(date)
    strip.push({ date, level: levelOf(d), names: d?.names ?? [] })
  }

  const counts = new Map<string, number>()
  for (const cell of strip) for (const n of new Set(cell.names)) counts.set(n, (counts.get(n) ?? 0) + 1)
  const people = [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hant')).slice(0, 8)

  let approx = false
  const windowOf = (from: number, to: number): CompareWindow => {
    const names = new Set<string>()
    let maxPeople = 0
    let interDays = 0
    let meets = 0
    for (let i = from; i <= to; i++) {
      const d = days.get(shift(today, -i))
      if (!d || d.people <= 0) continue
      interDays++
      if (d.names && d.names.length > 0) { d.names.forEach((n) => names.add(n)) }
      else { maxPeople = Math.max(maxPeople, d.people); approx = true }
      meets += d.types?.face_to_face ?? 0
    }
    // 有 names 的日子用不重複名字；沒有的日子只能用人數最大值近似（approx）
    return { people: Math.max(names.size, maxPeople), days: interDays, meets }
  }
  const current = windowOf(0, 13)
  const previous = windowOf(14, 27)
  return { strip, people, compare: { current, previous, approx }, hasDetail }
}
