// ─────────────────────────────────────────────
// 事人物關係宇宙 — 獨立全頁 3D 關係圖
//
// 2026-09-16 第二版。第一版用手刻的 3D 力導向模擬，在正式資料規模（58 人
// 物／364 事件／12 案件／54 物件）下完全不堪用，三個結構性問題：
//   1. 斥力是 charge/dist²、最近距離只夾到 1，密集區一重疊就生出巨大推
//      力把節點甩出去；alpha 要十幾秒才冷卻，期間整張圖都在亂竄，切一次
//      核心就重新亂竄一次。
//   2. 深度淡出把整個球體的深度線性映到 0.05~1，結果球心附近的節點只有
//      三成不透明度——幾百顆半透明圓疊在一起就糊成一片霧。
//   3. 非核心的人物用 amberDim（偏橘的暗色），切到別的核心時人物看起來
//      還是「黃的」，等於看不出核心到底換了誰。
//
// 這版改成「確定性佈局 + 位置補間」，完全拿掉力學迭代：資料或核心類型變
// 動時直接算出每個節點的目標座標——核心類型的節點用黃金角（Fibonacci
// sphere）均分在內層球面上，其餘節點掛到自己主要核心鄰居的方向上、在那
// 個方向的球冠內散開成花瓣狀衛星群，完全沒有核心鄰居的則落到最外層球
// 殼。每幀只做「往目標座標補間 → 投影 → 畫」，所以畫面永遠不會抖、不會
// 亂竄，幾百個節點也穩；切換核心時看到的是一次乾淨的重新排列動畫，而不
// 是一團持續蠕動的東西。
//
// 2026-10-03 第三版（星系）：確定性仍保留，但「平均撒在球面上」＝沒有結構，正式資料
// （152 人／1016 事件）看起來是一顆均勻毛球。改成星系佈局（見 galaxyLayout.ts）：核心
// 依共同衛星分群成星系、事件繞著恆星公轉、星系緩慢自轉、群與群之間留白；分不出結構
// （例如事件為核心）時退回上面的球面佈局。每個節點的目標位置是時間的函式，畫面端用阻尼
// 彈簧追目標（有慣性、會小幅回彈，但永遠收斂）；選取節點時宇宙時間漸停，拖曳鬆手有慣性。
// ─────────────────────────────────────────────
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { COLOR, FONT } from './theme'
import {
  apiFetchHermesGraph, type HermesGraphData, type HermesGraphAbstractionNode,
  type HermesGraphConceptEdge, type HermesGraphMethodEdge,
} from './hermesGraphApi'
import {
  buildIndex, searchNodes, shortestPath, splitId, recentActivity,
  personId, caseId, objectId, conceptId, methodId, type RecentActivity, type RecentActivityItem,
  type NodeKind,
} from './graphInsights'
import { RelationshipDetailPanel, type Selection } from './RelationshipDetailPanel'
import { GraphShell } from './GraphShell'
import { coreHeatColor, makeHeatScale, outerHeatColor, CORE_RAMP } from './graphHeat'
import { consumeGraphFocus } from './graphFocus'
import { EDGE_LEVELS, NEAR_SCALE_CAP, edgeLevel, hubDamp, idleEdgeAlpha, nearFade } from './universeStyle'
import { GOLDEN_ANGLE, fibDir, galaxyLayout, hash01, orthoBasis, positionAt, type GalaxyLayout, type Vec3 } from './galaxyLayout'

// 六種節點都能當核心：人/事/物是最早提的三個，案件（脈絡層）同樣是圖上獨
// 立的一種節點；概念／方法是 2026-10 加的抽象層（見 isAbstraction）。
type CoreKind = NodeKind

/** 概念／方法是「抽象層」：從具體事件萃取出來的想法與做法，不是具體的人事物。
 *  畫法刻意跟具體節點分開——半透明薄框、放在最外圈（見 computeLayout），讓使用者
 *  一眼分得出「這是被重複驗證的抽象」還是「具體發生過的東西」。 */
const isAbstraction = (k: NodeKind): k is 'concept' | 'method' => k === 'concept' || k === 'method'

interface UNode {
  id: string
  kind: NodeKind
  label: string
  baseRadius: number
  eventCount: number
  /** 抽象層節點才有意義：只出現在 1 個事件（尚未晉升）。畫得更淡、框用虛線。 */
  candidate: boolean
  /** 熱度 0~1（同類節點內的相對關聯數）與兩套預先算好的顏色：當核心時用 colorCore（琥珀→深橘），
   *  不是核心時用 colorOuter（灰藍→更深的同色相）。大小不再代表關聯數，見 graphHeat.ts。 */
  heat: number; colorCore: string; colorOuter: string
  // 目前座標往目標座標補間；目標座標由 computeLayout 一次算好，不是每幀
  // 被力學推著跑。
  x: number; y: number; z: number
  // 彈簧速度：位置用阻尼彈簧追目標（有一點慣性與回彈，但永遠收斂），見 SPRING_K／SPRING_DAMP
  vx: number; vy: number; vz: number
  tx: number; ty: number; tz: number
  // 投影後的螢幕座標／視覺屬性，每幀重算；畫圖跟點擊命中測試都讀這裡。
  sx: number; sy: number; screenRadius: number; opacity: number; depth: number
}

interface ULink { key: string; aId: string; bId: string }

const FOCAL_LENGTH = 620
// 縮放範圍不寫死絕對值，改成相對於當前宇宙半徑（見 worldRadiusRef）——宇宙
// 會隨節點數長大，寫死的上下限在資料量變大後就會變成「拉不遠／推不近」。
const ZOOM_MIN_FACTOR = 0.25
const ZOOM_MAX_FACTOR = 8
const IDLE_ROTATE_SPEED = 0.0007
// 位置用阻尼彈簧追目標：v = (v + K·(目標−位置))·D。K 小、D 接近 1 → 有慣性、會稍微衝過頭再回來（物理感），
// 但 D<1 保證能量一直衰減，不會像第一版力學模擬那樣亂竄。
const SPRING_K = 0.07
const SPRING_DAMP = 0.8
// 拖曳鬆手後視角的慣性：每幀保留的比例（越接近 1 滑得越久）
const YAW_FRICTION = 0.95
const PITCH_FRICTION = 0.9
// 選取節點時，宇宙的時間（公轉、自轉）在約一秒內慢慢停下，看細節時畫面是靜止的
const TIME_EASE = 0.05
// 背景節點（見 GalaxyLayout.faint）的大小與不透明度倍率
const FAINT_SIZE = 0.55
const FAINT_OPACITY = 0.3
// 不是目前核心的人／案／物（圓內不標數字）畫小一點：它們繞在核心旁邊，太大會比中心的核心還搶眼
const NONCORE_INDEX_SIZE = 0.6
const PIVOT_EASE = 0.12
// 衛星散開的球冠半角。不能是固定值：一個核心節點可能掛 2 個衛星，也可能
// 掛 100 個，固定角度在後者會擠成一坨。球冠面積大致 ∝ θ²，所以 θ ∝ √m，
// 再夾在一個看得出分群、又不會糊掉的範圍內。
const satelliteCapFor = (m: number) => Math.max(0.3, Math.min(1.05, 0.16 * Math.sqrt(m)))
// 最遠端節點的不透明度下限。第一版是 0.05（幾乎透明），整張圖因此灰濛濛；
// 0.32 仍然看得出前後深度，但不會讓任何節點糊掉。
const DEPTH_MIN_OPACITY = 0.32
const edgeSegs: number[][] = Array.from({ length: EDGE_LEVELS + 1 }, () => [])
// 星雲光的離屏貼圖（每個色相一張，op=1 的徑向漸層）：每幀對每個星系 createRadialGradient 太貴
// （案件／物件為核心有 30 個星系，實測佔幀時間約 8～10 ms），改成畫一次、之後 drawImage 縮放＋globalAlpha。
const NEBULA_SPRITE_SIZE = 128
const nebulaSprites = new Map<number, HTMLCanvasElement | null>()
function nebulaSprite(hue: number): HTMLCanvasElement | null {
  if (nebulaSprites.has(hue)) return nebulaSprites.get(hue) ?? null
  let c: HTMLCanvasElement | null = null
  if (typeof document !== 'undefined') {
    c = document.createElement('canvas')
    c.width = c.height = NEBULA_SPRITE_SIZE
    const g = c.getContext('2d')
    if (g) {
      const h = NEBULA_SPRITE_SIZE / 2
      const grad = g.createRadialGradient(h, h, 0, h, h, h)
      grad.addColorStop(0, `hsla(${hue},70%,62%,0.24)`)
      grad.addColorStop(0.45, `hsla(${hue},65%,50%,0.1)`)
      grad.addColorStop(1, `hsla(${hue},60%,40%,0)`)
      g.fillStyle = grad
      g.fillRect(0, 0, NEBULA_SPRITE_SIZE, NEBULA_SPRITE_SIZE)
    } else c = null
  }
  nebulaSprites.set(hue, c)
  return c
}
const STAR_COUNT = 260
// 背景星點：由索引算出的固定位置（不用 Math.random，重繪不閃），螢幕空間、不隨節點縮放；轉動時只做很小的視差位移。
const STARS: ReadonlyArray<{ x: number; y: number; r: number; a: number; p: number }> = Array.from({ length: STAR_COUNT }, (_, i) => ({
  x: hash01(`sx${i}`), y: hash01(`sy${i}`), r: 0.4 + hash01(`sr${i}`) * 1.1, a: 0.12 + hash01(`sa${i}`) * 0.38, p: 0.2 + hash01(`sp${i}`) * 0.8,
}))
/** 背景（星雲＋星點）的離屏快取：尺寸變了才重畫。回傳 null 表示環境不支援離屏畫布（測試／極舊瀏覽器），呼叫端直接略過背景。 */
function ensureBackdrop(ref: { current: HTMLCanvasElement | null }, width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  let c = ref.current
  if (!c) { c = document.createElement('canvas'); ref.current = c }
  if (c.width === Math.floor(width) && c.height === Math.floor(height) && c.dataset.ready === '1') return c
  c.width = Math.max(1, Math.floor(width)); c.height = Math.max(1, Math.floor(height))
  const g = c.getContext('2d')
  if (!g) return null
  const minDim = Math.min(c.width, c.height)
  const neb = g.createRadialGradient(c.width / 2, c.height / 2, 0, c.width / 2, c.height / 2, minDim * 0.62)
  neb.addColorStop(0, 'rgba(70,84,160,0.16)')
  neb.addColorStop(0.55, 'rgba(50,56,120,0.06)')
  neb.addColorStop(1, 'rgba(20,24,60,0)')
  g.fillStyle = neb
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#cdd8f0'
  for (const st of STARS) {
    g.globalAlpha = st.a
    g.fillRect(st.x * c.width, st.y * c.height, st.r, st.r)
  }
  c.dataset.ready = '1'
  return c
}
// 「最近新增」面板的上次造訪時間戳，見下方 effect 的說明。
const LAST_VISIT_STORAGE_KEY = 'relationshipUniverse.lastVisitAt'

