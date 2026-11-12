// 知識頁「星空生長」樹（2.84.0）的純函式：把 BuiltTree 排成由下往上長的樹（極座標扇形展開），並提供月份序列。
// 不碰 DOM、不用 Math.random（抖動一律用 id 的雜湊），同一輸入永遠得到同一輸出。元件在 KnowledgeGrowthTree.tsx。

import type { BuiltTree, Topic } from './knowledgeView'

export type GrowthLimbLevel = 'trunk' | 'domain' | 'branch' | 'twig'

export interface GrowthLimb {
  id: string
  /** SVG path（座標已落在 [0,width]×[0,height] 內） */
  d: string
  level: GrowthLimbLevel
  /** 這段底下最早出現的題目月份；底下有題目沒有月份（視為一開始就在）或根本沒有題目時為 null */
  firstMonth: string | null
}

export interface GrowthLeaf {
  id: string
  x: number
  y: number
  r: number
  /** 在 layout.domains 裡的序號 */
  domainIndex: number
  firstMonth: string | null
}

export interface GrowthDomain {
  id: string
  name: string
  count: number
  /** 主枝末端 */
  x: number
  y: number
  /** 標籤放得下才為 true（依題數多的優先，互相不重疊） */
  labelShown: boolean
}

export interface GrowthTreeLayout {
  width: number
  height: number
  trunk: GrowthLimb
  limbs: GrowthLimb[]
  leaves: GrowthLeaf[]
  domains: GrowthDomain[]
}

export interface GrowthTreeOptions {
  /** 領域標籤字級（viewBox 單位），預設 14；元件依縮放比例換算成螢幕上 ≥12px */
  labelFontSize?: number
  /** 四周留白，預設 28 */
  pad?: number
}

/** 領域色票（同領域同色；超過數量時循環）。刻意避開六面向識別色的意義，只用於知識樹的葉子與標籤。 */
export const DOMAIN_COLORS: readonly string[] = [
  '#f59e0b', '#22d3ee', '#a78bfa', '#fb7185', '#34d399', '#60a5fa', '#f472b6', '#facc15', '#2dd4bf', '#c084fc',
]

export const UNASSIGNED_DOMAIN_ID = '__unassigned'
export const UNASSIGNED_DOMAIN_NAME = '未分類'

type P = [number, number]

/** FNV-1a → [0,1) */
function hash01(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h / 0x100000000
}

const rad = (deg: number): number => (deg * Math.PI) / 180
/** 從 p 出發，與垂直線夾 deg 度（正＝向右）、長 len 的點；y 往上為負 */
const pol = (p: P, deg: number, len: number): P => [p[0] + Math.sin(rad(deg)) * len, p[1] - Math.cos(rad(deg)) * len]
const num = (n: number): string => String(Math.round(n * 10) / 10)

function minMonth(a: string | null, b: string | null): string | null {
  if (a === null || b === null) return null
  return a < b ? a : b
}

/** 把 total 依權重分給各項，每項至少 floorEach；超過下限的項目按比例分剩下的 */
function allocate(total: number, weights: readonly number[], floorEach: number): number[] {
  const n = weights.length
  if (n === 0) return []
  const fl = Math.min(floorEach, total / n)
  const fixed = new Array<boolean>(n).fill(false)
  for (let iter = 0; iter <= n; iter++) {
    let fixedCount = 0
    let wsum = 0
    for (let i = 0; i < n; i++) {
      if (fixed[i]) fixedCount++
      else wsum += weights[i]!
    }
    if (wsum <= 0) break
    const remaining = total - fl * fixedCount
    let changed = false
    for (let i = 0; i < n; i++) {
      if (!fixed[i] && (remaining * weights[i]!) / wsum < fl) {
        fixed[i] = true
        changed = true
      }
    }
    if (!changed) break
  }
  let fixedCount = 0
  let wsum = 0
  for (let i = 0; i < n; i++) {
    if (fixed[i]) fixedCount++
    else wsum += weights[i]!
  }
  const remaining = total - fl * fixedCount
  return weights.map((w, i) => (fixed[i] ? fl : wsum > 0 ? (remaining * w) / wsum : fl))
}

/** 葉子半徑：依文件數遞增，有上下限 */
export function leafRadius(docs: number): number {
  const d = Number.isFinite(docs) && docs > 0 ? docs : 0
  return 5 + Math.min(8, Math.sqrt(d) * 1.4)
}

