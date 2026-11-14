import { describe, expect, it } from 'vitest'
import { PALETTE_BG, PALETTE_SIZE, clusterSlots, contrastRatio, paletteColor, paletteHue } from './insightPalette'

const hueDist = (a: number, b: number): number => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d) }

describe('insightPalette', () => {
  it('同一群 id 永遠同色（不受其他群增減的影響，只要不撞格）', () => {
    const a = clusterSlots(['K01', 'K02', 'K03'])
    const b = clusterSlots(['K03', 'K01', 'K02', 'K04'])
    expect(a.get('K02')).toBe(b.get('K02'))
    expect(paletteColor(a.get('K02')!, 'dark')).toBe(paletteColor(b.get('K02')!, 'dark'))
    expect(clusterSlots(['K01', 'K02'])).toEqual(clusterSlots(['K02', 'K01']))
  })
  it('K01～K12 拿到 12 個不同格、都是合法的 #rrggbb', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `K${String(i + 1).padStart(2, '0')}`)
    const slots = clusterSlots(ids)
    expect(new Set(slots.values()).size).toBe(12)
    for (const th of ['dark', 'light'] as const) for (const id of ids) expect(paletteColor(slots.get(id)!, th)).toMatch(/^#[0-9a-f]{6}$/)
  })
  it('沒有數字的 id 也不撞格（雜湊撞到就往後找空格）', () => {
    const ids = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸', '子', '丑']
    expect(new Set(clusterSlots(ids).values()).size).toBe(12)
  })
  it('相鄰的群色相差夠遠（≥60°），任兩格色相也不會幾乎一樣（≥15°）', () => {
    for (let i = 0; i < PALETTE_SIZE - 1; i++) expect(hueDist(paletteHue(i), paletteHue(i + 1))).toBeGreaterThanOrEqual(60)
    for (let i = 0; i < PALETTE_SIZE; i++) for (let j = i + 1; j < PALETTE_SIZE; j++) expect(hueDist(paletteHue(i), paletteHue(j))).toBeGreaterThanOrEqual(15)
  })
  it('深淺兩種主題下，每一格、每種深淺對卡片底色的對比都 ≥ 3:1', () => {
    for (const th of ['dark', 'light'] as const) {
      for (let slot = 0; slot < PALETTE_SIZE; slot++) {
        for (let shade = 0; shade < 3; shade++) {
          const c = contrastRatio(paletteColor(slot, th, shade), PALETTE_BG[th])
          expect(c, `${th} slot ${slot} shade ${shade}`).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })
})
