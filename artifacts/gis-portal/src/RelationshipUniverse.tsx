// ─────────────────────────────────────────────
// 事人物三實體關係宇宙 — 獨立全頁 3D 關係圖（2026-09-16）
//
// 取代原本 HERMES 戰情室裡那張平面、有邊框、只有人-事兩種節點的小面板
// （那張圖還留著，縮成摘要卡＋連結進來這裡）。這裡是真正的深入探索頁：
// 四種節點（人／事／案件／物件）、四種邊（人↔事／事↔案件／事↔物件／
// 人↔人），可以切換「以哪種類型為核心」重新佈局，畫面是可拖拉旋轉的假 3D
// 球體——不是重新引入 three.js（這個專案先前特地把 three.js 拔掉去做扁平
// 儀表板風格），是純 canvas + 手刻的簡化 3D 力學模擬（node 有 x/y/z，
// charge/link/radial 三種力都是 d3-force 同一套概念的 3D 版本，只是自己重
// 寫成不靠任何 3D 函式庫的最小實作）加透視投影：
//   - 節點被 forceRadial 風格的力往「以核心類型為準的目標半徑」拉，核心類
//     型的目標半徑小（離鏡頭近＝視覺上放大）、其餘類型目標半徑大，配合彼
//     此的斥力自然散開成一個球殼分佈，形狀跟拿掉方框的孤立節點圓環是同一
//     招數的立體版。
//   - 每幀依目前的旋轉角度把 3D 座標投影回 2D 螢幕座標，遠端（transformed
//     z 大）節點的 scale 變小，opacity 也跟著降到接近透明（自動淡出），
//     近端節點維持不透明——這就是「超過一定範圍自動淡出」的球體宇宙感。
//   - 節點一律 fillStyle 畫實心圓，不畫 stroke，無邊框；選取狀態用變色/
//     放大表示，不是外框。
// ─────────────────────────────────────────────
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { COLOR, FONT } from './theme'
import {
  apiFetchHermesGraph,
  type HermesGraphData,
  type HermesGraphEventNode,
} from './hermesGraphApi'

type CoreKind = 'person' | 'event' | 'object'
type NodeKind = 'person' | 'event' | 'case' | 'object'

interface UNode {
  id: string
  kind: NodeKind
  label: string
  baseRadius: number
  eventCount: number
  // 3D 模擬狀態——直接 mutate 這些欄位，不整包 setState（跟既有 2D 圖同一
  // 套「用 ref 存、tick 計數器觸發重繪」的效能考量）。
  x: number; y: number; z: number
  vx: number; vy: number; vz: number
  // 投影後的螢幕座標／視覺屬性，每幀重算，畫圖跟點擊命中測試都讀這裡。
  sx: number; sy: number; screenRadius: number; opacity: number; depth: number
}

interface ULink {
  key: string
  aId: string
  bId: string
}

const WORLD = { core: 100, outer: 360 }
const CAMERA_DISTANCE = 900
const FOCAL_LENGTH = 520
const CHARGE_STRENGTH = -820
const LINK_STRENGTH = 0.016
const LINK_DISTANCE = 60
const RADIAL_STRENGTH = 0.24
const VELOCITY_DECAY = 0.62
const ALPHA_DECAY = 0.992
const ALPHA_MIN = 0.006
const IDLE_ROTATE_SPEED = 0.0009

function nodeColor(kind: NodeKind, isCore: boolean): string {
  if (kind === 'person') return COLOR.amber
  if (kind === 'case') return COLOR.ink
  if (kind === 'object') return isCore ? COLOR.ink : COLOR.steel
  return COLOR.steelDim // event
}

function baseRadiusFor(kind: NodeKind, eventCount: number): number {
  if (kind === 'person') return Math.min(22, 6 + Math.sqrt(eventCount) * 3.6)
  if (kind === 'case') return Math.min(18, 5 + Math.sqrt(eventCount) * 3)
  if (kind === 'object') return Math.min(14, 4 + Math.sqrt(eventCount) * 2.4)
  return 3.2 // event
}

