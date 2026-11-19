// 心得樹的裝飾幾何（純函式，3.10.0）：樹幹根基外擴、土壤帶。只算形狀，不影響排版與點擊。

const r1 = (n: number): number => Math.round(n * 10) / 10

/** 根基外擴：樹幹底部向兩側微張，像長在地上。trunkW 是樹幹底部寬（InsightLimb.width），回傳封閉路徑 */
export function rootFlarePath(cx: number, ground: number, trunkW: number): string {
  const hw = Math.max(1, trunkW) / 2
  const f = Math.max(4, trunkW * 0.5)
  const h = Math.max(4, trunkW * 0.6)
  const y0 = ground + 1.5
  return [
    `M${r1(cx - hw - f)},${r1(y0)}`,
    `C${r1(cx - hw - f * 0.35)},${r1(y0 - 0.5)} ${r1(cx - hw - 0.5)},${r1(ground - h * 0.25)} ${r1(cx - hw + 0.8)},${r1(ground - h)}`,
    `L${r1(cx + hw - 0.8)},${r1(ground - h)}`,
    `C${r1(cx + hw + 0.5)},${r1(ground - h * 0.25)} ${r1(cx + hw + f * 0.35)},${r1(y0 - 0.5)} ${r1(cx + hw + f)},${r1(y0)}`,
    'Z',
  ].join(' ')
}

/** 地平線下的土壤帶：寬度內縮 6，高度不超過畫布下緣與 maxH */
export function soilBand(width: number, ground: number, bottom: number, maxH = 16): { x: number; y: number; w: number; h: number } {
  const y = ground + 1.4
  return { x: 6, y: r1(y), w: Math.max(0, r1(width - 12)), h: Math.max(0, r1(Math.min(maxH, bottom - y))) }
}

// ─────────────────────────────────────────────
// 3.11.0：稀疏點綴層、根系底板、葉子微偏轉（純函式）
// ─────────────────────────────────────────────

/** 決定性偽亂數：0..1，同一組 (seed, i) 永遠同值 */
function hash01(seed: number, i: number): number {
  let h = (Math.imul(seed | 0, 374761393) + Math.imul(i | 0, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** 點綴密度：≤5 則全顯示、≥20 則完全不畫，中間線性下降 */
export function decorFade(total: number): number {
  if (!(total > 5)) return 1
  if (total >= 20) return 0
  return Math.round(((20 - total) / 15) * 1000) / 1000
}

export interface DecorLayout {
  hills: string[]
  grass: { x: number; d: string }[]
  motes: { x: number; y: number; r: number; delay: number }[]
}

/** 點綴幾何：地平線後方的丘陵輪廓、背景草叢、樹冠周圍的光點。草叢避開樹幹中心 ±trunkW*2；全部落在畫布內 */
export function decorLayout(width: number, ground: number, cx: number, trunkW: number, seed: number): DecorLayout {
  const x0 = 8, x1 = Math.max(x0, width - 8)
  const span = x1 - x0
  const mkHill = (k: number, hMax: number, phase: number): string => {
    const h = Math.max(2, Math.min(hMax, ground * 0.12))
    const n = 6
    const pts: [number, number][] = []
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const bump = 0.35 + 0.65 * hash01(seed + k * 31, i)
      const env = Math.sin(Math.PI * Math.min(1, Math.max(0, t * 0.9 + phase)))
      pts.push([x0 + span * t, ground - h * bump * (0.35 + 0.65 * Math.abs(env))])
    }
    let d = `M${r1(x0)},${r1(ground)} L${r1(pts[0]![0])},${r1(pts[0]![1])}`
    for (let i = 1; i < pts.length; i++) {
      const [px, py] = pts[i - 1]!, [qx, qy] = pts[i]!
      const mx = (px + qx) / 2
      d += ` C${r1(mx)},${r1(py)} ${r1(mx)},${r1(qy)} ${r1(qx)},${r1(qy)}`
    }
    return `${d} L${r1(x1)},${r1(ground)} Z`
  }
  const hills = [mkHill(1, 22, 0.05), mkHill(2, 13, 0.0)]

  const grass: DecorLayout['grass'] = []
  const avoid = Math.max(1, trunkW) * 2
  const want = Math.max(4, Math.min(16, Math.round(width / 40)))
  for (let i = 0; i < want * 2 && grass.length < want; i++) {
    const x = x0 + 4 + hash01(seed + 7, i) * Math.max(0, span - 8)
    if (Math.abs(x - cx) < avoid) continue
    const h = 4 + hash01(seed + 11, i) * 5
    const lean = (hash01(seed + 13, i) - 0.5) * 5
    const y = ground
    const d = [-2.2, 0, 2.2].map((o, b) => {
      const hh = h * (b === 1 ? 1 : 0.7)
      return `M${r1(x + o)},${r1(y)} Q${r1(x + o + lean * 0.3)},${r1(y - hh * 0.6)} ${r1(x + o * 1.6 + lean)},${r1(y - hh)}`
    }).join(' ')
    grass.push({ x: r1(x), d })
  }

  // 光點：左右決定性交替（7 顆時 4／3），整體是否鏡像由 hash 決定；同側的 dx 分區取樣，避免擠在一起
  const motes: DecorLayout['motes'] = []
  const top = Math.max(6, ground * 0.18), bot = Math.max(top + 1, ground - 16)
  const flip = hash01(seed + 17, 0) < 0.5 ? -1 : 1
  const perSide: Record<number, number> = { [-1]: flip === -1 ? 4 : 3, [1]: flip === 1 ? 4 : 3 }
  const seen: Record<number, number> = { [-1]: 0, [1]: 0 }
  for (let i = 0; i < 7; i++) {
    const side = (i % 2 === 0 ? -1 : 1) * flip
    const k = seen[side]!
    seen[side] = k + 1
    const cnt = perSide[side]!
    const lo = 0.06 + (0.3 * k) / cnt
    const hi = 0.06 + (0.3 * (k + 1)) / cnt
    const dx = (lo + hash01(seed + 19, i) * (hi - lo)) * width
    const x = Math.min(x1, Math.max(x0, cx + side * dx))
    const y = top + hash01(seed + 23, i) * (bot - top)
    motes.push({ x: r1(x), y: r1(y), r: r1(1 + hash01(seed + 29, i)), delay: r1(hash01(seed + 31, i) * 6) })
  }
  return { hills, grass, motes }
}

/** 根系底板：只包住根的範圍。nodes 是每個根節點的中心與半寬，originX 是樹根起點；左右各加 pad，夾在 [0.5, width-0.5] */
export function soilPlate(nodes: { x: number; half: number }[], originX: number, width: number, pad = 14): { x: number; w: number } {
  let lo = originX, hi = originX
  for (const n of nodes) { lo = Math.min(lo, n.x - n.half); hi = Math.max(hi, n.x + n.half) }
  const a = Math.max(0.5, lo - pad), b = Math.min(width - 0.5, hi + pad)
  return { x: r1(a), w: Math.max(0, r1(b - a)) }
}

/** 葉子微偏轉：以 id 決定的 ±6° 內角度 */
export function leafJitter(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) }
  return Math.round((((h >>> 0) / 4294967296) * 12 - 6) * 10) / 10
}
