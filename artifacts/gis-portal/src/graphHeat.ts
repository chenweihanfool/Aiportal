// 關係宇宙的「熱度」顏色：節點大小不再代表關聯數，改用顏色深淺——越深越熱門（關聯事件越多）。
// 純函式（不碰 React／DOM），方便測試。
//
// 規則：
//  - 熱度 t∈[0,1]＝同一類節點裡的相對關聯數。關聯數是很重的長尾（少數節點上百、多數個位數），
//    線性或平方根映射都會讓絕大多數節點擠在同一小段、整張圖只剩兩種顏色（2.14.0 的實際問題）。
//    所以改用「名次百分位」為主（每個色階都有差不多數量的節點，漸層才看得出來），再摻一小部分
//    對數尺度（讓最熱門的那幾個仍然明顯拉開）：t = 0.75×名次百分位 + 0.25×對數正規化。
//    同值的節點同色（名次取「比它小的節點數」，最冷門的一群恰好是最淺色）；同類只有一種數值（或只有一個節點）時沒有比較意義，取 0.5。
//  - 核心類型（琥珀色系）：最淺＝飽和度偏低的暗琥珀，最深＝飽和的深橘。最淺的明度刻意不高於任何
//    「外圍索引節點」（人／案／物／概念／方法的非核心灰藍色）——使用者要求「最淺也不要比外圍節點淺」，
//    所以最冷門的核心節點也不會比外圍更淡、更容易被忽略。
//  - 非核心索引節點：最淺＝原本的灰藍色，最深＝同色相但更飽和、更深。
//  - 事件節點關聯數恆為 1，不套用熱度。

interface Hsl { h: number; s: number; l: number }

export function hexToHsl(hex: string): Hsl {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { h: 0, s: 0, l: 0 }
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60
  return { h, s, l }
}

export function hslToHex({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
  const m = l - c / 2
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v + m)) * 255).toString(16).padStart(2, '0')
  return `#${to(r1)}${to(g1)}${to(b1)}`
}

/** 對一類節點的關聯數建立熱度函式：count → 0~1（名次百分位為主、對數為輔，見檔頭說明）。 */
export function makeHeatScale(counts: readonly number[]): (count: number) => number {
  const n = counts.length
  const sorted = [...counts].sort((a, b) => a - b)
  const min = sorted[0] ?? 0
  const max = sorted[n - 1] ?? 0
  if (n === 0 || !(max > min)) return () => 0.5
  // 每個值的名次百分位＝「比它小的節點數」/(n-1)：同值的節點得到同一個數字；最冷門的一群恰好是 0
  // （最淺色），而不是被同值的大量節點墊高成中間色；最熱門的單一節點是 1。
  const pct = new Map<number, number>()
  for (let i = 0; i < n; ) {
    let j = i
    while (j + 1 < n && sorted[j + 1] === sorted[i]) j++
    pct.set(sorted[i], i / (n - 1))
    i = j + 1
  }
  const logSpan = Math.log1p(max) - Math.log1p(min)
  return (count: number) => {
    const p = pct.get(count) ?? Math.max(0, Math.min(1, sorted.filter(v => v < count).length / (n - 1)))
    const l = Math.max(0, Math.min(1, (Math.log1p(Math.max(0, count)) - Math.log1p(min)) / logSpan))
    return Math.max(0, Math.min(1, 0.75 * p + 0.25 * l))
  }
}

const mix = (a: Hsl, b: Hsl, t: number): Hsl => ({
  h: a.h + (b.h - a.h) * t,
  s: a.s + (b.s - a.s) * t,
  l: a.l + (b.l - a.l) * t,
})

/** 核心類型（琥珀）的熱度色帶，三段：暗琥珀 → 琥珀 → 深橘紅。多一個中間色讓漸層更細膩。 */
export const CORE_FLOOR: Hsl = { h: 38, s: 0.45, l: 0.4 }
export const CORE_MID: Hsl = { h: 32, s: 0.85, l: 0.48 }
export const CORE_PEAK: Hsl = { h: 12, s: 0.95, l: 0.5 }

export function coreHeatColor(t: number): string {
  const x = Math.max(0, Math.min(1, t))
  return hslToHex(x < 0.5 ? mix(CORE_FLOOR, CORE_MID, x * 2) : mix(CORE_MID, CORE_PEAK, (x - 0.5) * 2))
}

/** 非核心索引節點：從原本的灰藍色（t=0）往「同色相、更飽和更深」走（t=1）。 */
export function outerPeak(base: string): Hsl {
  const b = hexToHsl(base)
  return { h: b.h, s: Math.min(1, b.s + 0.45), l: Math.max(0.32, b.l - 0.22) }
}

export function outerHeatColor(base: string, t: number): string {
  return hslToHex(mix(hexToHsl(base), outerPeak(base), t))
}

/** 色帶的兩端（給圖例的漸層用）。 */
export const CORE_RAMP = { floor: coreHeatColor(0), mid: coreHeatColor(0.5), peak: coreHeatColor(1) }
