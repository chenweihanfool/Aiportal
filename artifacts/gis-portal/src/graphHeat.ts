// 關係宇宙的「熱度」顏色：節點大小不再代表關聯數，改用顏色深淺——越深越熱門（關聯事件越多）。
// 純函式（不碰 React／DOM），方便測試。
//
// 規則：
//  - 熱度 t∈[0,1]＝同一類節點裡的相對關聯數（取平方根再正規化：關聯數是長尾分佈，線性映射會讓
//    絕大多數節點擠在最淺端）。同類只有一種數值（或只有一個節點）時沒有比較意義，取 0.5。
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

/** 同類節點內的相對熱度 0~1（平方根正規化）。 */
export function heatT(count: number, min: number, max: number): number {
  if (!(max > min)) return 0.5
  const t = (Math.sqrt(Math.max(0, count)) - Math.sqrt(Math.max(0, min))) / (Math.sqrt(max) - Math.sqrt(Math.max(0, min)))
  return Math.max(0, Math.min(1, t))
}

const mix = (a: Hsl, b: Hsl, t: number): Hsl => ({
  h: a.h + (b.h - a.h) * t,
  s: a.s + (b.s - a.s) * t,
  l: a.l + (b.l - a.l) * t,
})

/** 核心類型（琥珀）的熱度色帶：暗琥珀 → 深橘。 */
export const CORE_FLOOR: Hsl = { h: 38, s: 0.45, l: 0.4 }
export const CORE_PEAK: Hsl = { h: 20, s: 1, l: 0.52 }

export function coreHeatColor(t: number): string {
  return hslToHex(mix(CORE_FLOOR, CORE_PEAK, t))
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
export const CORE_RAMP = { floor: coreHeatColor(0), peak: coreHeatColor(1) }