// 核心那一類一律 amber，其餘三類一律中性灰——刻意都不帶橘黃，否則「amber
// ＝目前的核心」這個唯一的顏色語意就被破壞（第一版非核心人物用 amberDim
// 就是這個問題）。三個灰階彼此的明度差夠大，四類同時在畫面上也分得出來。
const NON_CORE_COLOR: Record<NodeKind, string> = {
  person: '#aab4c4',
  event: '#5d6472',
  case: '#8f8f88',
  object: '#74839a',
  // 抽象層刻意帶一點色相（藍／綠）而不是灰階：它們用薄框＋半透明另外表示，而且
  // 都不是橘黃，所以「amber ＝目前的核心」的語意不受影響。
  concept: '#7fa6dc',
  method: '#86c4a0',
}

function nodeColor(kind: NodeKind, coreKind: CoreKind): string {
  return kind === coreKind ? COLOR.amber : NON_CORE_COLOR[kind]
}

// 節點大小只依類型、不再依關聯數（關聯數改用顏色深淺表示，並直接以數字標在索引節點上）。
// 索引節點（人／案／物／概念／方法）要夠大才放得下數字。
function baseRadiusFor(kind: NodeKind): number {
  if (kind === 'event') return 2.8
  if (kind === 'object') return 7.5
  if (kind === 'case') return 8.5
  return 9 // person、concept、method
}




/** 算出每個節點的目標座標。核心類型在內層球面、其衛星在外一層的球冠
 *  裡、沒有核心鄰居的在最外層球殼。回傳最外層半徑給深度淡出當基準。 */
function computeLayout(allNodes: UNode[], neighbors: Map<string, Set<string>>, coreKind: CoreKind): number {
  // 非核心的概念／方法不跟具體節點混排：先只排其餘節點，抽象層最後獨立放到
  // 更外面一層（見函式尾端）。核心是概念／方法時，它們就是核心球面，照一般流程。
  const outerAbstractions = allNodes.filter(n => isAbstraction(n.kind) && n.kind !== coreKind)
  const nodes = outerAbstractions.length > 0 ? allNodes.filter(n => !(isAbstraction(n.kind) && n.kind !== coreKind)) : allNodes
  const coreNodes = nodes.filter(n => n.kind === coreKind)
  const coreIds = new Set(coreNodes.map(n => n.id))
  // 半徑全部隨節點數成長，而且刻意不封頂：球面能容納的節點數 ∝ R²，所以
  // R ∝ √n 才會讓節點密度維持恆定。之前 coreR 封頂在 265、外兩層又是固定
  // 偏移（+180/+130），核心節點超過約 194 個之後就只會越擠越密——上千個
  // 節點時整張圖必然糊掉。外兩層改成比例而非固定值，宇宙才會整體等比放
  // 大；鏡頭會在重算佈局後自動拉到剛好框住（見 fitCameraTo）。
  // 2026-10-03：核心球原本只佔整個宇宙半徑的約 1/3，正式資料（152 人）的核心人物擠在畫面中央一小團，外面一大圈
  // 卻是稀疏的衛星。核心球放大、外層收近，讓人物之間有呼吸的空間（鏡頭會自動重新框住，整體不會變大變小）。
  const coreR = Math.max(140, 90 + Math.sqrt(coreNodes.length) * 21)
  const shellR = coreR * 1.55 + 50
  const outerR = shellR * 1.3

  const dirOf = new Map<string, [number, number, number]>()
  coreNodes.forEach((n, i) => {
    const u = fibDir(i, coreNodes.length)
    dirOf.set(n.id, u)
    n.tx = u[0] * coreR; n.ty = u[1] * coreR; n.tz = u[2] * coreR
  })

  const satellitesOf = new Map<string, UNode[]>()
  const orphans: UNode[] = []
  for (const n of nodes) {
    if (coreIds.has(n.id)) continue
    let anchor: string | null = null
    const nb = neighbors.get(n.id)
    if (nb) {
      for (const id of nb) {
        if (coreIds.has(id)) { anchor = id; break }
      }
    }
    if (anchor) {
      const arr = satellitesOf.get(anchor)
      if (arr) arr.push(n)
      else satellitesOf.set(anchor, [n])
    } else {
      orphans.push(n)
    }
  }

  for (const [anchorId, sats] of satellitesOf) {
    const u = dirOf.get(anchorId)
    if (!u) continue
    const [ax, ay, az, bx, by, bz] = orthoBasis(u[0], u[1], u[2])
    sats.sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0))
    const m = sats.length
    const cap = satelliteCapFor(m)
    sats.forEach((s, k) => {
      // sqrt 讓衛星在球冠裡是等面積分佈（均勻鋪滿），不是全擠在中心軸旁
      const spread = cap * Math.sqrt((k + 0.5) / m)
      const theta = k * GOLDEN_ANGLE
      const cs = Math.cos(spread), sn = Math.sin(spread)
      const ct = Math.cos(theta), st = Math.sin(theta)
      const dx = u[0] * cs + (ax * ct + bx * st) * sn
      const dy = u[1] * cs + (ay * ct + by * st) * sn
      const dz = u[2] * cs + (az * ct + bz * st) * sn
      const r = shellR * (0.86 + hash01(s.id) * 0.28)
      s.tx = dx * r; s.ty = dy * r; s.tz = dz * r
    })
  }

  orphans.sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0))
  orphans.forEach((n, i) => {
    const u = fibDir(i, orphans.length)
    const r = outerR * (0.94 + hash01(n.id) * 0.12)
    n.tx = u[0] * r; n.ty = u[1] * r; n.tz = u[2] * r
  })

  if (outerAbstractions.length === 0) return outerR * 1.1

  // 抽象層：方向取「它關聯的事件」目前目標座標的重心（相關的抽象就落在相關事件那
  // 一側，連線不會橫貫整個宇宙），再加一點由 id 穩定決定的抖動避免同重心的疊在一
  // 起；沒有任何已定位鄰居的就用黃金角均分。半徑在 outerR 之外，概念比方法更外一
  // 點，兩種彼此也不混在同一層。
  const abstractR = outerR * 1.28
  const pos = new Map(nodes.map(n => [n.id, n]))
  outerAbstractions.sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0))
  outerAbstractions.forEach((n, i) => {
    let cx = 0, cy = 0, cz = 0, cnt = 0
    for (const id of neighbors.get(n.id) ?? []) {
      const nb = pos.get(id)
      if (!nb) continue
      const len = Math.hypot(nb.tx, nb.ty, nb.tz) || 1
      cx += nb.tx / len; cy += nb.ty / len; cz += nb.tz / len; cnt++
    }
    let dx: number, dy: number, dz: number
    if (cnt > 0 && Math.hypot(cx, cy, cz) > 1e-6) {
      const jitter = 0.35
      dx = cx / cnt + (hash01(`${n.id}x`) - 0.5) * jitter
      dy = cy / cnt + (hash01(`${n.id}y`) - 0.5) * jitter
      dz = cz / cnt + (hash01(`${n.id}z`) - 0.5) * jitter
    } else {
      [dx, dy, dz] = fibDir(i, outerAbstractions.length)
    }
    const dl = Math.hypot(dx, dy, dz) || 1
    const r = abstractR * (n.kind === 'concept' ? 1.08 : 0.98) * (0.97 + hash01(n.id) * 0.06)
    n.tx = (dx / dl) * r; n.ty = (dy / dl) * r; n.tz = (dz / dl) * r
  })
  return abstractR * 1.18
}

/** 佈局入口：能分出星系就用星系佈局（回傳 layout 給每幀算位置），否則退回球面佈局（目標座標一次寫好）。
 *
 *  宇宙的骨架一律先用「人」分群（STRUCTURE_KIND），不管目前選哪一類當核心：事件、案件、概念、方法單靠自己
 *  幾乎分不出群（概念只有個位數、一個事件通常只屬於一個案件、事件之間沒有共同衛星），以前各自分群的結果是
 *  只有人／物為核心時才有星系，其他全退回舊的球面（使用者 10-03 回報）。改成同一個骨架後，切換核心只改
 *  「哪一類被打亮、放大、標名字」，整個宇宙不會重排，同一個人、同一件事永遠在同一個位置。
 *  人分不出群時才改用目前核心類型自己分群，再不行才退回球面。 */