interface LeafPt { id: string; x: number; y: number; r: number; domainIndex: number; firstMonth: string | null; bx: number; by: number; branchId: string }
interface BranchModel { id: string; from: P; to: P; bend: number; leafIdx: number[]; firstMonth: string | null }
interface DomainModel { id: string; name: string; count: number; to: P; bend: number; branches: BranchModel[]; firstMonth: string | null }

/** 排版。座標系：樹幹頂端為原點、y 往上為負，最後平移到 [0,width]×[0,height]。 */
export function layoutGrowthTree(built: BuiltTree, opts: GrowthTreeOptions = {}): GrowthTreeLayout {
  const fs = opts.labelFontSize ?? 14
  const pad = opts.pad ?? 28
  const TRUNK_LEN = 96

  // 領域清單：空領域、空枝略過；未分類視為最後一個領域
  interface SrcBranch { id: string; topics: Topic[] }
  interface SrcDomain { id: string; name: string; branches: SrcBranch[]; count: number }
  const srcDomains: SrcDomain[] = []
  for (const d of built.domains) {
    const branches = d.branches.filter((b) => b.topics.length > 0).map((b) => ({ id: b.id, topics: b.topics }))
    const count = branches.reduce((n, b) => n + b.topics.length, 0)
    if (count > 0) srcDomains.push({ id: d.id, name: d.name, branches, count })
  }
  if (built.unassigned.length > 0) {
    srcDomains.push({
      id: UNASSIGNED_DOMAIN_ID,
      name: UNASSIGNED_DOMAIN_NAME,
      branches: [{ id: `${UNASSIGNED_DOMAIN_ID}:branch`, topics: built.unassigned }],
      count: built.unassigned.length,
    })
  }

  const origin: P = [0, 0]
  const leafPts: LeafPt[] = []
  const domains: DomainModel[] = []
  const nd = srcDomains.length

  if (nd > 0) {
    const S = Math.min(170, 50 + 24 * (nd - 1))
    const domW = allocate(S, srcDomains.map((d) => d.count), Math.min(18, (S / nd) * 0.6))
    let cursor = -S / 2
    srcDomains.forEach((d, di) => {
      const sector = domW[di]!
      const center = cursor + sector / 2
      cursor += sector
      const Ld = 110 + 12 * Math.sqrt(d.count)
      const dEnd = pol(origin, center, Ld)
      const dm: DomainModel = {
        id: d.id, name: d.name, count: d.count, to: dEnd,
        bend: (hash01(`bend:${d.id}`) - 0.5) * 0.3 * Ld, branches: [], firstMonth: undefined as unknown as null,
      }
      const nb = d.branches.length
      const spread = Math.max(sector, Math.min(120, 30 * nb))
      const bW = allocate(spread, d.branches.map((b) => b.topics.length), Math.min(14, (spread / nb) * 0.6))
      let bc = center - spread / 2
      d.branches.forEach((b, bi) => {
        const bdir = bc + bW[bi]! / 2
        bc += bW[bi]!
        const m = b.topics.length
        const Lb = 55 + 8 * Math.sqrt(m)
        const bEnd = pol(dEnd, bdir, Lb)
        const radii = b.topics.map((t) => leafRadius(t.docs))
        const rmax = Math.max(...radii)
        const c = 2.4 * rmax
        const phase = hash01(`phase:${b.id}`) * Math.PI * 2
        const ctr = pol(bEnd, bdir, 0.5 * c * Math.sqrt(m))
        const idx: number[] = []
        b.topics.forEach((t, k) => {
          const rr = c * Math.sqrt(k + 0.5)
          const ang = phase + k * 2.399963229728653
          idx.push(leafPts.length)
          leafPts.push({
            id: t.id, x: ctr[0] + Math.cos(ang) * rr, y: ctr[1] + Math.sin(ang) * rr, r: radii[k]!,
            domainIndex: di, firstMonth: t.firstMonth, bx: bEnd[0], by: bEnd[1], branchId: b.id,
          })
        })
        dm.branches.push({
          id: b.id, from: dEnd, to: bEnd, bend: (bi % 2 ? -1 : 1) * 0.12 * Lb, leafIdx: idx, firstMonth: undefined as unknown as null,
        })
      })
      domains.push(dm)
    })
  }

  // 排擠：把過近的葉子推開（留 0.9 的餘裕），再用整體放大保證 ≥ 0.8 倍半徑和
  const n = leafPts.length
  if (n > 1) {
    const order = leafPts.map((_, i) => i)
    for (let iter = 0; iter < 80; iter++) {
      order.sort((a, b) => leafPts[a]!.x - leafPts[b]!.x || a - b)
      let moved = false
      for (let ii = 0; ii < n; ii++) {
        const a = leafPts[order[ii]!]!
        for (let jj = ii + 1; jj < n; jj++) {
          const b = leafPts[order[jj]!]!
          const m = 0.9 * (a.r + b.r)
          if (b.x - a.x >= m) {
            if (b.x - a.x >= 0.9 * 2 * 13) break
            continue
          }
          let dx = b.x - a.x
          let dy = b.y - a.y
          let dist = Math.hypot(dx, dy)
          if (dist >= m) continue
          if (dist < 1e-6) {
            const ang = hash01(`${a.id}|${b.id}`) * Math.PI * 2
            dx = Math.cos(ang)
            dy = Math.sin(ang)
            dist = 1
          }
          const push = (m - dist) / 2 + 0.01
          const ux = dx / dist
          const uy = dy / dist
          a.x -= ux * push; a.y -= uy * push
          b.x += ux * push; b.y += uy * push
          moved = true
        }
      }
      if (!moved) break
    }
    let s = 1
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = leafPts[i]!
        const b = leafPts[j]!
        const need = 0.8 * (a.r + b.r)
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        if (dist < need && dist > 1e-9) s = Math.max(s, need / dist)
      }
    }
    if (s > 1) {
      s *= 1.001
      for (const l of leafPts) { l.x *= s; l.y *= s; l.bx *= s; l.by *= s }
      for (const d of domains) {
        d.to = [d.to[0] * s, d.to[1] * s]
        d.bend *= s
        for (const b of d.branches) { b.from = [b.from[0] * s, b.from[1] * s]; b.to = [b.to[0] * s, b.to[1] * s]; b.bend *= s }
      }
    }
  }

  // firstMonth 往上傳：底下有題目沒有月份，這段就一開始存在（null）
  const leafMonth = (i: number): string | null => leafPts[i]!.firstMonth
  for (const d of domains) {
    let dm: string | null | undefined
    for (const b of d.branches) {
      let bm: string | null | undefined
      for (const i of b.leafIdx) {
        const m = leafMonth(i)
        bm = bm === undefined ? m : minMonth(bm, m)
      }
      b.firstMonth = bm ?? null
      dm = dm === undefined ? b.firstMonth : minMonth(dm, b.firstMonth)
    }
    d.firstMonth = dm ?? null
  }
  let treeMonth: string | null | undefined
  for (const d of domains) treeMonth = treeMonth === undefined ? d.firstMonth : minMonth(treeMonth, d.firstMonth)

  // 領域標籤：題數多的先放，與已放的重疊就不放
  const labelText = (name: string): string => (name.length > 8 ? `${name.slice(0, 7)}…` : name)
  const labelW = (name: string): number => [...labelText(name)].reduce((w, ch) => w + (/[\u0000-ÿ]/.test(ch) ? fs * 0.6 : fs), 0) + 8
  interface Rect { x0: number; y0: number; x1: number; y1: number }
  const rectOf = (d: DomainModel): Rect => {
    const w = labelW(d.name)
    return { x0: d.to[0] - w / 2, x1: d.to[0] + w / 2, y0: d.to[1] - fs - 8, y1: d.to[1] - 4 }
  }
  const shown = new Set<string>()
  const placed: Rect[] = []
  for (const d of [...domains].sort((a, b) => b.count - a.count)) {
    const r = rectOf(d)
    if (!placed.some((o) => r.x0 < o.x1 + 4 && r.x1 > o.x0 - 4 && r.y0 < o.y1 + 2 && r.y1 > o.y0 - 2)) {
      placed.push(r)
      shown.add(d.id)
    }
  }

  // 邊界（含曲線控制點與標籤）→ 平移
  let minX = 0, maxX = 0, minY = 0, maxY = TRUNK_LEN
  const grow = (x: number, y: number): void => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const ctrl = (a: P, b: P, bend: number): P => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    return [(a[0] + b[0]) / 2 - (dy / len) * bend, (a[1] + b[1]) / 2 + (dx / len) * bend]
  }
  for (const l of leafPts) { grow(l.x - l.r, l.y - l.r); grow(l.x + l.r, l.y + l.r); grow(l.bx, l.by) }
  for (const d of domains) {
    grow(d.to[0], d.to[1])
    const c = ctrl(origin, d.to, d.bend)
    grow(c[0], c[1])
    if (shown.has(d.id)) { const r = rectOf(d); grow(r.x0, r.y0); grow(r.x1, r.y1) }
    for (const b of d.branches) { grow(b.to[0], b.to[1]); const cb = ctrl(b.from, b.to, b.bend); grow(cb[0], cb[1]) }
  }
  const half = Math.max(Math.abs(minX), Math.abs(maxX)) + pad
  const width = Math.max(560, Math.ceil(half * 2))
  const height = Math.ceil(maxY - minY + pad * 2)
  const ox = width / 2
  const oy = pad - minY
  const T = (p: P): P => [p[0] + ox, p[1] + oy]
  const curveD = (a: P, b: P, bend: number): string => {
    const A = T(a), B = T(b), C = T(ctrl(a, b, bend))
    return `M${num(A[0])},${num(A[1])} Q${num(C[0])},${num(C[1])} ${num(B[0])},${num(B[1])}`
  }

  const trunk: GrowthLimb = { id: 'trunk', d: curveD([0, TRUNK_LEN], origin, 6), level: 'trunk', firstMonth: treeMonth ?? null }
  const limbs: GrowthLimb[] = []
  const leaves: GrowthLeaf[] = []
  domains.forEach((d, di) => {
    limbs.push({ id: `d:${d.id}`, d: curveD(origin, d.to, d.bend), level: 'domain', firstMonth: d.firstMonth })
    for (const b of d.branches) {
      limbs.push({ id: `b:${b.id}`, d: curveD(b.from, b.to, b.bend), level: 'branch', firstMonth: b.firstMonth })
      for (const i of b.leafIdx) {
        const l = leafPts[i]!
        const tw = (hash01(`tw:${l.id}`) - 0.5) * 10
        limbs.push({ id: `t:${l.id}`, d: curveD(b.to, [l.x, l.y], tw), level: 'twig', firstMonth: l.firstMonth })
        const p = T([l.x, l.y])
        leaves.push({ id: l.id, x: Math.round(p[0] * 10) / 10, y: Math.round(p[1] * 10) / 10, r: l.r, domainIndex: di, firstMonth: l.firstMonth })
      }
    }
  })
  const domainOut: GrowthDomain[] = domains.map((d) => {
    const p = T(d.to)
    return { id: d.id, name: d.name, count: d.count, x: Math.round(p[0] * 10) / 10, y: Math.round(p[1] * 10) / 10, labelShown: shown.has(d.id) }
  })
  return { width, height, trunk, limbs, leaves, domains: domainOut }
}

