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
// ─────────────────────────────────────────────
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { COLOR, FONT } from './theme'
import {
  apiFetchHermesGraph,
  type HermesGraphData,
  type HermesGraphEventNode,
} from './hermesGraphApi'

type NodeKind = 'person' | 'event' | 'case' | 'object'
// 四種實體都能當核心：人/事/物是最早提的三個，案件（脈絡層）同樣是圖上獨
// 立的一種節點，沒有理由排除。
type CoreKind = NodeKind

interface UNode {
  id: string
  kind: NodeKind
  label: string
  baseRadius: number
  eventCount: number
  // 目前座標往目標座標補間；目標座標由 computeLayout 一次算好，不是每幀
  // 被力學推著跑。
  x: number; y: number; z: number
  tx: number; ty: number; tz: number
  // 投影後的螢幕座標／視覺屬性，每幀重算；畫圖跟點擊命中測試都讀這裡。
  sx: number; sy: number; screenRadius: number; opacity: number; depth: number
}

interface ULink { key: string; aId: string; bId: string }

const FOCAL_LENGTH = 620
const DEFAULT_CAMERA_DISTANCE = 900
const MIN_CAMERA_DISTANCE = 480
const MAX_CAMERA_DISTANCE = 2400
const IDLE_ROTATE_SPEED = 0.0007
const POSITION_EASE = 0.09
const PIVOT_EASE = 0.12
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
// 衛星散開的球冠半角：太小會疊在一起，太大就看不出「這群是掛在那個核心
// 節點上」的分群感。
const SATELLITE_CAP = 0.6
// 最遠端節點的不透明度下限。第一版是 0.05（幾乎透明），整張圖因此灰濛濛；
// 0.32 仍然看得出前後深度，但不會讓任何節點糊掉。
const DEPTH_MIN_OPACITY = 0.32

// 核心那一類一律 amber，其餘三類一律中性灰——刻意都不帶橘黃，否則「amber
// ＝目前的核心」這個唯一的顏色語意就被破壞（第一版非核心人物用 amberDim
// 就是這個問題）。三個灰階彼此的明度差夠大，四類同時在畫面上也分得出來。
const NON_CORE_COLOR: Record<NodeKind, string> = {
  person: '#aab4c4',
  event: '#5d6472',
  case: '#8f8f88',
  object: '#74839a',
}

function nodeColor(kind: NodeKind, coreKind: CoreKind): string {
  return kind === coreKind ? COLOR.amber : NON_CORE_COLOR[kind]
}

function baseRadiusFor(kind: NodeKind, eventCount: number): number {
  if (kind === 'person') return Math.min(20, 5.5 + Math.sqrt(eventCount) * 3)
  if (kind === 'case') return Math.min(17, 5 + Math.sqrt(eventCount) * 2.6)
  if (kind === 'object') return Math.min(13, 4 + Math.sqrt(eventCount) * 2.2)
  return 2.8 // event
}

/** 黃金角螺旋撒點：n 個方向盡量均勻分佈在單位球面上，沒有極點擠成一團的
 *  問題，而且完全確定性（同樣的 i/n 永遠得到同一個方向）。 */
function fibDir(i: number, n: number): [number, number, number] {
  const y = n <= 1 ? 0 : 1 - (2 * i) / (n - 1)
  const r = Math.sqrt(Math.max(0, 1 - y * y))
  const theta = GOLDEN_ANGLE * i
  return [Math.cos(theta) * r, y, Math.sin(theta) * r]
}

/** 給定單位向量 u，回傳與它正交的兩個單位向量（u、a、b 構成右手座標
 *  系），用來在「以 u 為中心的球冠」裡擺衛星節點。 */
function orthoBasis(ux: number, uy: number, uz: number): [number, number, number, number, number, number] {
  // 挑一個跟 u 不平行的輔助軸，否則外積會退化成零向量
  const hx = Math.abs(uy) < 0.9 ? 0 : 1
  const hy = Math.abs(uy) < 0.9 ? 1 : 0
  let ax = uy * 0 - uz * hy, ay = uz * hx - ux * 0, az = ux * hy - uy * hx
  const al = Math.hypot(ax, ay, az) || 1
  ax /= al; ay /= al; az /= al
  const bx = uy * az - uz * ay, by = uz * ax - ux * az, bz = ux * ay - uy * ax
  return [ax, ay, az, bx, by, bz]
}