const STRUCTURE_KIND: CoreKind = 'person'
// 案件／物件／概念／方法為核心時（2026-10-03 使用者要求）：每個核心各自是一個星系的中心，它的事件繞內圈、
// 那些事件的人物與物件繞外圈——「以這個案件／概念為核心看相關的人事物」。這幾類不用人的骨架（否則它們只是
// 掛在某個人旁邊的小衛星）。衛星不夠成星系時才退回人的骨架。
// 概念／方法目前只有個位數（候選預設隱藏），單一個也自成星系；案件／物件數量多，至少兩個星系才算有結構。
// 事件不在這裡：上千個事件各自只帶幾顆衛星（它的人、案件、物件），做成 hub 只能挑幾十個當星系、其餘全變背景，
// 反而看不到事件；事件為核心沿用人的骨架（事件繞著人轉、被打亮放大），每個事件都看得到。
const HUB_MIN_GALAXIES: ReadonlyMap<CoreKind, number> = new Map<CoreKind, number>([
  ['case', 2], ['object', 2], ['concept', 1], ['method', 1],
])
function layoutFor(nodes: UNode[], neighbors: Map<string, Set<string>>, coreKind: CoreKind): { layout: GalaxyLayout | null; worldR: number } {
  const hubMin = HUB_MIN_GALAXIES.get(coreKind)
  const layout = (hubMin !== undefined ? galaxyLayout(nodes, neighbors, coreKind, { mode: 'hub', minGalaxies: hubMin }) : null)
    ?? galaxyLayout(nodes, neighbors, STRUCTURE_KIND)
    ?? (coreKind !== STRUCTURE_KIND ? galaxyLayout(nodes, neighbors, coreKind) : null)
  if (layout) {
    applyMotionTargets(nodes, layout, 0)
    return { layout, worldR: layout.worldRadius }
  }
  return { layout: null, worldR: computeLayout(nodes, neighbors, coreKind) }
}

const tmpPos: Vec3 = [0, 0, 0]
/** 把星系佈局在時間 t 的位置寫進每個節點的目標座標。先寫非軌道節點（恆星），再寫軌道節點（讀錨點剛寫好的目標）。 */
function applyMotionTargets(nodes: UNode[], layout: GalaxyLayout, t: number) {
  const anchors = new Map<string, Vec3>()
  for (const n of nodes) {
    const m = layout.motions.get(n.id)
    if (!m || m.type === 'orbit') continue
    positionAt(m, t, layout.galaxies, () => undefined, tmpPos)
    n.tx = tmpPos[0]; n.ty = tmpPos[1]; n.tz = tmpPos[2]
    anchors.set(n.id, [n.tx, n.ty, n.tz])
  }
  const anchorPos = (id: string) => anchors.get(id)
  for (const n of nodes) {
    const m = layout.motions.get(n.id)
    if (!m || m.type !== 'orbit') continue
    positionAt(m, t, layout.galaxies, anchorPos, tmpPos)
    n.tx = tmpPos[0]; n.ty = tmpPos[1]; n.tz = tmpPos[2]
  }
}