/* ───────── 月份 ───────── */

const MONTH_RE = /^\d{4}-\d{2}$/

/** 現在是哪一個月（Asia/Taipei），YYYY-MM */
export function monthOfDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' }).format(now).slice(0, 7)
}

/**
 * 從最早的 firstMonth 到 now 當月、連續不缺月的 YYYY-MM 陣列。沒有任何題目時只有當月。
 * 若有題目的 firstMonth 晚於 now 當月（時鐘不準），終點延伸到最晚那個月，免得題目永遠看不到。
 */
export function monthsOf(topics: ReadonlyArray<Pick<Topic, 'firstMonth'>>, now: Date): string[] {
  const cur = monthOfDate(now)
  let first = cur
  let last = cur
  for (const t of topics) {
    const m = t.firstMonth
    if (!m || !MONTH_RE.test(m)) continue
    if (m < first) first = m
    if (m > last) last = m
  }
  const out: string[] = []
  let y = Number(first.slice(0, 4))
  let mo = Number(first.slice(5, 7))
  const endY = Number(last.slice(0, 4))
  const endM = Number(last.slice(5, 7))
  while (y < endY || (y === endY && mo <= endM)) {
    out.push(`${y}-${String(mo).padStart(2, '0')}`)
    mo++
    if (mo > 12) { mo = 1; y++ }
  }
  return out
}

/** firstMonth 為 null 視為一開始就在 */
export function visibleAt(firstMonth: string | null, month: string): boolean {
  return firstMonth === null || firstMonth <= month
}