/** 由 id 算出的穩定亂數（0~1），給半徑加一點抖動讓球殼不要像機械格點，
 *  但同一個節點每次重算都拿到同一個值，不會因此閃動。 */
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

/** 算出每個節點的目標座標。核心類型在內層球面、其衛星在外一層的球冠
 *  裡、沒有核心鄰居的在最外層球殼。回傳最外層半徑給深度淡出當基準。 */
function computeLayout(nodes: UNode[], neighbors: Map<string, Set<string>>, coreKind: CoreKind): number {
  const coreNodes = nodes.filter(n => n.kind === coreKind)
  const coreIds = new Set(coreNodes.map(n => n.id))
  // 核心節點數量差很多（案件 12 個 vs 事件 364 個），半徑跟著節點數長，
  // 不然 364 個核心節點擠在同一個小球面上一樣會糊。
  const coreR = Math.max(115, Math.min(265, 70 + Math.sqrt(coreNodes.length) * 14))
  const shellR = coreR + 180
  const outerR = shellR + 130

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
    sats.forEach((s, k) => {
      // sqrt 讓衛星在球冠裡是等面積分佈（均勻鋪滿），不是全擠在中心軸旁
      const spread = SATELLITE_CAP * Math.sqrt((k + 0.5) / m)
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

  return outerR * 1.1
}

export function RelationshipUniverse({ unlockedPassword, onBack }: { unlockedPassword: string | null; onBack: () => void }) {
  const [data, setData] = useState<HermesGraphData | null>(null)
  const [error, setError] = useState(false)
  const [coreKind, setCoreKind] = useState<CoreKind>('person')
  const [showIsolatedEvents, setShowIsolatedEvents] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selection, setSelection] = useState<{ kind: NodeKind; id: string } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
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
  const selectionRef = useRef<{ kind: NodeKind; id: string } | null>(null)
  const yawRef = useRef(0.6)
  const pitchRef = useRef(-0.22)
  const cameraDistRef = useRef(DEFAULT_CAMERA_DISTANCE)
  const draggingRef = useRef(false)
  const pointerDownRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const sizeRef = useRef({ width: 800, height: 600 })

  useEffect(() => { coreKindRef.current = coreKind }, [coreKind])
  useEffect(() => { hoveredIdRef.current = hoveredId }, [hoveredId])
  useEffect(() => { selectionRef.current = selection }, [selection])

  useEffect(() => {
    if (!unlockedPassword) return
    apiFetchHermesGraph(unlockedPassword).then(setData).catch(() => setError(true))
  }, [unlockedPassword])

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
    return s
  }, [data])

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
    const mk = (id: string, kind: NodeKind, label: string, eventCount: number): UNode => ({
      id, kind, label, eventCount, baseRadius: baseRadiusFor(kind, eventCount),
      x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0,
      sx: 0, sy: 0, screenRadius: 0, opacity: 1, depth: 0,
    })

    const nodes: UNode[] = [
      ...g.people.map(p => mk(`p:${p.name}`, 'person', p.name, p.eventCount)),
      ...visibleEvents.map(e => mk(`e:${e.id}`, 'event', e.title, 1)),
      ...g.cases.map(c => mk(`c:${c.name}`, 'case', c.name, c.eventCount)),
      ...g.objects.map(o => mk(`o:${o.name}`, 'object', o.name, o.eventCount)),
    ]
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
    for (const r of g.personRelations) connect(`p:${r.from}`, `p:${r.to}`, `pp:${r.from}|${r.to}`)

    nodesRef.current = nodes
    linksRef.current = links
    nodeByIdRef.current = byId
    neighborsRef.current = neighbors

    worldRadiusRef.current = computeLayout(nodes, neighbors, coreKindRef.current)
    // 初次出現時從中心往外展開，是開場動畫也順便避免所有節點同一幀瞬間
    // 出現在最終位置那種生硬感。
    for (const n of nodes) { n.x = n.tx * 0.25; n.y = n.ty * 0.25; n.z = n.tz * 0.25 }
    setSelection(null)
  }, [data, showIsolatedEvents, eventTouchedIds])

  // 切換核心類型：只重算目標座標，節點自己補間過去。
  useEffect(() => {
    if (nodesRef.current.length === 0) return
    worldRadiusRef.current = computeLayout(nodesRef.current, neighborsRef.current, coreKind)
  }, [coreKind])

  // ── 每幀：補間位置 → 投影 → 畫。沒有任何力學迭代，成本只跟節點數成正
  // 比，幾百個節點也穩定。整個迴圈只掛一次（依賴陣列是空的），所有會變動
  // 的狀態一律透過 ref 讀取——第一版把 hoveredId/selection 直接 closure 進
  // 來，迴圈掛上後就永遠讀到舊值，hover 高亮跟選取變色其實從沒生效過。
  useEffect(() => {
    let raf = 0
    let stopped = false

    function project() {
      const nodes = nodesRef.current
      for (const n of nodes) {
        n.x += (n.tx - n.x) * POSITION_EASE
        n.y += (n.ty - n.y) * POSITION_EASE
        n.z += (n.tz - n.z) * POSITION_EASE
      }

      const sel = selectionRef.current
      const focus = sel ? nodeByIdRef.current.get(sel.id) : null
      const pivot = pivotRef.current
      const targetX = focus ? focus.x : 0
      const targetY = focus ? focus.y : 0
      const targetZ = focus ? focus.z : 0
      pivot.x += (targetX - pivot.x) * PIVOT_EASE
      pivot.y += (targetY - pivot.y) * PIVOT_EASE
      pivot.z += (targetZ - pivot.z) * PIVOT_EASE

      // 選取狀態下停掉自轉：使用者要的是「點到的節點置中不動」，整個場景
      // 同時凍住，看細節時最清楚；取消選取後才恢復自轉。
      if (!draggingRef.current && !focus) yawRef.current += IDLE_ROTATE_SPEED

      const yaw = yawRef.current, pitch = pitchRef.current
      const cosY = Math.cos(yaw), sinY = Math.sin(yaw)
      const cosP = Math.cos(pitch), sinP = Math.sin(pitch)
      const cameraDist = cameraDistRef.current
      const { width, height } = sizeRef.current
      const cx = width / 2, cy = height / 2
      const worldR = worldRadiusRef.current
      const coreNow = coreKindRef.current

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
        n.screenRadius = n.baseRadius * scale * (n.kind === coreNow ? 1.55 : 1)
        n.depth = perspectiveZ
        // 深度直接換算不透明度：最前面 1、最後面 DEPTH_MIN_OPACITY。用 rz
        // 而不是 scale，映射是線性且跟鏡頭距離無關，縮放時不會整張圖一起
        // 變淡。
        const frontness = Math.max(0, Math.min(1, (worldR - rz) / (2 * worldR)))
        n.opacity = DEPTH_MIN_OPACITY + (1 - DEPTH_MIN_OPACITY) * frontness
      }
    }

    function draw() {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const { width, height } = sizeRef.current
      ctx.clearRect(0, 0, width, height)

      const nodes = nodesRef.current
      const byId = nodeByIdRef.current
      const coreNow = coreKindRef.current
      const focusId = hoveredIdRef.current ?? selectionRef.current?.id ?? null
      const selectedId = selectionRef.current?.id ?? null
      const focusSet = focusId ? (neighborsRef.current.get(focusId) ?? new Set<string>()) : null

      const isLit = (id: string) => !focusSet || id === focusId || focusSet.has(id)

      ctx.lineWidth = 1
      for (const link of linksRef.current) {
        const a = byId.get(link.aId), b = byId.get(link.bId)
        if (!a || !b) continue
        const lit = isLit(a.id) && isLit(b.id)
        const op = Math.min(a.opacity, b.opacity) * (lit ? 0.3 : 0.04)
        ctx.strokeStyle = `rgba(150,161,180,${op.toFixed(3)})`
        ctx.beginPath()
        ctx.moveTo(a.sx, a.sy)
        ctx.lineTo(b.sx, b.sy)
        ctx.stroke()
      }

      // 由遠到近畫，近端節點蓋住遠端節點，這是立體感的關鍵
      const sorted = [...nodes].sort((p, q) => q.depth - p.depth)
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
        ctx.fillStyle = selected ? COLOR.amber : nodeColor(n.kind, coreNow)
        ctx.beginPath()
        ctx.arc(n.sx, n.sy, selected ? r * 1.35 : r, 0, Math.PI * 2)
        ctx.fill()
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
        const coreNodes = nodes.filter(n => n.kind === coreNow)
        if (coreNodes.length <= 90) labelled.push(...coreNodes)
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
        if (q.screenRadius !== p.screenRadius) return q.screenRadius - p.screenRadius
        return p.depth - q.depth
      })
      for (const n of priority) {
        if (n.opacity < 0.45 && n.id !== selectedId) continue // 太後面的節點不標，減少雜訊
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
      yawRef.current += (e.clientX - down.x) * 0.006
      pitchRef.current = Math.max(-1.4, Math.min(1.4, pitchRef.current + (e.clientY - down.y) * 0.006))
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
    setSelection(hit ? { kind: hit.kind, id: hit.id } : null)
  }, [hitTest])

  const handlePointerLeave = useCallback(() => {
    pointerDownRef.current = null
    draggingRef.current = false
    setHoveredId(null)
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    cameraDistRef.current = Math.max(MIN_CAMERA_DISTANCE, Math.min(MAX_CAMERA_DISTANCE, cameraDistRef.current + e.deltaY * 0.7))
  }, [])

  const g = data?.graph
  const detail = useMemo(() => {
    if (!selection || !g) return null
    const name = selection.id.slice(2)
    const byDateDesc = (a: HermesGraphEventNode, b: HermesGraphEventNode) => b.date.localeCompare(a.date)
    const lookup = (ids: string[]) => ids
      .map(id => g.events.find(ev => ev.id === id))
      .filter((e): e is HermesGraphEventNode => !!e)
      .sort(byDateDesc)

    if (selection.kind === 'person') {
      const events = lookup(g.edges.filter(e => e.person === name).map(e => e.eventId))
      const related = g.personRelations.filter(r => r.from === name || r.to === name)
      return { title: name, subtitle: `人物 · ${events.length} 個關聯事件${related.length ? ` · ${related.length} 位關係人物` : ''}`, events }
    }
    if (selection.kind === 'case') {
      const events = lookup(g.caseEdges.filter(e => e.case === name).map(e => e.eventId))
      const status = g.cases.find(c => c.name === name)?.status
      return { title: name, subtitle: `案件${status ? ` · ${status}` : ''} · ${events.length} 個關聯事件`, events }
    }
    if (selection.kind === 'object') {
      const events = lookup(g.objectEdges.filter(e => e.object === name).map(e => e.eventId))
      const objectType = g.objects.find(o => o.name === name)?.objectType
      return { title: name, subtitle: `物件${objectType ? ` · ${objectType}` : ''} · ${events.length} 個關聯事件`, events }
    }
    const ev = g.events.find(e => e.id === name)
    if (!ev) return null
    return {
      title: ev.title,
      subtitle: `事件 · ${ev.date}${ev.status ? ` · ${ev.status}` : ''}${ev.case ? ` · 案件：${ev.case}` : ''}`,
      events: [] as HermesGraphEventNode[],
    }
  }, [selection, g])

  const ready = !!(unlockedPassword && !error && data && data.available !== false && data.graph)
  const statusMessage = !unlockedPassword
    ? '需要先解鎖私領域才能查看關係宇宙'
    : error
      ? '暫時無法取得資料'
      : (!data || data.available === false || !data.graph)
        ? '資料準備中——collect.ps1 還沒在主機上跑過'
        : null

  const m = data?.metrics
  const coreLabel: Record<CoreKind, string> = { person: '人', event: '事', object: '物', case: '案件' }
  const isolatedCount = g ? g.events.length - g.events.filter(e => eventTouchedIds.has(e.id)).length : 0

  return (
    <FullPageShell onBack={onBack}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center', padding: '0.9rem 1.2rem', borderBottom: `1px solid ${COLOR.line}` }}>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {(['person', 'event', 'object', 'case'] as CoreKind[]).map(k => (
            <button key={k} type="button" onClick={() => setCoreKind(k)} disabled={!ready} style={{
              padding: '0.4rem 0.9rem', borderRadius: '999px', cursor: ready ? 'pointer' : 'default', fontFamily: FONT.mono, fontSize: '0.72rem', letterSpacing: '0.06em',
              background: coreKind === k ? 'rgba(245,166,35,0.16)' : 'transparent',
              border: `1px solid ${coreKind === k ? COLOR.amber : COLOR.line}`,
              color: coreKind === k ? COLOR.amber : COLOR.steelDim, opacity: ready ? 1 : 0.4,
            }}>{coreLabel[k]}為核心</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {ready && m && (
          <>
            <button type="button" onClick={() => setShowIsolatedEvents(v => !v)} style={{
              padding: '0.35rem 0.7rem', borderRadius: '999px', cursor: 'pointer', fontFamily: FONT.mono, fontSize: '0.62rem',
              background: showIsolatedEvents ? 'rgba(245,166,35,0.1)' : 'transparent',
              border: `1px solid ${showIsolatedEvents ? COLOR.amberDim : COLOR.line}`, color: showIsolatedEvents ? COLOR.amber : COLOR.steelDim,
            }}>孤立事件 · {isolatedCount}</button>
            <div style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steelDim, display: 'flex', gap: '0.9rem' }}>
              <span><span style={{ color: nodeColor('person', coreKind) }}>●</span> 人 {m.peopleCount}</span>
              <span><span style={{ color: nodeColor('event', coreKind) }}>●</span> 事 {m.eventsCount}</span>
              <span><span style={{ color: nodeColor('case', coreKind) }}>●</span> 案 {m.casesCount}</span>
              <span><span style={{ color: nodeColor('object', coreKind) }}>●</span> 物 {m.objectsCount}</span>
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

        {ready && detail && (
          <div style={{
            position: 'absolute', left: '1.2rem', bottom: '1.2rem', width: 'min(380px, calc(100% - 2.4rem))',
            padding: '0.8rem 1rem', background: 'rgba(18,19,25,0.94)', border: `1px solid ${COLOR.line}`, borderRadius: '6px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
              <div style={{ fontSize: '0.82rem', color: COLOR.ink, fontWeight: 600 }}>{detail.title}</div>
              <span onClick={() => setSelection(null)} style={{ cursor: 'pointer', color: COLOR.steelDim, fontSize: '0.85rem', flexShrink: 0 }}>✕</span>
            </div>
            <div style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steelDim, marginTop: '4px' }}>{detail.subtitle}</div>
            {detail.events.length > 0 && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '9rem', overflowY: 'auto' }}>
                {detail.events.map(ev => (
                  <div key={ev.id} onClick={() => setSelection({ kind: 'event', id: `e:${ev.id}` })}
                    style={{ display: 'flex', gap: '8px', alignItems: 'baseline', cursor: 'pointer', fontFamily: FONT.mono, fontSize: '0.68rem' }}>
                    <span style={{ color: COLOR.steelDim, flexShrink: 0 }}>{ev.date}</span>
                    <span style={{ color: COLOR.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ position: 'absolute', right: '1rem', bottom: '1rem', fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, opacity: 0.6, textAlign: 'right', lineHeight: 1.5 }}>
          拖拉旋轉・滾輪縮放・點節點置中看詳情
        </div>
      </div>
    </FullPageShell>
  )
}

function FullPageShell({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: COLOR.panelDeep, display: 'flex', flexDirection: 'column', zIndex: 200 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.7rem 1.2rem', borderBottom: `1px solid ${COLOR.line}` }}>
        <span onClick={onBack} style={{ cursor: 'pointer', color: COLOR.amberDim, fontFamily: FONT.mono, fontSize: '0.72rem', letterSpacing: '0.04em' }}>← 返回儀表板</span>
        <span style={{ color: COLOR.ink, fontSize: '0.82rem', fontWeight: 600 }}>事人物關係宇宙</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  )
}

function CenterMessage({ children }: { children: React.ReactNode }) {
  return <div style={{ margin: 'auto', color: COLOR.steelDim, fontSize: '0.8rem' }}>{children}</div>
}