export function RelationshipUniverse({ unlockedPassword, onBack }: { unlockedPassword: string | null; onBack: () => void }) {
  const [data, setData] = useState<HermesGraphData | null>(null)
  const [error, setError] = useState(false)
  const [coreKind, setCoreKind] = useState<CoreKind>('person')
  const [showIsolatedEvents, setShowIsolatedEvents] = useState(false)
  // 抽象層（概念／方法）預設開、但只顯示已晉升的（≥2 事件）；候選（僅 1 事件）
  // 預設關，要自己勾選才看——候選是單次語意判斷的產物，一次全部畫出來會把圖面灌滿
  // 雜訊，也會掩蓋「已經被重複驗證的」那批。
  const [showAbstractions, setShowAbstractions] = useState(true)
  const [showCandidates, setShowCandidates] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  // 走過的節點鏈：讓「一直串聯下去」可以回頭，不會走幾步就迷路
  const [trail, setTrail] = useState<Selection[]>([])
  const [pathAnchor, setPathAnchor] = useState<string | null>(null)
  // 「最近新增」面板的 cutoff 日期跟關閉狀態，見下方 effect 的說明。
  const [activitySince, setActivitySince] = useState<string | null>(null)
  // 同一個 cutoff 的毫秒版：新人物用「人物頁首次進入 vault 的時間」比，不能只比到日
  const [activitySinceMs, setActivitySinceMs] = useState<number | null>(null)
  const [activityDismissed, setActivityDismissed] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bgRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const nodesRef = useRef<UNode[]>([])
  const linksRef = useRef<ULink[]>([])
  const nodeByIdRef = useRef<Map<string, UNode>>(new Map())
  const neighborsRef = useRef<Map<string, Set<string>>>(new Map())
  const worldRadiusRef = useRef(500)
  // 點到的節點「慢慢置中」：每幀把旋轉軸心從世界原點換成 pivot，pivot 又
  // 緩緩逼近選取節點的座標。pivot 追上之後，該節點座標減掉 pivot 恆為
  // (0,0,0)，投影必然精確落在畫面正中央。
  const pivotRef = useRef({ x: 0, y: 0, z: 0 })
  const coreKindRef = useRef<CoreKind>('person')
  const hoveredIdRef = useRef<string | null>(null)
  const selectionRef = useRef<Selection | null>(null)
  // 路徑上的節點集合，給 draw() 每幀讀（畫布迴圈只掛一次，一律走 ref）
  const pathSetRef = useRef<Set<string> | null>(null)
  const yawRef = useRef(0.6)
  const pitchRef = useRef(-0.22)
  const cameraDistRef = useRef(900)
  const draggingRef = useRef(false)
  // 星系佈局（null＝退回球面佈局）、宇宙時間（秒）、時間流速（選取時漸停）、上一幀時間戳
  const layoutRef = useRef<GalaxyLayout | null>(null)
  const simTimeRef = useRef(0)
  const timeScaleRef = useRef(1)
  const lastFrameRef = useRef(0)
  // 拖曳鬆手後的視角慣性（每幀的角速度）
  const yawVelRef = useRef(0)
  const pitchVelRef = useRef(0)
  // 每幀投影後的星系中心（畫星雲光用）
  const galaxyScreenRef = useRef<Array<{ sx: number; sy: number; r: number; op: number; hue: number }>>([])
  const reducedMotionRef = useRef(false)
  const pointerDownRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const sizeRef = useRef({ width: 800, height: 600 })

  // 重算佈局後把鏡頭拉到剛好框住整個宇宙。宇宙半徑會隨節點數成長（幾千
  // 個節點時 outerR 會是現在的好幾倍），固定的預設鏡頭距離遲早會框不住，
  // 所以框距是從半徑反推出來的，不是常數。
  const fitCameraTo = useCallback((worldR: number) => {
    const { width, height } = sizeRef.current
    const minDim = Math.max(240, Math.min(width, height))
    cameraDistRef.current = (worldR * FOCAL_LENGTH) / (0.42 * minDim)
  }, [])

  // 統一的選取入口：所有選取（點畫布、點詳情卡的 chip、點搜尋結果）都走
  // 這裡，順便把節點推進 trail，回頭時才有得跳。
  const selectNode = useCallback((sel: Selection | null) => {
    setSelection(sel)
    if (!sel) return
    setTrail(prev => (prev[prev.length - 1]?.id === sel.id ? prev : [...prev, sel].slice(-24)))
  }, [])

  useEffect(() => { coreKindRef.current = coreKind }, [coreKind])
  // 使用者在系統設定了「減少動態」：公轉、自轉一律停住（仍可拖曳、縮放、點選）
  useEffect(() => {
    const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
    if (!mq) return
    const sync = () => { reducedMotionRef.current = mq.matches }
    sync()
    mq.addEventListener?.('change', sync)
    return () => mq.removeEventListener?.('change', sync)
  }, [])
  useEffect(() => { hoveredIdRef.current = hoveredId }, [hoveredId])
  useEffect(() => { selectionRef.current = selection }, [selection])

  useEffect(() => {
    if (!unlockedPassword) return
    apiFetchHermesGraph(unlockedPassword).then(setData).catch(() => setError(true))
  }, [unlockedPassword])

  // 「最近新增」的 cutoff：讀「上次造訪」時間，不是固定時間窗——固定 7 天
  // 在兩週才開一次時會漏掉，在一天開好幾次時又一直顯示同一批。讀出來的
  // cutoff 只在這裡用一次，不會馬上覆寫 localStorage；要使用者按下面板的
  // 「知道了」（dismissActivity）才更新，這樣中途重整頁面看到的還是同一
  // 批，不會因為單純看了一眼就被標記已讀。沒有記錄（第一次用這個功能）
  // 就退回抓最近 7 天當預設。
  useEffect(() => {
    let raw: string | null = null
    try { raw = localStorage.getItem(LAST_VISIT_STORAGE_KEY) } catch { /* 私密瀏覽/被封鎖時忽略，退回預設窗 */ }
    const fallbackMs = Date.now() - 7 * 24 * 60 * 60 * 1000
    const parsedMs = raw ? Number(raw) : NaN
    const sinceMs = Number.isFinite(parsedMs) ? parsedMs : fallbackMs
    setActivitySinceMs(sinceMs)
    setActivitySince(new Date(sinceMs).toISOString().slice(0, 10))
  }, [])

  const dismissActivity = useCallback(() => {
    setActivityDismissed(true)
    try { localStorage.setItem(LAST_VISIT_STORAGE_KEY, String(Date.now())) } catch { /* 存不了就算了，下次照舊退回 7 天預設 */ }
  }, [])

  // 目前畫面上要顯示的概念／方法節點與邊（依兩個開關過濾）。舊版 API 沒有這些欄位
  // 時全部是空的，畫面行為跟加這功能之前完全一樣。
  const visibleAbstractions = useMemo(() => {
    const g = data?.graph
    const empty = {
      concepts: [] as HermesGraphAbstractionNode[],
      methods: [] as HermesGraphAbstractionNode[],
      conceptEdges: [] as HermesGraphConceptEdge[],
      methodEdges: [] as HermesGraphMethodEdge[],
    }
    if (!g || !showAbstractions) return empty
    const keep = (n: { promoted: boolean }) => showCandidates || n.promoted
    const concepts = (g.concepts ?? []).filter(keep)
    const methods = (g.methods ?? []).filter(keep)
    const cNames = new Set(concepts.map(c => c.name))
    const mNames = new Set(methods.map(m => m.name))
    return {
      concepts, methods,
      conceptEdges: (g.conceptEdges ?? []).filter(e => cNames.has(e.concept)),
      methodEdges: (g.methodEdges ?? []).filter(e => mNames.has(e.method)),
    }
  }, [data, showAbstractions, showCandidates])

  const eventTouchedIds = useMemo(() => {
    // 「孤立事件」＝完全沒有任何邊碰到（無 participants、無 case、無
    // objects）。四實體圖要三種邊都算過一遍才是真正孤立，只看 participants
    // 會把「只掛了案件」的事件誤判成孤立。
    const g = data?.graph
    if (!g) return new Set<string>()
    const s = new Set<string>()
    for (const e of g.edges) s.add(e.eventId)
    for (const e of g.caseEdges) s.add(e.eventId)
    for (const e of g.objectEdges) s.add(e.eventId)
    // 只算「畫面上看得到的」概念／方法邊：只掛在被隱藏的候選上的事件仍算孤立
    for (const e of visibleAbstractions.conceptEdges) s.add(e.eventId)
    for (const e of visibleAbstractions.methodEdges) s.add(e.eventId)
    return s
  }, [data, visibleAbstractions])

  // 建節點／連線／鄰接表。只在資料或「孤立事件顯示開關」變動時重建；切換
  // 核心類型不重建，只重算目標座標（見下一個 effect），節點才會從目前位
  // 置平順地移到新位置，而不是整批重新撒點。
  useEffect(() => {
    const g = data?.graph
    if (!g) {
      nodesRef.current = []; linksRef.current = []
      nodeByIdRef.current = new Map(); neighborsRef.current = new Map()
      return
    }

    const visibleEvents = showIsolatedEvents ? g.events : g.events.filter(e => eventTouchedIds.has(e.id))
    const mk = (id: string, kind: NodeKind, label: string, eventCount: number, candidate = false): UNode => ({
      id, kind, label, eventCount, candidate, baseRadius: baseRadiusFor(kind),
      heat: 0, colorCore: COLOR.amber, colorOuter: NON_CORE_COLOR[kind],
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, tx: 0, ty: 0, tz: 0,
      sx: 0, sy: 0, screenRadius: 0, opacity: 1, depth: 0,
    })

    const nodes: UNode[] = [
      ...g.people.map(p => mk(`p:${p.name}`, 'person', p.name, p.eventCount)),
      ...visibleEvents.map(e => mk(`e:${e.id}`, 'event', e.title, 1)),
      ...g.cases.map(c => mk(`c:${c.name}`, 'case', c.name, c.eventCount)),
      ...g.objects.map(o => mk(`o:${o.name}`, 'object', o.name, o.eventCount)),
      ...visibleAbstractions.concepts.map(k => mk(conceptId(k.name), 'concept', k.name, k.eventCount, !k.promoted)),
      ...visibleAbstractions.methods.map(m => mk(methodId(m.name), 'method', m.name, m.eventCount, !m.promoted)),
    ]
    // 熱度：同一類節點內依關聯事件數的名次百分位為主、對數為輔（見 graphHeat.ts：關聯數長尾很重，
    // 線性／平方根映射會讓整張圖只剩兩種顏色）。事件節點關聯數恆為 1，不套用。
    const countsByKind = new Map<NodeKind, number[]>()
    for (const n of nodes) {
      if (n.kind === 'event') continue
      const arr = countsByKind.get(n.kind)
      if (arr) arr.push(n.eventCount)
      else countsByKind.set(n.kind, [n.eventCount])
    }
    const scaleByKind = new Map([...countsByKind].map(([k, arr]) => [k, makeHeatScale(arr)] as const))
    for (const n of nodes) {
      const scale = scaleByKind.get(n.kind)
      if (!scale) continue
      n.heat = scale(n.eventCount)
      n.colorCore = coreHeatColor(n.heat)
      n.colorOuter = outerHeatColor(NON_CORE_COLOR[n.kind], n.heat)
    }
    const byId = new Map(nodes.map(n => [n.id, n]))

    const links: ULink[] = []
    const neighbors = new Map<string, Set<string>>()
    const connect = (aId: string, bId: string, key: string) => {
      if (!byId.has(aId) || !byId.has(bId)) return
      links.push({ key, aId, bId })
      const sa = neighbors.get(aId) ?? new Set<string>(); sa.add(bId); neighbors.set(aId, sa)
      const sb = neighbors.get(bId) ?? new Set<string>(); sb.add(aId); neighbors.set(bId, sb)
    }
    for (const e of g.edges) connect(`p:${e.person}`, `e:${e.eventId}`, `pe:${e.person}|${e.eventId}`)
    for (const e of g.caseEdges) connect(`e:${e.eventId}`, `c:${e.case}`, `ec:${e.eventId}|${e.case}`)
    for (const e of g.objectEdges) connect(`e:${e.eventId}`, `o:${e.object}`, `eo:${e.eventId}|${e.object}`)
    for (const e of visibleAbstractions.conceptEdges) connect(`e:${e.eventId}`, conceptId(e.concept), `ek:${e.eventId}|${e.concept}`)
    for (const e of visibleAbstractions.methodEdges) connect(`e:${e.eventId}`, methodId(e.method), `em:${e.eventId}|${e.method}`)
    for (const r of g.personRelations) connect(`p:${r.from}`, `p:${r.to}`, `pp:${r.from}|${r.to}`)

    nodesRef.current = nodes
    linksRef.current = links
    nodeByIdRef.current = byId
    neighborsRef.current = neighbors

    const lay = layoutFor(nodes, neighbors, coreKindRef.current)
    layoutRef.current = lay.layout
    worldRadiusRef.current = lay.worldR
    fitCameraTo(worldRadiusRef.current)
    // 初次出現時從中心往外展開（彈簧會帶一點衝過頭再收回，像一次小小的大霹靂），
    // 也避免所有節點同一幀瞬間出現在最終位置那種生硬感。
    for (const n of nodes) { n.x = n.tx * 0.15; n.y = n.ty * 0.15; n.z = n.tz * 0.15; n.vx = 0; n.vy = 0; n.vz = 0 }
    setSelection(null)
  }, [data, showIsolatedEvents, eventTouchedIds, visibleAbstractions, fitCameraTo])

  // 從時間軸的事件晶片跳過來：資料載入後聚焦該節點（見 graphFocus.ts）。
  // ⚠️ 必須宣告在上面那個「建節點」effect 之後：effect 依宣告順序執行，而那個 effect 結尾會
  // setSelection(null) 重置選取——放在它前面，聚焦會在同一輪被立刻清掉（實測踩過）。
  useEffect(() => {
    if (!data) return
    const f = consumeGraphFocus()
    if (f) selectNode(f)
  }, [data, selectNode])

  // 切換核心類型：只重算目標座標，節點自己補間過去。
  useEffect(() => {
    if (nodesRef.current.length === 0) return
    const lay = layoutFor(nodesRef.current, neighborsRef.current, coreKind)
    layoutRef.current = lay.layout
    worldRadiusRef.current = lay.worldR
    fitCameraTo(worldRadiusRef.current)
  }, [coreKind, fitCameraTo])

  // ── 每幀：補間位置 → 投影 → 畫。沒有任何力學迭代，成本只跟節點數成正
  // 比，幾百個節點也穩定。整個迴圈只掛一次（依賴陣列是空的），所有會變動
  // 的狀態一律透過 ref 讀取——第一版把 hoveredId/selection 直接 closure 進
  // 來，迴圈掛上後就永遠讀到舊值，hover 高亮跟選取變色其實從沒生效過。
  useEffect(() => {
    let raf = 0
    let stopped = false

    function project() {
      const nodes = nodesRef.current
      const sel = selectionRef.current
      const focus = sel ? nodeByIdRef.current.get(sel.id) : null

      // 宇宙時間：選取時（或使用者偏好減少動態）流速漸漸降到 0，公轉與自轉一起停下；取消選取再慢慢恢復。
      const now = performance.now()
      const dt = lastFrameRef.current ? Math.min(0.05, (now - lastFrameRef.current) / 1000) : 0
      lastFrameRef.current = now
      const wantScale = focus || reducedMotionRef.current ? 0 : 1
      timeScaleRef.current += (wantScale - timeScaleRef.current) * TIME_EASE
      simTimeRef.current += dt * timeScaleRef.current
      const layout = layoutRef.current
      if (layout) applyMotionTargets(nodes, layout, simTimeRef.current)

      for (const n of nodes) {
        n.vx = (n.vx + (n.tx - n.x) * SPRING_K) * SPRING_DAMP
        n.vy = (n.vy + (n.ty - n.y) * SPRING_K) * SPRING_DAMP
        n.vz = (n.vz + (n.tz - n.z) * SPRING_K) * SPRING_DAMP
        n.x += n.vx; n.y += n.vy; n.z += n.vz
      }
      const pivot = pivotRef.current
      const targetX = focus ? focus.x : 0
      const targetY = focus ? focus.y : 0
      const targetZ = focus ? focus.z : 0
      pivot.x += (targetX - pivot.x) * PIVOT_EASE
      pivot.y += (targetY - pivot.y) * PIVOT_EASE
      pivot.z += (targetZ - pivot.z) * PIVOT_EASE

      // 選取狀態下停掉自轉：使用者要的是「點到的節點置中不動」，整個場景
      // 同時凍住，看細節時最清楚；取消選取後才恢復自轉。
      // 系統設定「減少動態」時連鏡頭自轉也停（只在使用者自己拖曳時才轉）
      if (!draggingRef.current && !focus && !reducedMotionRef.current) yawRef.current += IDLE_ROTATE_SPEED
      // 拖曳鬆手後的慣性：視角繼續轉一小段再停（摩擦力逐幀衰減）
      if (!draggingRef.current) {
        yawRef.current += yawVelRef.current
        pitchRef.current = Math.max(-1.4, Math.min(1.4, pitchRef.current + pitchVelRef.current))
        yawVelRef.current *= YAW_FRICTION
        pitchVelRef.current *= PITCH_FRICTION
      }

      const yaw = yawRef.current, pitch = pitchRef.current
      const cosY = Math.cos(yaw), sinY = Math.sin(yaw)
      const cosP = Math.cos(pitch), sinP = Math.sin(pitch)
      const cameraDist = cameraDistRef.current
      const { width, height } = sizeRef.current
      const cx = width / 2, cy = height / 2
      const worldR = worldRadiusRef.current
      const coreNow = coreKindRef.current
      // 世界原點處的投影比例 × 上限＝近端節點的最大放大倍率
      const nearCap = (FOCAL_LENGTH / cameraDist) * NEAR_SCALE_CAP
      const faintSet = layoutRef.current?.faint ?? null

      for (const n of nodes) {
        // 先減掉 pivot 再旋轉＝把旋轉軸心換成 pivot（見 pivotRef 說明）
        const lx = n.x - pivot.x, ly = n.y - pivot.y, lz = n.z - pivot.z
        const rx = lx * cosY - lz * sinY
        const rz1 = lx * sinY + lz * cosY
        const ry = ly * cosP - rz1 * sinP
        const rz = ly * sinP + rz1 * cosP

        const perspectiveZ = rz + cameraDist
        const scale = perspectiveZ > 1 ? FOCAL_LENGTH / perspectiveZ : 0
        n.sx = cx + rx * scale
        n.sy = cy + ry * scale
        // 近端節點不無限放大（見 NEAR_SCALE_CAP）：位置照透視走，只有「圓點本身的大小」被夾住
        const sizeScale = Math.min(scale, nearCap)
        // 背景節點（星系佈局判定與任何星系都無關者）畫小、畫淡，像遠方的星，不跟星系搶畫面
        const isFaint = !!faintSet && faintSet.has(n.id)
        n.screenRadius = n.baseRadius * sizeScale * (n.kind === coreNow ? 1.55 : n.kind === 'event' ? 1 : NONCORE_INDEX_SIZE) * (isFaint ? FAINT_SIZE : 1)
        n.depth = perspectiveZ
        // 深度直接換算不透明度：最前面 1、最後面 DEPTH_MIN_OPACITY。用 rz
        // 而不是 scale，映射是線性且跟鏡頭距離無關，縮放時不會整張圖一起
        // 變淡。
        const frontness = Math.max(0, Math.min(1, (worldR - rz) / (2 * worldR)))
        n.opacity = (DEPTH_MIN_OPACITY + (1 - DEPTH_MIN_OPACITY) * frontness) * nearFade(scale, nearCap) * (isFaint ? FAINT_OPACITY : 1)
      }

      // 星系中心也做同樣的投影，給星雲光用
      const gs = galaxyScreenRef.current
      gs.length = 0
      if (layout) {
        for (const g of layout.galaxies) {
          const lx = g.center[0] - pivot.x, ly = g.center[1] - pivot.y, lz = g.center[2] - pivot.z
          const rx = lx * cosY - lz * sinY
          const rz1 = lx * sinY + lz * cosY
          const ry = ly * cosP - rz1 * sinP
          const rz = ly * sinP + rz1 * cosP
          const pz = rz + cameraDist
          if (pz <= 1) continue
          const sc = FOCAL_LENGTH / pz
          const frontness = Math.max(0, Math.min(1, (worldR - rz) / (2 * worldR)))
          gs.push({ sx: cx + rx * sc, sy: cy + ry * sc, r: g.radius * 1.7 * Math.min(sc, nearCap), op: DEPTH_MIN_OPACITY + (1 - DEPTH_MIN_OPACITY) * frontness, hue: g.hue })
        }
      }
    }

    function draw() {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const { width, height } = sizeRef.current
      ctx.clearRect(0, 0, width, height)

      // 背景：中心一抹很淡的藍紫星雲光＋固定星點。靜態內容畫一次進離屏畫布，之後每幀只 drawImage 一次（轉動時小幅橫移做視差）。
      // 只畫在畫布上，不影響命中測試。
      const bgc = ensureBackdrop(bgRef, width, height)
      if (bgc) {
        const off = ((yawRef.current * 18) % width + width) % width
        ctx.drawImage(bgc, off, 0)
        ctx.drawImage(bgc, off - width, 0)
      }
      // 每個星系一團淡淡的星雲光（冷色系，色相由星系決定）：群聚在畫面上直接「看得出是一群」，群與群之間是暗的
      for (const g of galaxyScreenRef.current) {
        if (g.r < 2 || g.op <= 0) continue
        const sprite = nebulaSprite(g.hue)
        if (!sprite) continue
        ctx.globalAlpha = Math.min(1, g.op)
        ctx.drawImage(sprite, g.sx - g.r, g.sy - g.r, g.r * 2, g.r * 2)
      }
      ctx.globalAlpha = 1

      const nodes = nodesRef.current
      const byId = nodeByIdRef.current
      const coreNow = coreKindRef.current
      const focusId = hoveredIdRef.current ?? selectionRef.current?.id ?? null
      const selectedId = selectionRef.current?.id ?? null
      const focusSet = focusId ? (neighborsRef.current.get(focusId) ?? new Set<string>()) : null

      const pathSet = pathSetRef.current
      const isLit = (id: string) => (pathSet ? pathSet.has(id) : !focusSet || id === focusId || focusSet.has(id))

      // 沒有選取／hover／路徑時＝「總覽」：邊壓淡（見 idleEdgeAlpha）；有焦點時回到原本的打亮／壓暗。
      const overview = !focusSet && !pathSet
      if (overview) {
        // 總覽有幾千條邊，逐條 beginPath／stroke 太慢（實測幀時間是舊版的兩倍以上）：把透明度量化成 8 級，
        // 同一級的線段合併成一條路徑、一次 stroke。
        const idleAlpha = idleEdgeAlpha(linksRef.current.length)
        const step = idleAlpha / EDGE_LEVELS
        for (let i = 0; i <= EDGE_LEVELS; i++) edgeSegs[i].length = 0
        const nbrs = neighborsRef.current
        const faint = layoutRef.current?.faint
        for (const link of linksRef.current) {
          const a = byId.get(link.aId), b = byId.get(link.bId)
          if (!a || !b) continue
          // 背景節點的邊總覽時不畫：hub 模式背景常有上千個節點、散在鏡頭四周，它們的邊會變成橫跨整個畫面的長線
          // （還有落在鏡頭後方、被投影到畫面中心的放射線），光柵化成本讓概念／方法／案件為核心的幀時間變成人為核心的 2～3 倍（10-03 使用者回報切換卡頓）
          if (faint && (faint.has(a.id) || faint.has(b.id))) continue
          const damp = hubDamp(Math.max(nbrs.get(a.id)?.size ?? 1, nbrs.get(b.id)?.size ?? 1))
          const level = edgeLevel(Math.min(a.opacity, b.opacity), idleAlpha, damp)
          if (level > 0) edgeSegs[level].push(a.sx, a.sy, b.sx, b.sy)
        }
        ctx.lineWidth = 1
        for (let lv = 1; lv <= EDGE_LEVELS; lv++) {
          const seg = edgeSegs[lv]
          if (seg.length === 0) continue
          ctx.strokeStyle = `rgba(140,168,230,${(lv * step).toFixed(4)})`
          ctx.beginPath()
          for (let i = 0; i < seg.length; i += 4) { ctx.moveTo(seg[i], seg[i + 1]); ctx.lineTo(seg[i + 2], seg[i + 3]) }
          ctx.stroke()
        }
      } else {
        const faint = layoutRef.current?.faint
        for (const link of linksRef.current) {
          const a = byId.get(link.aId), b = byId.get(link.bId)
          if (!a || !b) continue
          // 有焦點時，背景節點的邊只畫跟焦點／路徑有關的那些（理由同上）
          if (faint && (faint.has(a.id) || faint.has(b.id)) && !(isLit(a.id) && isLit(b.id))) continue
          // 路徑模式：只有「路徑上相鄰的兩點之間」那幾條邊被打亮成琥珀色，
          // 其餘全部壓到幾乎看不見——這樣「這兩個東西怎麼扯上關係」是直接
          // 在圖上看出來的，不是只有文字列出來而已。
          const onPath = !!pathSet && pathSet.has(a.id) && pathSet.has(b.id)
          const lit = isLit(a.id) && isLit(b.id)
          ctx.lineWidth = onPath ? 2 : 1
          if (onPath) {
            ctx.strokeStyle = `rgba(245,166,35,${(Math.min(a.opacity, b.opacity) * 0.95).toFixed(3)})`
          } else {
            const op = Math.min(a.opacity, b.opacity) * (lit ? 0.3 : 0.04)
            ctx.strokeStyle = `rgba(150,161,180,${op.toFixed(3)})`
          }
          ctx.beginPath()
          ctx.moveTo(a.sx, a.sy)
          ctx.lineTo(b.sx, b.sy)
          ctx.stroke()
        }
      }
      ctx.lineWidth = 1

      // 由遠到近畫，近端節點蓋住遠端節點，這是立體感的關鍵
      const sorted = [...nodes].sort((p, q) => q.depth - p.depth)
      const faintNodes = layoutRef.current?.faint
      let numFont = '' // 圓內數字的字型：只在字級變了才重設（ctx.font 每次設定都要重新解析字串，物件為核心時四百多次／幀）
      for (const n of sorted) {
        const lit = isLit(n.id)
        const selected = n.id === selectedId
        const r = Math.max(0.8, n.screenRadius)

        if (selected) {
          // 選取用光暈表示，不畫外框（節點一律無邊框）
          const glow = ctx.createRadialGradient(n.sx, n.sy, 0, n.sx, n.sy, r * 3.4)
          glow.addColorStop(0, 'rgba(245,166,35,0.40)')
          glow.addColorStop(1, 'rgba(245,166,35,0)')
          ctx.globalAlpha = 1
          ctx.fillStyle = glow
          ctx.beginPath()
          ctx.arc(n.sx, n.sy, r * 3.4, 0, Math.PI * 2)
          ctx.fill()
        }

        ctx.globalAlpha = selected ? 1 : n.opacity * (lit ? 1 : 0.16)
        const nodeAlpha = ctx.globalAlpha
        const color = selected ? COLOR.amber : (n.kind === coreNow ? n.colorCore : n.colorOuter)
        if (isAbstraction(n.kind)) {
          // 抽象層：半透明填色＋薄框（概念＝圓環、方法＝菱形）；候選更淡、框用虛線。
          // 核心是抽象類型時填色加深，讓「目前的核心」仍然一眼看得出來。
          const rr = selected ? r * 1.35 : r
          const base = ctx.globalAlpha
          const isCore = n.kind === coreNow
          ctx.beginPath()
          if (n.kind === 'concept') ctx.arc(n.sx, n.sy, rr, 0, Math.PI * 2)
          else {
            const d = rr * 1.25
            ctx.moveTo(n.sx, n.sy - d); ctx.lineTo(n.sx + d, n.sy); ctx.lineTo(n.sx, n.sy + d); ctx.lineTo(n.sx - d, n.sy); ctx.closePath()
          }
          ctx.fillStyle = color
          ctx.globalAlpha = base * (isCore || selected ? 0.4 : n.candidate ? 0.1 : 0.2)
          ctx.fill()
          ctx.globalAlpha = base * (n.candidate ? 0.65 : 1)
          ctx.strokeStyle = color
          ctx.lineWidth = 1
          ctx.setLineDash(n.candidate ? [3, 3] : [])
          ctx.stroke()
          ctx.setLineDash([])
        } else {
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(n.sx, n.sy, selected ? r * 1.35 : r, 0, Math.PI * 2)
          ctx.fill()
        }
        // 核心索引節點（目前核心類型的人／案／物／概念／方法）：圓內標關聯事件數。外圍節點不標（使用者要求），
        // 半徑太小（遠端或縮得很小）時也不標，不然糊成一團。
        // 背景（星系佈局判定與任何星系都無關）的核心不標：本來就畫小畫淡，數字看不清，且物件為核心時有四百多個
        if (n.kind === coreNow && n.kind !== 'event' && r >= 5.2 && !(faintNodes && faintNodes.has(n.id))) {
          const digits = String(n.eventCount)
          ctx.globalAlpha = nodeAlpha
          const font = `600 ${Math.round(Math.max(7, Math.min(15, r * (digits.length > 2 ? 0.8 : 1))))}px ${FONT.mono}`
          if (font !== numFont) { ctx.font = font; numFont = font }
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillStyle = isAbstraction(n.kind) ? color : '#14161c'
          ctx.fillText(digits, n.sx, n.sy + 0.5)
          ctx.textBaseline = 'alphabetic'
        }
      }
      ctx.globalAlpha = 1

      // 標籤：有選取/hover 時只標那個節點跟它的鄰居（看關係時最需要的資
      // 訊）；沒有的話標核心類型的節點，但核心數量太多（例如 364 個事件）
      // 就整個不標，否則字會疊成一片。
      const labelled: UNode[] = []
      if (focusId) {
        const f = byId.get(focusId)
        if (f) labelled.push(f)
        if (focusSet) {
          for (const id of focusSet) {
            const nb = byId.get(id)
            if (nb) labelled.push(nb)
            if (labelled.length > 36) break
          }
        }
      } else {
        // 名稱只標「核心類型」的節點（外圍不標，使用者要求；選取／hover 時另有鄰居標籤，見上面）。
        // 核心是索引節點（人／案／物／概念／方法）：依關聯數由大到小排優先，實際畫哪些交給下面的碰撞排除；
        // 核心是事件：幾百個標不下，只有 ≤90 個才標。
        const coreNodes = nodes.filter(n => n.kind === coreNow && !n.candidate)
        // 只標關聯數最多的前幾十個：名字全標會在核心球上疊成一片（正式資料 152 人），要看別人就 hover／搜尋
        if (coreNow !== 'event') labelled.push(...coreNodes.sort((a, b) => b.eventCount - a.eventCount).slice(0, 48))
        else if (coreNodes.length <= 90) labelled.push(...coreNodes)
      }

      ctx.font = `11px ${FONT.mono}`
      ctx.textAlign = 'center'
      // 標籤做螢幕空間的碰撞排除：核心球面上幾十個節點投影後常常互相重
      // 疊，全部照畫會糊成一團看不出誰是誰（第一版就是這樣）。依優先序
      // （選取中 > 半徑大 > 離鏡頭近）逐一嘗試放置，跟已放好的標籤重疊就
      // 直接不畫——寧可少標幾個，也不要疊成雜訊。
      const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = []
      const priority = labelled.slice().sort((p, q) => {
        if (p.id === selectedId) return -1
        if (q.id === selectedId) return 1
        // 大小不再代表關聯數，優先序改看關聯數：越熱門的名字越先佔位
        if (q.eventCount !== p.eventCount) return q.eventCount - p.eventCount
        return p.depth - q.depth
      })
      for (const n of priority) {
        if (n.opacity < 0.6 && n.id !== selectedId) continue // 太後面的節點不標，減少雜訊
        const text = n.label.length > 14 ? `${n.label.slice(0, 13)}…` : n.label
        const w = ctx.measureText(text).width
        const x = n.sx, y = n.sy + Math.max(4, n.screenRadius) + 12
        const box = { x0: x - w / 2 - 2, y0: y - 10, x1: x + w / 2 + 2, y1: y + 3 }
        if (placed.some(b => !(box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1))) continue
        placed.push(box)
        ctx.globalAlpha = Math.max(0.45, n.opacity)
        ctx.fillStyle = n.id === selectedId ? COLOR.amber : COLOR.ink
        ctx.fillText(text, x, y)
      }
      ctx.globalAlpha = 1
    }

    function frame() {
      if (stopped) return
      project()
      draw()
      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)
    return () => { stopped = true; cancelAnimationFrame(raf) }
  }, [])

  // canvas 內部解析度跟著容器實際像素尺寸走（含 devicePixelRatio），不然
  // 畫面會是拉伸過的糊圖。容器/canvas 一律每次都掛載（不用早期 return 跳
  // 過），這個 effect 才抓得到 ref。
  useEffect(() => {
    const el = containerRef.current
    const canvas = canvasRef.current
    if (!el || !canvas) return
    const ro = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect
      if (!box) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = Math.max(1, Math.floor(box.width)), h = Math.max(1, Math.floor(box.height))
      sizeRef.current = { width: w, height: h }
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const hitTest = useCallback((clientX: number, clientY: number): UNode | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left, y = clientY - rect.top
    let best: UNode | null = null
    let bestDepth = Infinity
    for (const n of nodesRef.current) {
      const dx = n.sx - x, dy = n.sy - y
      const r = Math.max(5, n.screenRadius) + 3
      if (dx * dx + dy * dy <= r * r && n.depth < bestDepth) { best = n; bestDepth = n.depth }
    }
    return best
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as Element).setPointerCapture(e.pointerId)
    pointerDownRef.current = { x: e.clientX, y: e.clientY, moved: false }
    draggingRef.current = true
    yawVelRef.current = 0
    pitchVelRef.current = 0
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const down = pointerDownRef.current
    if (!down) {
      setHoveredId(hitTest(e.clientX, e.clientY)?.id ?? null)
      return
    }
    const dx = e.clientX - down.x, dy = e.clientY - down.y
    if (!down.moved && Math.hypot(dx, dy) > 4) down.moved = true
    if (down.moved) {
      const dyaw = (e.clientX - down.x) * 0.006, dpitch = (e.clientY - down.y) * 0.006
      yawRef.current += dyaw
      pitchRef.current = Math.max(-1.4, Math.min(1.4, pitchRef.current + dpitch))
      // 記下最後一次拖曳的角速度，鬆手後當慣性（上限避免一甩就轉好幾圈）
      yawVelRef.current = Math.max(-0.08, Math.min(0.08, dyaw))
      pitchVelRef.current = Math.max(-0.05, Math.min(0.05, dpitch))
      pointerDownRef.current = { x: e.clientX, y: e.clientY, moved: true }
    }
  }, [hitTest])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const down = pointerDownRef.current
    pointerDownRef.current = null
    draggingRef.current = false
    // 只有「幾乎沒有位移」才算點擊，不然轉視角時鬆手常常誤觸選取
    if (!down || down.moved) return
    const hit = hitTest(e.clientX, e.clientY)
    selectNode(hit ? { kind: hit.kind, id: hit.id } : null)
  }, [hitTest, selectNode])

  const handlePointerLeave = useCallback(() => {
    pointerDownRef.current = null
    draggingRef.current = false
    setHoveredId(null)
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    // 乘法縮放而不是加減固定量：加法在拉遠之後每一格滾輪的視覺變化會越來
    // 越小（因為投影是 1/距離），乘法則不管在哪個尺度上每一格的感覺都一
    // 樣。上下限也綁在宇宙半徑上，宇宙長大時跟著放寬。
    const worldR = worldRadiusRef.current
    const next = cameraDistRef.current * Math.exp(e.deltaY * 0.0014)
    cameraDistRef.current = Math.max(worldR * ZOOM_MIN_FACTOR, Math.min(worldR * ZOOM_MAX_FACTOR, next))
  }, [])

  // 手機沒有滾輪也不方便雙指縮放：提供 ＋／－ 按鈕。跟滾輪同一套上下限（相對於宇宙半徑）。
  const zoomBy = useCallback((factor: number) => {
    const worldR = worldRadiusRef.current
    cameraDistRef.current = Math.max(worldR * ZOOM_MIN_FACTOR, Math.min(worldR * ZOOM_MAX_FACTOR, cameraDistRef.current * factor))
  }, [])

  // 主控台（App.tsx 的 CommandPalette）用 ⌘K/Ctrl+K 開全站搜尋，但這一頁
  // 已經有自己專門搜人/事/案/物的搜尋框，不需要另一層 overlay——這裡接同
  // 一組快捷鍵，單純把焦點跟游標丟給既有的輸入框，兩邊快捷鍵記憶體感一致。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const g = data?.graph

  // 搜尋：364 個事件用眼睛在球面上找不到，這是能不能實際用起來的關鍵。
  const searchHits = useMemo(
    () => (g && searchQuery.trim() ? searchNodes(g, searchQuery, coreKind, 24) : []),
    [g, searchQuery, coreKind],
  )

  // 兩點之間的最短路徑：回答「這兩個東西到底怎麼扯上關係的」。BFS 走的是
  // 真實的邊，不是猜的，所以路徑本身就是證據。
  const pathIds = useMemo(() => {
    if (!g || !pathAnchor || !selection || pathAnchor === selection.id) return null
    return shortestPath(buildIndex(g), pathAnchor, selection.id)
  }, [g, pathAnchor, selection])
  useEffect(() => { pathSetRef.current = pathIds ? new Set(pathIds) : null }, [pathIds])

  const activity = useMemo(
    () => (g && activitySince ? recentActivity(buildIndex(g), g, activitySince, activitySinceMs ?? undefined) : null),
    [g, activitySince, activitySinceMs],
  )
  const activityTotal = activity
    ? activity.newPeople.length + activity.newEvents.length + activity.newCases.length
      + activity.newObjects.length + activity.newNarratives.length + activity.refreshedAssessments.length
    : 0

  const ready = !!(unlockedPassword && !error && data && data.available !== false && data.graph)
  const statusMessage = !unlockedPassword
    ? '需要先解鎖私領域才能查看關係宇宙'
    : error
      ? '暫時無法取得資料'
      : (!data || data.available === false || !data.graph)
        ? '資料準備中——collect.ps1 還沒在主機上跑過'
        : null

  const m = data?.metrics
  const coreLabel: Record<CoreKind, string> = { person: '人', event: '事', object: '物', case: '案件', concept: '概念', method: '方法' }
  const candidateTotal = (m?.candidateConceptsCount ?? 0) + (m?.candidateMethodsCount ?? 0)
  const hasAbstractions = !!g && ((g.concepts?.length ?? 0) + (g.methods?.length ?? 0)) > 0
  const coreChoices: CoreKind[] = showAbstractions && hasAbstractions
    ? ['person', 'event', 'object', 'case', 'concept', 'method']
    : ['person', 'event', 'object', 'case']
  const isolatedCount = g ? g.events.length - g.events.filter(e => eventTouchedIds.has(e.id)).length : 0

  return (
    <GraphShell tab="universe" onBack={onBack}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center', padding: '0.9rem 1.2rem', borderBottom: `1px solid ${COLOR.line}` }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          {coreChoices.map(k => (
            <button key={k} type="button" onClick={() => setCoreKind(k)} disabled={!ready} style={{
              padding: '0.4rem 0.9rem', borderRadius: '999px', cursor: ready ? 'pointer' : 'default', fontFamily: FONT.mono, fontSize: '0.72rem', letterSpacing: '0.06em', whiteSpace: 'nowrap',
              background: coreKind === k ? 'rgba(245,166,35,0.16)' : 'transparent',
              border: `1px solid ${coreKind === k ? COLOR.amber : COLOR.line}`,
              color: coreKind === k ? COLOR.amber : COLOR.steelDim, opacity: ready ? 1 : 0.4,
            }}>{coreLabel[k]}為核心</button>
          ))}
        </div>
        {ready && (
          <div style={{ position: 'relative', minWidth: '210px' }}>
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜尋人／事／案件／物件／概念／方法…"
              style={{
                width: '100%', padding: '0.4rem 0.7rem', borderRadius: '999px',
                background: COLOR.panel, border: `1px solid ${searchQuery ? COLOR.amberDim : COLOR.line}`,
                color: COLOR.ink, fontFamily: FONT.body, fontSize: '0.7rem', outline: 'none',
              }}
            />
            {searchHits.length > 0 && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 5px)', left: 0, right: 0, zIndex: 10,
                maxHeight: '19rem', overflowY: 'auto',
                background: 'rgba(18,19,25,0.98)', border: `1px solid ${COLOR.line}`, borderRadius: '6px',
              }}>
                {searchHits.map(hit => (
                  <div
                    key={hit.id}
                    onClick={() => { selectNode({ kind: hit.kind, id: hit.id }); setSearchQuery('') }}
                    style={{ padding: '0.4rem 0.7rem', cursor: 'pointer', borderBottom: `1px solid ${COLOR.line}` }}
                  >
                    <div style={{ fontSize: '0.7rem', color: COLOR.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hit.label}</div>
                    <div style={{ fontFamily: FONT.mono, fontSize: '0.58rem', color: COLOR.steelDim }}>{hit.sub}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div style={{ flex: 1 }} />
        {ready && m && (
          <>
            <button type="button" onClick={() => setShowIsolatedEvents(v => !v)} style={{
              padding: '0.35rem 0.7rem', borderRadius: '999px', cursor: 'pointer', fontFamily: FONT.mono, fontSize: '0.62rem',
              background: showIsolatedEvents ? 'rgba(245,166,35,0.1)' : 'transparent',
              border: `1px solid ${showIsolatedEvents ? COLOR.amberDim : COLOR.line}`, color: showIsolatedEvents ? COLOR.amber : COLOR.steelDim,
            }}>孤立事件 · {isolatedCount}</button>
            {hasAbstractions && (
              <button type="button" onClick={() => {
                setShowAbstractions(v => !v)
                // 關掉抽象層時，核心若是概念／方法就退回「人」，不然畫面會沒有核心節點
                if (showAbstractions && isAbstraction(coreKind)) setCoreKind('person')
              }} title="概念／方法：從事件萃取出的想法與做法（半透明薄框、在最外圈）" style={{
                padding: '0.35rem 0.7rem', borderRadius: '999px', cursor: 'pointer', fontFamily: FONT.mono, fontSize: '0.62rem',
                background: showAbstractions ? 'rgba(127,166,220,0.12)' : 'transparent',
                border: `1px solid ${showAbstractions ? NON_CORE_COLOR.concept : COLOR.line}`, color: showAbstractions ? NON_CORE_COLOR.concept : COLOR.steelDim,
              }}>概念／方法層</button>
            )}
            {hasAbstractions && showAbstractions && (
              <button type="button" onClick={() => setShowCandidates(v => !v)} title="候選＝只在 1 個事件出現、尚未被重複驗證的概念／方法（虛線、較淡）" style={{
                padding: '0.35rem 0.7rem', borderRadius: '999px', cursor: 'pointer', fontFamily: FONT.mono, fontSize: '0.62rem',
                background: showCandidates ? 'rgba(245,166,35,0.1)' : 'transparent',
                border: `1px solid ${showCandidates ? COLOR.amberDim : COLOR.line}`, color: showCandidates ? COLOR.amber : COLOR.steelDim,
              }}>顯示候選 · {candidateTotal}</button>
            )}
            <div style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steelDim, display: 'flex', gap: '0.9rem' }}>
              <span><span style={{ color: nodeColor('person', coreKind) }}>●</span> 人 {m.peopleCount}</span>
              <span><span style={{ color: nodeColor('event', coreKind) }}>●</span> 事 {m.eventsCount}</span>
              <span><span style={{ color: nodeColor('case', coreKind) }}>●</span> 案 {m.casesCount}</span>
              <span><span style={{ color: nodeColor('object', coreKind) }}>●</span> 物 {m.objectsCount}</span>
              {hasAbstractions && showAbstractions && (
                <>
                  <span title="概念（圓環）：已晉升 ≥2 事件"><span style={{ color: nodeColor('concept', coreKind) }}>◯</span> 概念 {m.conceptsCount ?? 0}</span>
                  <span title="方法（菱形）：已晉升 ≥2 事件"><span style={{ color: nodeColor('method', coreKind) }}>◇</span> 方法 {m.methodsCount ?? 0}</span>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div ref={containerRef} style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none', cursor: 'grab' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onWheel={handleWheel}
        />

        {statusMessage && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
            <CenterMessage>{statusMessage}</CenterMessage>
          </div>
        )}

        {ready && g && selection && (
          <RelationshipDetailPanel
            graph={g}
            unlockedPassword={unlockedPassword}
            selection={selection}
            onSelect={selectNode}
            onClose={() => { setSelection(null); setPathAnchor(null) }}
            onSetPathAnchor={setPathAnchor}
            pathAnchor={pathAnchor}
            trail={trail}
            onTrailJump={(i) => { const t = trail[i]; if (t) { setSelection(t); setTrail(prev => prev.slice(0, i + 1)) } }}
          />
        )}

        {ready && activity && activityTotal > 0 && !activityDismissed && (
          <RecentActivityPanel activity={activity} total={activityTotal} onDismiss={dismissActivity} onSelect={selectNode} />
        )}

        {ready && pathIds && pathIds.length > 1 && g && (
          <div style={{
            position: 'absolute', left: '1.2rem', top: '1rem', width: 'min(520px, calc(100% - 2.4rem))',
            padding: '0.6rem 0.85rem', background: 'rgba(18,19,25,0.96)', border: `1px solid ${COLOR.amberDim}`, borderRadius: '6px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.amber, letterSpacing: '0.06em' }}>
                關聯路徑 · {pathIds.length - 1} 步
              </span>
              <span onClick={() => setPathAnchor(null)} style={{ cursor: 'pointer', color: COLOR.steelDim, fontSize: '0.75rem' }}>✕</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', marginTop: '5px' }}>
              {pathIds.map((id, i) => {
                const { kind, name } = splitId(id)
                const label = kind === 'event'
                  ? (g.events.find(e => e.id === name)?.title ?? name)
                  : name
                const short = label.length > 16 ? `${label.slice(0, 15)}…` : label
                return (
                  <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    {i > 0 && <span style={{ color: COLOR.steelDim, fontSize: '0.65rem' }}>→</span>}
                    <span
                      onClick={() => selectNode({ kind, id })}
                      title={label}
                      style={{ cursor: 'pointer', fontSize: '0.66rem', color: COLOR.ink, borderBottom: `1px dotted ${COLOR.steelDim}` }}
                    >{short}</span>
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {ready && (
          <div style={{ position: 'absolute', right: '0.8rem', bottom: '3.2rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {([['＋', 0.8, '放大'], ['－', 1.25, '縮小']] as const).map(([label, factor, aria]) => (
              <button key={aria} type="button" aria-label={aria} onClick={() => zoomBy(factor)} style={{
                width: '44px', height: '44px', borderRadius: '50%', cursor: 'pointer', fontSize: '1.3rem', lineHeight: 1,
                background: 'rgba(26,28,34,0.92)', border: `1px solid ${COLOR.lineBright}`, color: COLOR.ink, touchAction: 'manipulation',
              }}>{label}</button>
            ))}
          </div>
        )}

        <div style={{ position: 'absolute', right: '1rem', bottom: '1rem', fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, opacity: 0.75, textAlign: 'right', lineHeight: 1.6 }}>
          {ready && (
            <div title="索引節點（人／案／物／概念／方法）的顏色越深，代表關聯的事件越多；圓內的數字是關聯事件數">
              顏色越深＝關聯越多{' '}
              <span style={{ display: 'inline-block', width: '46px', height: '6px', borderRadius: '3px', verticalAlign: 'middle', background: `linear-gradient(90deg, ${CORE_RAMP.floor}, ${CORE_RAMP.mid}, ${CORE_RAMP.peak})` }} />
            </div>
          )}
          拖拉旋轉・＋－縮放（電腦可用滾輪）・點節點看詳情
        </div>
      </div>
    </GraphShell>
  )
}

const RECENT_KIND_LABEL: Record<'person' | 'case' | 'object' | 'event', string> = { person: '新人物', case: '新案件', object: '新物件', event: '新事件' }

function hubNodeId(kind: 'person' | 'case' | 'object', hub: string): string {
  return kind === 'person' ? personId(hub) : kind === 'case' ? caseId(hub) : objectId(hub)
}

/** 「最近新增」面板：右上角，跟左上角的關聯路徑卡、左下角的詳情卡各佔一
 *  角，不會疊在一起。只在有東西可顯示時掛載（activityTotal > 0 才 render
 *  這個元件），所以不用自己處理空狀態。 */
function RecentActivityPanel({
  activity, total, onDismiss, onSelect,
}: {
  activity: RecentActivity
  total: number
  onDismiss: () => void
  onSelect: (sel: Selection) => void
}) {
  const itemSections: Array<{ kind: 'person' | 'case' | 'object' | 'event'; items: RecentActivityItem[] }> = [
    { kind: 'person', items: activity.newPeople },
    { kind: 'case', items: activity.newCases },
    { kind: 'object', items: activity.newObjects },
    { kind: 'event', items: activity.newEvents },
  ]

  return (
    <div style={{
      position: 'absolute', right: '1.2rem', top: '1rem', width: 'min(340px, calc(100% - 2.4rem))',
      maxHeight: 'calc(100% - 2.4rem)', overflowY: 'auto',
      padding: '0.7rem 0.85rem', background: 'rgba(18,19,25,0.97)', border: `1px solid ${COLOR.amberDim}`, borderRadius: '6px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.amber, letterSpacing: '0.06em' }}>最近新增 · 共 {total} 項</span>
        <span onClick={onDismiss} style={{ cursor: 'pointer', color: COLOR.steelDim, fontSize: '0.75rem' }}>✕</span>
      </div>

      {itemSections.filter(s => s.items.length > 0).map(s => (
        <div key={s.kind} style={{ marginTop: '0.5rem' }}>
          <div style={{ fontFamily: FONT.mono, fontSize: '0.56rem', color: COLOR.steelDim, marginBottom: '4px' }}>{RECENT_KIND_LABEL[s.kind]} · {s.items.length}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {s.items.slice(0, 20).map(it => (
              <span
                key={it.id}
                onClick={() => onSelect({ kind: it.kind, id: it.id })}
                title={`${it.label}（${it.date}）`}
                style={{
                  cursor: 'pointer', fontSize: '0.64rem', padding: '2px 7px', borderRadius: '999px',
                  background: 'rgba(255,255,255,0.04)', border: `1px solid ${COLOR.line}`, color: COLOR.ink,
                  maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >{it.label}</span>
            ))}
            {s.items.length > 20 && <span style={{ fontSize: '0.6rem', color: COLOR.steelDim, alignSelf: 'center' }}>+{s.items.length - 20}</span>}
          </div>
        </div>
      ))}

      {activity.newNarratives.length > 0 && (
        <div style={{ marginTop: '0.5rem' }}>
          <div style={{ fontFamily: FONT.mono, fontSize: '0.56rem', color: COLOR.steelDim, marginBottom: '4px' }}>新敘事 · {activity.newNarratives.length}</div>
          {activity.newNarratives.slice(0, 6).map((n, i) => (
            <div
              key={`${n.hub}-${n.date}-${i}`}
              onClick={() => onSelect({ kind: n.kind, id: hubNodeId(n.kind, n.hub) })}
              style={{ cursor: 'pointer', fontSize: '0.62rem', color: COLOR.steel, lineHeight: 1.5, marginBottom: '3px' }}
            >
              <span style={{ color: COLOR.amberDim }}>{n.hub}</span>：{n.text.length > 36 ? `${n.text.slice(0, 35)}…` : n.text}
            </div>
          ))}
        </div>
      )}

      {activity.refreshedAssessments.length > 0 && (
        <div style={{ marginTop: '0.5rem' }}>
          <div style={{ fontFamily: FONT.mono, fontSize: '0.56rem', color: COLOR.steelDim, marginBottom: '4px' }}>評價剛更新 · {activity.refreshedAssessments.length}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {activity.refreshedAssessments.map(a => (
              <span
                key={a.hub}
                onClick={() => onSelect({ kind: a.kind, id: hubNodeId(a.kind, a.hub) })}
                title={`${a.hub}（${a.date}）`}
                style={{
                  cursor: 'pointer', fontSize: '0.64rem', padding: '2px 7px', borderRadius: '999px',
                  background: 'rgba(255,255,255,0.04)', border: `1px solid ${COLOR.line}`, color: COLOR.ink,
                }}
              >{a.hub}</span>
            ))}
          </div>
        </div>
      )}

      <div
        onClick={onDismiss}
        style={{
          marginTop: '0.65rem', textAlign: 'center', cursor: 'pointer', fontFamily: FONT.mono, fontSize: '0.6rem',
          color: COLOR.amberDim, padding: '0.32rem', border: `1px solid ${COLOR.amberDim}`, borderRadius: '999px',
        }}
      >知道了</div>
    </div>
  )
}

function CenterMessage({ children }: { children: React.ReactNode }) {
  return <div style={{ margin: 'auto', color: COLOR.steelDim, fontSize: '0.8rem' }}>{children}</div>
}