export function RelationshipUniverse({ unlockedPassword, onBack }: { unlockedPassword: string | null; onBack: () => void }) {
  const [data, setData] = useState<HermesGraphData | null>(null)
  const [error, setError] = useState(false)
  const [coreKind, setCoreKind] = useState<CoreKind>('person')
  const [showIsolatedEvents, setShowIsolatedEvents] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selection, setSelection] = useState<{ kind: NodeKind; id: string } | null>(null)
  const [, forceRedraw] = useState(0)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const nodesRef = useRef<UNode[]>([])
  const linksRef = useRef<ULink[]>([])
  const nodeByIdRef = useRef<Map<string, UNode>>(new Map())
  const alphaRef = useRef(1)
  const coreKindRef = useRef<CoreKind>('person')
  const yawRef = useRef(0.6)
  const pitchRef = useRef(-0.25)
  const cameraDistRef = useRef(CAMERA_DISTANCE)
  const draggingRef = useRef(false)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const draggedNodeRef = useRef<UNode | null>(null)
  const sizeRef = useRef({ width: 800, height: 600 })
  const showIsolatedRef = useRef(false)

  useEffect(() => {
    if (!unlockedPassword) return
    apiFetchHermesGraph(unlockedPassword).then(setData).catch(() => setError(true))
  }, [unlockedPassword])

  useEffect(() => { coreKindRef.current = coreKind; alphaRef.current = 1 }, [coreKind])
  useEffect(() => { showIsolatedRef.current = showIsolatedEvents; alphaRef.current = 1 }, [showIsolatedEvents])

  const eventTouchedIds = useMemo(() => {
    // 「孤立事件」＝完全沒有任何邊碰到的事件（無 participants、無 case、無
    // objects）——事人二分圖的孤立節點只看 participants 就夠，四實體圖要
    // 三種邊都算過一遍才是真正孤立，不然一個只掛了案件、沒有人物參與的事
    // 件會被誤判成孤立。
    const g = data?.graph
    if (!g) return new Set<string>()
    const s = new Set<string>()
    for (const e of g.edges) s.add(e.eventId)
    for (const e of g.caseEdges) s.add(e.eventId)
    for (const e of g.objectEdges) s.add(e.eventId)
    return s
  }, [data])

  // 建立節點/連線列表——只在資料或「孤立事件顯示開關」變動時重建，核心類
  // 型切換不重建列表，只換目標半徑（見下面 tick 函式），這樣切換時既有節
  // 點的位置是從目前位置動畫過去，不是整批重新隨機撒點。
  useEffect(() => {
    const g = data?.graph
    if (!g) { nodesRef.current = []; linksRef.current = []; nodeByIdRef.current = new Map(); return }

    const visibleEvents = showIsolatedEvents ? g.events : g.events.filter(e => eventTouchedIds.has(e.id))

    const makeNode = (id: string, kind: NodeKind, label: string, eventCount: number): UNode => {
      const phi = Math.acos(2 * Math.random() - 1)
      const theta = Math.random() * Math.PI * 2
      const r = WORLD.outer * 0.6
      return {
        id, kind, label, eventCount, baseRadius: baseRadiusFor(kind, eventCount),
        x: r * Math.sin(phi) * Math.cos(theta), y: r * Math.sin(phi) * Math.sin(theta), z: r * Math.cos(phi),
        vx: 0, vy: 0, vz: 0, sx: 0, sy: 0, screenRadius: 0, opacity: 1, depth: 0,
      }
    }

    const nodes: UNode[] = [
      ...g.people.map(p => makeNode(`p:${p.name}`, 'person', p.name, p.eventCount)),
      ...visibleEvents.map(e => makeNode(`e:${e.id}`, 'event', e.title, 1)),
      ...g.cases.map(c => makeNode(`c:${c.name}`, 'case', c.name, c.eventCount)),
      ...g.objects.map(o => makeNode(`o:${o.name}`, 'object', o.name, o.eventCount)),
    ]
    const byId = new Map(nodes.map(n => [n.id, n]))

    const links: ULink[] = []
    for (const e of g.edges) if (byId.has(`e:${e.eventId}`)) links.push({ key: `pe:${e.person}|${e.eventId}`, aId: `p:${e.person}`, bId: `e:${e.eventId}` })
    for (const e of g.caseEdges) if (byId.has(`e:${e.eventId}`)) links.push({ key: `ec:${e.eventId}|${e.case}`, aId: `e:${e.eventId}`, bId: `c:${e.case}` })
    for (const e of g.objectEdges) if (byId.has(`e:${e.eventId}`)) links.push({ key: `eo:${e.eventId}|${e.object}`, aId: `e:${e.eventId}`, bId: `o:${e.object}` })
    for (const r of g.personRelations) if (byId.has(`p:${r.from}`) && byId.has(`p:${r.to}`)) links.push({ key: `pp:${r.from}|${r.to}`, aId: `p:${r.from}`, bId: `p:${r.to}` })

    nodesRef.current = nodes
    linksRef.current = links
    nodeByIdRef.current = byId
    alphaRef.current = 1
  }, [data, showIsolatedEvents, eventTouchedIds])

  // ── 一顆手刻的極簡 3D 力學模擬（d3-force 同一套概念的 3D 版本）+ 透視投
  // 影 + 旋轉互動，全部塞在一個 requestAnimationFrame 迴圈裡：alpha 還沒冷
  // 卻前每幀跑一次物理 tick，冷卻後（或使用者正在拖拉節點/旋轉視角時）物
  // 理計算自動變成極輕量，畫面仍持續重繪以套用旋轉/縮放。
  useEffect(() => {
    let raf = 0
    let stopped = false

    function tickPhysics() {
      const nodes = nodesRef.current
      const alpha = alphaRef.current
      if (alpha < ALPHA_MIN) return
      const n = nodes.length
      const fx = new Float64Array(n)
      const fy = new Float64Array(n)
      const fz = new Float64Array(n)

      // Charge：O(n^2) 兩兩互斥，n 在幾百節點的規模下綽綽有餘（見檔頭說
      // 明）；超過約一千節點才需要考慮八分樹近似，目前資料量還不到那個
      // 門檻，先不做，避免過早的複雜度。
      for (let i = 0; i < n; i++) {
        const a = nodes[i]
        for (let j = i + 1; j < n; j++) {
          const b = nodes[j]
          let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
          let distSq = dx * dx + dy * dy + dz * dz
          if (distSq < 1) distSq = 1
          const dist = Math.sqrt(distSq)
          const force = (CHARGE_STRENGTH * alpha) / distSq
          const fxn = (force * dx) / dist, fyn = (force * dy) / dist, fzn = (force * dz) / dist
          fx[i] -= fxn; fy[i] -= fyn; fz[i] -= fzn
          fx[j] += fxn; fy[j] += fyn; fz[j] += fzn
        }
      }

      // Link：彈簧力拉向目標距離，用 id 查表找端點的陣列索引。
      const idxOf = new Map(nodes.map((nd, i) => [nd.id, i]))
      for (const link of linksRef.current) {
        const ai = idxOf.get(link.aId), bi = idxOf.get(link.bId)
        if (ai === undefined || bi === undefined) continue
        const a = nodes[ai], b = nodes[bi]
        let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
        let dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
        const force = ((dist - LINK_DISTANCE) / dist) * LINK_STRENGTH * alpha
        const fxn = force * dx, fyn = force * dy, fzn = force * dz
        fx[ai] += fxn; fy[ai] += fyn; fz[ai] += fzn
        fx[bi] -= fxn; fy[bi] -= fyn; fz[bi] -= fzn
      }

      // Radial：拉向「核心類型近、其餘類型遠」的目標球殼半徑——跟 2D 圖裡
      // 孤立節點用的 forceRadial 是同一招，這裡是每個節點依自己的 kind 決
      // 定目標半徑，而不是固定同一個半徑。
      const core = coreKindRef.current
      for (let i = 0; i < n; i++) {
        const node = nodes[i]
        const target = node.kind === core ? WORLD.core : WORLD.outer
        const dist = Math.sqrt(node.x * node.x + node.y * node.y + node.z * node.z) || 1
        const diff = ((target - dist) / dist) * RADIAL_STRENGTH * alpha
        fx[i] += node.x * diff; fy[i] += node.y * diff; fz[i] += node.z * diff
      }

      for (let i = 0; i < n; i++) {
        const node = nodes[i]
        if (node === draggedNodeRef.current) continue // 拖拉中的節點位置由指標直接控制，不吃物理力
        node.vx = (node.vx + fx[i]) * VELOCITY_DECAY
        node.vy = (node.vy + fy[i]) * VELOCITY_DECAY
        node.vz = (node.vz + fz[i]) * VELOCITY_DECAY
        node.x += node.vx; node.y += node.vy; node.z += node.vz
      }

      alphaRef.current = alpha * ALPHA_DECAY
    }

    function render() {
      if (stopped) return
      tickPhysics()

      if (!draggingRef.current) yawRef.current += IDLE_ROTATE_SPEED
      const yaw = yawRef.current, pitch = pitchRef.current
      const cosY = Math.cos(yaw), sinY = Math.sin(yaw)
      const cosP = Math.cos(pitch), sinP = Math.sin(pitch)
      const cameraDist = cameraDistRef.current
      const { width, height } = sizeRef.current
      const cx = width / 2, cy = height / 2

      const nodes = nodesRef.current
      for (const node of nodes) {
        // yaw（繞 Y 軸）再 pitch（繞 X 軸）——順序固定，避免萬向鎖以外的意
        // 外滾轉，兩個角度分別由水平/垂直拖拉量獨立控制，符合直覺。
        const rx = node.x * cosY - node.z * sinY
        const rz1 = node.x * sinY + node.z * cosY
        const ry = node.y * cosP - rz1 * sinP
        const rz = node.y * sinP + rz1 * cosP

        const perspectiveZ = rz + cameraDist
        const scale = perspectiveZ > 1 ? FOCAL_LENGTH / perspectiveZ : 0
        node.sx = cx + rx * scale
        node.sy = cy + ry * scale
        node.screenRadius = node.baseRadius * scale * (node.kind === coreKindRef.current ? 1.6 : 1)
        node.depth = perspectiveZ

        const nearScale = FOCAL_LENGTH / Math.max(1, cameraDist - WORLD.outer)
        const farScale = FOCAL_LENGTH / (cameraDist + WORLD.outer)
        const t = (scale - farScale) / (nearScale - farScale || 1)
        node.opacity = Math.max(0.05, Math.min(1, 0.05 + t * 0.95))
      }

      draw()
      forceRedraw(v => (v + 1) % 1000000)
      raf = requestAnimationFrame(render)
    }

    function draw() {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const { width, height } = sizeRef.current
      ctx.clearRect(0, 0, width, height)

      const neighborIds = computeNeighborIds(hoveredId ?? selection?.id ?? null)

      // Links first, painter's algorithm 不特別排序連線（連線本身很細，疊
      // 畫順序影響不大），但節點依深度由遠到近排序再畫，確保近端節點蓋在
      // 遠端節點上面，是立體感的關鍵。
      ctx.lineWidth = 1
      for (const link of linksRef.current) {
        const a = nodeByIdRef.current.get(link.aId), b = nodeByIdRef.current.get(link.bId)
        if (!a || !b) continue
        const dimmed = neighborIds ? !(neighborIds.has(a.id) && neighborIds.has(b.id)) : false
        const op = Math.min(a.opacity, b.opacity) * (dimmed ? 0.05 : 0.28)
        ctx.strokeStyle = `rgba(154,164,182,${op})`
        ctx.beginPath()
        ctx.moveTo(a.sx, a.sy)
        ctx.lineTo(b.sx, b.sy)
        ctx.stroke()
      }

      const sorted = [...nodesRef.current].sort((a, b) => b.depth - a.depth)
      for (const node of sorted) {
        const isCore = node.kind === coreKindRef.current
        const dimmed = neighborIds ? !neighborIds.has(node.id) : false
        const isSelected = selection?.id === node.id
        const color = isSelected ? COLOR.amber : nodeColor(node.kind, isCore)
        const op = node.opacity * (dimmed ? 0.12 : 1)
        ctx.globalAlpha = Math.max(0.03, op)
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(node.sx, node.sy, Math.max(0.6, isSelected ? node.screenRadius * 1.3 : node.screenRadius), 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      // 人物節點的標籤——事件/案件/物件節點太多太密，全部上字會糊成一片，
      // 只有人物節點少（幾十個）且是主要導覽入口，維持文字標籤；其餘類型
      // 靠點擊/hover 的詳情卡代替常駐文字。
      ctx.font = `10px ${FONT.mono}`
      ctx.textAlign = 'center'
      for (const node of sorted) {
        if (node.kind !== 'person') continue
        const dimmed = neighborIds ? !neighborIds.has(node.id) : false
        ctx.globalAlpha = Math.max(0.05, node.opacity * (dimmed ? 0.12 : 1))
        ctx.fillStyle = COLOR.ink
        ctx.fillText(node.label, node.sx, node.sy + node.screenRadius + 11)
      }
      ctx.globalAlpha = 1
    }

    function computeNeighborIds(centerId: string | null): Set<string> | null {
      if (!centerId) return null
      const set = new Set<string>([centerId])
      for (const l of linksRef.current) {
        if (l.aId === centerId) set.add(l.bId)
        if (l.bId === centerId) set.add(l.aId)
      }
      return set
    }

    raf = requestAnimationFrame(render)
    return () => { stopped = true; cancelAnimationFrame(raf) }
    // hoveredId/selection 只影響 draw() 內部的高亮判斷，不需要重啟整個
    // rAF 迴圈——故意不放進依賴陣列，draw() 每幀都會讀到當下最新值（透過
    // closure 讀外層 state 在 effect 重跑時才會更新，這裡改用 ref 讀取見
    // 下方 hoveredId/selection 的鏡射 ref）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // hoveredId/selection 給 rAF 迴圈內的 draw() 讀最新值用（迴圈本身只在
  // data 變動時重建，不能靠 effect 的 closure 抓到之後才變動的 state）。
  const hoveredIdRef = useRef<string | null>(null)
  const selectionRef = useRef<typeof selection>(null)
  useEffect(() => { hoveredIdRef.current = hoveredId }, [hoveredId])
  useEffect(() => { selectionRef.current = selection }, [selection])

  // ── Resize：canvas 內部解析度跟著容器實際像素尺寸走，避免模糊或裁切 ──
  useEffect(() => {
    const el = containerRef.current
    const canvas = canvasRef.current
    if (!el || !canvas) return
    const ro = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect
      if (!box) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      sizeRef.current = { width: box.width, height: box.height }
      canvas.width = box.width * dpr
      canvas.height = box.height * dpr
      canvas.style.width = `${box.width}px`
      canvas.style.height = `${box.height}px`
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function hitTest(clientX: number, clientY: number): UNode | null {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left, y = clientY - rect.top
    let best: UNode | null = null
    let bestDepth = Infinity
    for (const node of nodesRef.current) {
      const dx = node.sx - x, dy = node.sy - y
      const r = Math.max(4, node.screenRadius) + 2
      if (dx * dx + dy * dy <= r * r && node.depth < bestDepth) { best = node; bestDepth = node.depth }
    }
    return best
  }

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as Element).setPointerCapture(e.pointerId)
    lastPointerRef.current = { x: e.clientX, y: e.clientY }
    const hit = hitTest(e.clientX, e.clientY)
    if (hit && hit.kind !== 'event') {
      // 人物／案件／物件節點：按住可以拖拉調整位置（釋放物理），純滑鼠
      // 移動（沒按住任何節點）則是旋轉整個宇宙的視角。事件節點數量太多、
      // 半徑太小，不提供拖拉（誤觸機率高，體驗反而變差），只能點擊看詳情。
      draggedNodeRef.current = hit
      alphaRef.current = Math.max(alphaRef.current, 0.3)
    } else {
      draggingRef.current = true
    }
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const last = lastPointerRef.current
    if (!last) { setHoveredId(hitTest(e.clientX, e.clientY)?.id ?? null); return }
    const dx = e.clientX - last.x, dy = e.clientY - last.y
    lastPointerRef.current = { x: e.clientX, y: e.clientY }

    if (draggedNodeRef.current) {
      // 拖拉節點：直接把節點釘在鏡頭前一個固定深度的平面上跟著指標走，用
      // 目前的旋轉反矩陣換算回節點自己的世界座標，鬆手後物理模擬會接手。
      const node = draggedNodeRef.current
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const { width, height } = sizeRef.current
      const cx = width / 2, cy = height / 2
      const scale = node.screenRadius > 0 ? FOCAL_LENGTH / (node.depth || CAMERA_DISTANCE) : FOCAL_LENGTH / CAMERA_DISTANCE
      const targetSx = e.clientX - rect.left, targetSy = e.clientY - rect.top
      const rx = (targetSx - cx) / scale, ry = (targetSy - cy) / scale
      const yaw = yawRef.current, pitch = pitchRef.current
      // 反向套用 pitch 再 yaw（正向轉換順序的逆過程）還原成世界座標，z 分
      // 量維持節點原本的旋轉後深度換算回去，允許在螢幕平面上自由拖拉。
      const rz = node.depth - CAMERA_DISTANCE
      const y0 = ry * Math.cos(pitch) + rz * Math.sin(pitch)
      const z1 = -ry * Math.sin(pitch) + rz * Math.cos(pitch)
      const x0 = rx * Math.cos(yaw) + z1 * Math.sin(yaw)
      const z0 = -rx * Math.sin(yaw) + z1 * Math.cos(yaw)
      node.x = x0; node.y = y0; node.z = z0
      node.vx = 0; node.vy = 0; node.vz = 0
      return
    }

    if (draggingRef.current) {
      yawRef.current += dx * 0.006
      pitchRef.current = Math.max(-1.4, Math.min(1.4, pitchRef.current + dy * 0.006))
    }
  }, [])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const wasDragMove = draggingRef.current
    const draggedNode = draggedNodeRef.current
    draggingRef.current = false
    draggedNodeRef.current = null
    lastPointerRef.current = null

    // 純點擊（沒有明顯拖拉位移）才觸發選取——用 pointerdown 當下 hitTest
    // 到的節點，而不是再 hitTest 一次，避免拖拉一小段後鬆手時指標已經不
    // 在節點正上方而誤判成沒點到。
    if (!wasDragMove && !draggedNode) {
      const hit = hitTest(e.clientX, e.clientY)
      if (hit) setSelection({ kind: hit.kind, id: hit.id })
    } else if (draggedNode) {
      // 拖拉節點時仍可能是「幾乎沒移動的一次點擊」，也當作選取。
      setSelection({ kind: draggedNode.kind, id: draggedNode.id })
    }
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    cameraDistRef.current = Math.max(420, Math.min(1800, cameraDistRef.current + e.deltaY * 0.6))
  }, [])

  const g = data?.graph
  const detail = useMemo(() => {
    if (!selection || !g) return null
    if (selection.kind === 'person') {
      const name = selection.id.slice(2)
      const events = g.edges.filter(e => e.person === name).map(e => g.events.find(ev => ev.id === e.eventId)).filter((e): e is HermesGraphEventNode => !!e)
      return { title: name, subtitle: `人物 · ${events.length} 個關聯事件`, events: events.sort((a, b) => b.date.localeCompare(a.date)) }
    }
    if (selection.kind === 'case') {
      const name = selection.id.slice(2)
      const events = g.caseEdges.filter(e => e.case === name).map(e => g.events.find(ev => ev.id === e.eventId)).filter((e): e is HermesGraphEventNode => !!e)
      const status = g.cases.find(c => c.name === name)?.status
      return { title: name, subtitle: `案件${status ? ` · ${status}` : ''} · ${events.length} 個關聯事件`, events: events.sort((a, b) => b.date.localeCompare(a.date)) }
    }
    if (selection.kind === 'object') {
      const name = selection.id.slice(2)
      const events = g.objectEdges.filter(e => e.object === name).map(e => g.events.find(ev => ev.id === e.eventId)).filter((e): e is HermesGraphEventNode => !!e)
      const objectType = g.objects.find(o => o.name === name)?.objectType
      return { title: name, subtitle: `物件${objectType ? ` · ${objectType}` : ''} · ${events.length} 個關聯事件`, events: events.sort((a, b) => b.date.localeCompare(a.date)) }
    }
    const id = selection.id.slice(2)
    const ev = g.events.find(e => e.id === id)
    if (!ev) return null
    return {
      title: ev.title,
      subtitle: `事件 · ${ev.date}${ev.status ? ` · ${ev.status}` : ''}${ev.case ? ` · 案件：${ev.case}` : ''}`,
      events: [],
    }
  }, [selection, g])

  // 容器／canvas 元素一定要每次都掛載（不能用早期 return 整個跳過），不
  // 然 ResizeObserver／rAF 物理迴圈那兩個 effect 第一次執行時 containerRef/
  // canvasRef 還是 null（早期版本的 bug：loading 狀態時完全不畫 canvas，
  // 等資料到位、canvas 真的掛上去，ResizeObserver 的 effect 依賴陣列是
  // `[]` 不會重跑，canvas 永遠停在瀏覽器預設的 300×150 內部解析度，畫面
  // 座標系統整個對不上，結果是「畫了但畫在看不到的地方」的全白畫面）。
  // 改成無論資料是否就緒都畫出容器＋canvas，未就緒時只疊一層訊息蓋在上
  // 面，ref 掛載時機固定在第一次 render，兩個 effect 才抓得到。
  const ready = !!(unlockedPassword && !error && data && data.available !== false && data.graph)
  const statusMessage = !unlockedPassword
    ? '需要先解鎖私領域才能查看關係宇宙'
    : error
      ? '暫時無法取得資料'
      : (!data || data.available === false || !data.graph)
        ? '資料準備中——collect.ps1 還沒在主機上跑過'
        : null

  const m = data?.metrics
  const graph = data?.graph
  const coreLabel: Record<CoreKind, string> = { person: '人', event: '事', object: '物' }

  return (
    <FullPageShell onBack={onBack}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center', padding: '0.9rem 1.2rem', borderBottom: `1px solid ${COLOR.line}` }}>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {(['person', 'event', 'object'] as CoreKind[]).map(k => (
            <button key={k} type="button" onClick={() => setCoreKind(k)} disabled={!ready} style={{
              padding: '0.4rem 0.9rem', borderRadius: '999px', cursor: ready ? 'pointer' : 'default', fontFamily: FONT.mono, fontSize: '0.72rem', letterSpacing: '0.06em',
              background: coreKind === k ? 'rgba(245,166,35,0.14)' : 'transparent',
              border: `1px solid ${coreKind === k ? COLOR.amberDim : COLOR.line}`,
              color: coreKind === k ? COLOR.amber : COLOR.steelDim, opacity: ready ? 1 : 0.4,
            }}>{coreLabel[k]}為核心</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {ready && m && graph && (
          <>
            <button type="button" onClick={() => setShowIsolatedEvents(v => !v)} style={{
              padding: '0.35rem 0.7rem', borderRadius: '999px', cursor: 'pointer', fontFamily: FONT.mono, fontSize: '0.62rem',
              background: showIsolatedEvents ? 'rgba(245,166,35,0.1)' : 'transparent',
              border: `1px solid ${showIsolatedEvents ? COLOR.amberDim : COLOR.line}`, color: showIsolatedEvents ? COLOR.amber : COLOR.steelDim,
            }}>孤立事件 · {m.eventsCount - (graph.events.filter(e => eventTouchedIds.has(e.id)).length)}</button>
            <div style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steelDim, display: 'flex', gap: '0.9rem' }}>
              <span><span style={{ color: COLOR.amber }}>●</span> 人 {m.peopleCount}</span>
              <span><span style={{ color: COLOR.steelDim }}>●</span> 事 {m.eventsCount}</span>
              <span><span style={{ color: COLOR.ink }}>●</span> 案 {m.casesCount}</span>
              <span><span style={{ color: COLOR.steel }}>●</span> 物 {m.objectsCount}</span>
            </div>
          </>
        )}
      </div>

      <div ref={containerRef} style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none', cursor: draggingRef.current ? 'grabbing' : 'grab' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onWheel={handleWheel}
        />

        {statusMessage && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
            <CenterMessage>{statusMessage}</CenterMessage>
          </div>
        )}

        {ready && detail && (
          <div style={{
            position: 'absolute', left: '1.2rem', bottom: '1.2rem', width: 'min(360px, calc(100% - 2.4rem))',
            padding: '0.8rem 1rem', background: 'rgba(18,19,25,0.92)', border: `1px solid ${COLOR.line}`, borderRadius: '6px',
            backdropFilter: 'blur(4px)',
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
          拖拉旋轉・滾輪縮放・點節點看詳情
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
