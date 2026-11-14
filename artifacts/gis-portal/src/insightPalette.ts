// 心得樹的群色盤（純函式）：最多 12 群，色相用黃金角排開（相鄰的群色相差 ≥ 60°），
// 深／淺主題各一組明度與飽和度，對該主題的卡片底色對比 ≥ 3:1（insightPalette.test.ts 驗證）。同一群 id 永遠同色。

export type PaletteTheme = 'dark' | 'light'
export const PALETTE_SIZE = 12

/** 卡片底色（對比檢查用；與 portal.css 的 --c-surface 同值） */
export const PALETTE_BG: Record<PaletteTheme, string> = { dark: '#0e1317', light: '#ffffff' }

const BASE_HUE = 168 // 站台主色的青綠，第一群就是它
const GOLDEN = 137.508
const SAT: Record<PaletteTheme, number> = { dark: 0.56, light: 0.6 }
const LIGHT: Record<PaletteTheme, number> = { dark: 0.64, light: 0.33 }
/** 同群不同脈絡的深淺（明度位移） */
const SHADE_L: Record<PaletteTheme, readonly number[]> = { dark: [0, 0.08, -0.07], light: [0, -0.04, 0.05] }

export function paletteHue(slot: number): number {
  return (BASE_HUE + (((slot % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE) * GOLDEN) % 360
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
  const m = l - c / 2
  const to = (v: number): string => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${to(r1)}${to(g1)}${to(b1)}`
}

/** 葉的新舊（0 近 30 天、1 一年內：原色；2 一～三年：飽和度漸降；3 三年以上：更深更沉穩，仍清楚、不是灰） */
const AGE_SAT: readonly number[] = [1, 1, 0.68, 0.58]
const AGE_L: Record<PaletteTheme, readonly number[]> = { dark: [0, 0, -0.05, -0.1], light: [0, 0, -0.02, -0.05] }

/** 色盤第 slot 格（0～11）在某主題下的顏色；shade 0～2 是同群不同脈絡的深淺；age 0～3 是新舊（預設 0） */
export function paletteColor(slot: number, theme: PaletteTheme, shade = 0, age = 0): string {
  const sh = SHADE_L[theme][((shade % 3) + 3) % 3]!
  const a = clamp3(age)
  return hslToHex(paletteHue(slot), SAT[theme] * AGE_SAT[a]!, LIGHT[theme] + sh + AGE_L[theme][a]!)
}
const clamp3 = (n: number): number => Math.min(3, Math.max(0, Math.round(n)))

const hash = (s: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h
}

/**
 * 群 id → 色盤格。id 尾端有數字（K01、K12）就依號碼取格（K01→0、K12→11），否則依雜湊；撞格時依 id 排序往後找空格。
 * 同樣的 id 集合永遠得到同樣的結果；超過 12 群時多的群循環使用。
 */
export function clusterSlots(ids: readonly string[]): Map<string, number> {
  const out = new Map<string, number>()
  const used = new Set<number>()
  const uniq = [...new Set(ids)].sort()
  for (const id of uniq) {
    const m = /(\d+)$/.exec(id)
    let slot = m ? (Number(m[1]) - 1 + PALETTE_SIZE * 1000) % PALETTE_SIZE : hash(id) % PALETTE_SIZE
    if (used.size < PALETTE_SIZE) { for (let k = 0; k < PALETTE_SIZE && used.has(slot); k++) slot = (slot + 1) % PALETTE_SIZE }
    used.add(slot)
    out.set(id, slot)
  }
  return out
}

// ── 對比 ──
const lin = (v: number): number => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
