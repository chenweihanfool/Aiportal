// ─────────────────────────────────────────────
// 關係宇宙的「星系」佈局（2026-10-03，第三版）
//
// 第二版（確定性球面）解決了抖動與亂竄，但核心節點被黃金角「平均」撒在一顆球面上——
// 平均分佈＝沒有結構：沒有群聚、沒有空洞，正式資料（152 人／1016 事件）下看起來是一顆均勻
// 的毛球，沒有宇宙的樣子。這版改成三層、全部仍是確定性的（不跑力學迭代）：
//
//   1. 星系：核心節點之間依「共同的衛星」（例如兩人一起出現的事件數）算關聯，關聯先用
//      √(度數×度數) 正規化（超級樞紐不會把所有人吸成一團），再用標籤傳播分群。每群是一個
//      星系：群內關聯最多的人在中心（星系核），其餘沿兩條對數螺旋臂排開；星系之間留白。
//   2. 恆星系：事件這類「直接相連」的衛星繞著它的錨點恆星公轉（克卜勒式：越外圈越慢），
//      案件／物件這類「隔一層」的衛星繞在更外圈。錨點選關聯最少的那位參與者——兩人共同的
//      事件歸給比較少出現的那位，超級樞紐才不會把全部事件都吸過去。
//   3. 星系本身緩慢自轉；落單的恆星（沒有任何共同關聯）散在外圍成為「野星」，完全沒有錨點
//      的節點在最外層暈。
//
// 每個節點的位置都是「時間的函式」（見 positionAt），所以每幀成本只跟節點數成正比；畫面
// 端再用阻尼彈簧追這個目標（見 RelationshipUniverse.tsx），運動看起來有慣性但永遠不會發散。
// ─────────────────────────────────────────────

export type Vec3 = [number, number, number]

export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/** 黃金角螺旋撒點：n 個方向盡量均勻分佈在單位球面上，完全確定性。 */
export function fibDir(i: number, n: number): Vec3 {
  const y = n <= 1 ? 0 : 1 - (2 * i) / (n - 1)
  const r = Math.sqrt(Math.max(0, 1 - y * y))
  const theta = GOLDEN_ANGLE * i
  return [Math.cos(theta) * r, y, Math.sin(theta) * r]
}

/** 給定單位向量 u，回傳與它正交的兩個單位向量（u、a、b 構成右手座標系）。 */
export function orthoBasis(ux: number, uy: number, uz: number): [number, number, number, number, number, number] {
  const hx = Math.abs(uy) < 0.9 ? 0 : 1
  const hy = Math.abs(uy) < 0.9 ? 1 : 0
  let ax = -uz * hy, ay = uz * hx, az = ux * hy - uy * hx
  const al = Math.hypot(ax, ay, az) || 1
  ax /= al; ay /= al; az /= al
  const bx = uy * az - uz * ay, by = uz * ax - ux * az, bz = ux * ay - uy * ax
  return [ax, ay, az, bx, by, bz]
}

/** 由字串算出的穩定亂數（0~1）：同一個 id 永遠拿到同一個值，重算不會閃動。 */
export function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

export interface LayoutNode { id: string; kind: string }

export interface Galaxy {
  /** 星系核（群內關聯最多的核心節點）的 id，也用來穩定地決定色相與傾角 */
  hub: string
  center: Vec3
  /** 星系盤面的兩個基底向量與法向量 */
  u: Vec3; v: Vec3; n: Vec3
  radius: number
  /** 自轉角速度（rad/s，帶正負號＝轉向） */
  omega: number
  /** 星雲光的色相（冷色系，0~360） */
  hue: number
  members: number
}

export type Motion =
  | { type: 'fixed'; p: Vec3 }
  /** 星系盤面上的極座標：半徑、初始角、離盤面高度；角度隨星系自轉 */
  | { type: 'disk'; g: number; r: number; theta: number; h: number }
  /** 繞錨點公轉：軌道半徑、軌道面基底、初相、角速度 */
  | { type: 'orbit'; anchor: string; r: number; u: Vec3; v: Vec3; phase: number; omega: number }

export interface GalaxyLayout {
  galaxies: Galaxy[]
  motions: Map<string, Motion>
  /** 背景節點（畫得淡、小，不算進鏡頭框）：與任何核心都無關的節點；hub 模式下另含未成星系的核心與它們的衛星 */
  faint: Set<string>
  /** 宇宙最外緣的半徑（鏡頭自動框住用） */
  worldRadius: number
}

// 幾何常數（世界座標單位；鏡頭會自動框住，所以只有比例有意義）
const GALAXY_SCALE = 22          // 星系半徑 ∝ √(成員＋衛星)
const ORBIT_BASE = 10            // 第一圈衛星離恆星的距離
const ORBIT_STEP = 5             // 衛星軌道半徑 ∝ √(第幾顆)
const INDIRECT_ORBIT_FACTOR = 1.25 // 每多隔一層，軌道放大 25%（最多 3 層）
const KEPLER = 20                // ω = KEPLER / r^1.5（r=30 時約 50 秒一圈）
const MAX_ORBIT_OMEGA = 0.35     // 最內圈不要轉得像電風扇
const MAX_PAIR_FANOUT = 30       // 單一衛星的核心鄰居太多時只取前幾位算共現，避免 O(n²)
const MIN_GALAXY = 3             // 少於 3 位的群不成星系，成員當野星
const MAX_GALAXIES = 18
const MIN_GALAXY_COUNT = 2
const MIN_GALAXY_COVERAGE = 0.6
const MAX_LARGEST_SHARE = 0.85
const LPA_ROUNDS = 24
const MAX_ANCHOR_LEVEL = 5
const HUB_MAX_ANCHOR_LEVEL = 2
const MAX_HUB_GALAXIES = 30      // hub 模式最多幾個星系（物件可能上百個，只讓衛星最多的幾十個自成星系，其餘當野星）
const MIN_HUB_MASS = 3           // 至少要有 2 顆衛星才自成星系，否則只是一顆孤星

// 星雲色相：只用冷色（藍、靛、紫、青、藍綠），刻意避開琥珀——琥珀在這張圖上專門代表「目前的核心」
const HUES = [222, 252, 282, 198, 172, 236, 300, 208]

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * 算出星系佈局。核心是事件（上千個、彼此沒有「共同衛星」的語意）或核心太少時回 null，
 * 由呼叫端退回原本的球面佈局。
 */
export interface GalaxyLayoutOptions {
  /** 'cluster'（預設）：核心依共同衛星分群，一群一個星系（人為核心用）。
   *  'hub'：每個核心各自是一個星系的中心，它的衛星圍繞著它（案件／物件為核心用：一個事件通常只屬於
   *  一個案件，案件之間分不出群，但「每個案件自成一個星系、相關事件與人物繞著它」正是要看的東西）。 */
  mode?: 'cluster' | 'hub'
}

export function galaxyLayout(
  nodes: LayoutNode[],
  neighbors: Map<string, Set<string>>,
  coreKind: string,
  options: GalaxyLayoutOptions = {},
): GalaxyLayout | null {
  const hubMode = options.mode === 'hub'
  if (coreKind === 'event') return null
  const cores = nodes.filter(n => n.kind === coreKind).map(n => n.id).sort(byId)
  // 分群模式要夠多核心才分得出群；hub 模式每個核心自成星系，兩個就有意義
  if (cores.length < (hubMode ? MIN_GALAXY_COUNT : 6)) return null
  const isCore = new Set(cores)

  // ── 1. 衛星與錨點 ─────────────────────────────────────────────
  // 直接衛星：至少連到一個核心。錨點＝關聯最少的那位核心（兩人共同的事件歸給比較少出現的那位）。
  const coreDeg = new Map<string, number>(cores.map(id => [id, 0]))
  const directCoreNbrs = new Map<string, string[]>()
  for (const n of nodes) {
    if (isCore.has(n.id)) continue
    const nb = neighbors.get(n.id)
    if (!nb) continue
    const cs: string[] = []
    for (const id of nb) if (isCore.has(id)) cs.push(id)
    if (cs.length === 0) continue
    cs.sort(byId)
    directCoreNbrs.set(n.id, cs)
    for (const c of cs) coreDeg.set(c, (coreDeg.get(c) ?? 0) + 1)
  }
  const anchorOf = new Map<string, string>()
  const directOf = new Set<string>()
  for (const [sid, cs] of directCoreNbrs) {
    let best = cs[0]
    for (const c of cs) if ((coreDeg.get(c) ?? 0) < (coreDeg.get(best) ?? 0)) best = c
    anchorOf.set(sid, best)
    directOf.add(sid)
  }
  // 間接衛星（案件、物件、概念…經由事件才連到核心）：一層一層往外傳，錨點＝已有錨點的鄰居們最常見的那個。
  // 例如物件為核心時：事件（直接）→ 人物（第 2 層）→ 沒有物件的事件（第 3 層）。每層一次定案，結果與走訪順序無關。
  const levelOf = new Map<string, number>()
  for (const sid of directOf) levelOf.set(sid, 1)
  // hub 模式只收兩層：直接衛星（例：案件的事件）與第 2 層（那些事件的人物、物件）。再往外傳會把
  // 毫不相干、只是剛好有共同人物的事件也掛到案件旁邊，星系就失去「這個案件的相關事物」的意義。
  const maxLevel = hubMode ? HUB_MAX_ANCHOR_LEVEL : MAX_ANCHOR_LEVEL
  for (let level = 2; level <= maxLevel; level++) {
    const assign: Array<[string, string]> = []
    for (const n of nodes) {
      if (isCore.has(n.id) || anchorOf.has(n.id)) continue
      const nb = neighbors.get(n.id)
      if (!nb) continue
      const votes = new Map<string, number>()
      for (const id of nb) {
        const a = anchorOf.get(id)
        if (a) votes.set(a, (votes.get(a) ?? 0) + 1)
      }
      let best: string | null = null, bestV = 0
      for (const [a, v] of [...votes].sort((p, q) => byId(p[0], q[0]))) {
        if (v > bestV || (v === bestV && best !== null && (coreDeg.get(a) ?? 0) < (coreDeg.get(best) ?? 0))) { best = a; bestV = v }
      }
      if (best) assign.push([n.id, best])
    }
    if (assign.length === 0) break
    for (const [id, a] of assign) { anchorOf.set(id, a); levelOf.set(id, level) }
  }

  // 每位核心的衛星（直接的在內圈、越外層的在越外圈）
  const satsOf = new Map<string, string[]>()
  for (const [sid, a] of anchorOf) {
    const arr = satsOf.get(a)
    if (arr) arr.push(sid)
    else satsOf.set(a, [sid])
  }
  for (const arr of satsOf.values()) arr.sort((p, q) => (levelOf.get(p) ?? 9) - (levelOf.get(q) ?? 9) || byId(p, q))
  const massOf = (id: string) => 1 + (satsOf.get(id)?.length ?? 0)
  const degOf = (id: string) => Math.max(1, coreDeg.get(id) ?? 0)

  // ── 2＋3. 核心之間的關聯 → 分群。先只用直接共現；分不出結構才加上隔一層的共現再試一次 ──
  // （人為核心時隔一層會把各圈子經由共用物件全部連成一團，反而分不出來；案件／物件為核心時則幾乎
  // 只有隔一層的共現：一個事件通常只屬於一個案件。）
  const clustering = hubMode
    ? hubGalaxies(cores, massOf)
    : clusterCores(nodes, neighbors, cores, isCore, directCoreNbrs, degOf, massOf, false)
      ?? clusterCores(nodes, neighbors, cores, isCore, directCoreNbrs, degOf, massOf, true)
  if (!clustering) return null
  const { galaxyGroups, fieldStars } = clustering

  // ── 4. 星系幾何 ───────────────────────────────────────────────
  const motions = new Map<string, Motion>()
  const galaxies: Galaxy[] = []
  // hub 模式的星系只有一顆恆星，大小＝它最外圈衛星的軌道（星雲光與星系間距都跟著它）
  const radii = galaxyGroups.map(g => (hubMode
    ? (ORBIT_BASE + ORBIT_STEP * Math.sqrt(g.mass)) * INDIRECT_ORBIT_FACTOR * 1.4
    : GALAXY_SCALE * Math.sqrt(g.mass)))
  const r0 = radii[0] ?? 0
  const rOther = radii.length > 1 ? Math.max(...radii.slice(1)) : r0
  const k = galaxyGroups.length
  // 其餘星系撒在以最大星系為中心的球殼上：殼半徑要讓「最大星系不撞到別人」且「相鄰星系彼此不重疊」
  const angularGap = k > 1 ? Math.sqrt((4 * Math.PI) / (k - 1)) : 1
  const webR = k > 1 ? Math.max((r0 + rOther) * 1.2 + 30, (2.1 * rOther) / Math.min(1.6, angularGap)) : 0

  galaxyGroups.forEach((g, gi) => {
    const hub = g.members[0]
    let center: Vec3 = [0, 0, 0]
    if (gi > 0) {
      const d = fibDir(gi - 1, Math.max(1, k - 1))
      const dist = webR * (0.88 + hash01(`${hub}d`) * 0.24)
      center = [d[0] * dist, d[1] * dist, d[2] * dist]
    }
    // 盤面傾角：由星系核的 id 決定，避免所有星系都同一個平面（看起來像一疊盤子）
    const nDir = fibDir(Math.floor(hash01(`${hub}n`) * 97), 97)
    const [ax, ay, az, bx, by, bz] = orthoBasis(nDir[0], nDir[1], nDir[2])
    const period = 260 + hash01(`${hub}w`) * 160
    const radius = radii[gi]
    galaxies.push({
      hub, center, u: [ax, ay, az], v: [bx, by, bz], n: nDir, radius,
      omega: ((hash01(`${hub}s`) < 0.5 ? -1 : 1) * 2 * Math.PI) / period,
      hue: HUES[gi % HUES.length], members: g.members.length,
    })
    const m = g.members.length
    const arms = m >= 10 ? 2 : 1
    g.members.forEach((id, i) => {
      if (i === 0) { motions.set(id, { type: 'disk', g: gi, r: 0, theta: 0, h: 0 }); return }
      const frac = i / Math.max(1, m - 1)
      const r = radius * (0.2 + 0.8 * Math.sqrt(frac))
      // 對數螺旋臂：角度隨半徑的對數增加；加一點由 id 決定的抖動，臂才不會像畫出來的曲線
      const arm = i % arms
      const theta = (arm * 2 * Math.PI) / arms + 4.6 * Math.log(1 + (4 * r) / radius) + (hash01(`${id}t`) - 0.5) * 0.45
      const h = (hash01(`${id}h`) - 0.5) * radius * 0.12
      motions.set(id, { type: 'disk', g: gi, r, theta, h })
    })
  })

  // 野星：散在星系網外圍（不屬於任何星系、但自己可能帶著衛星）
  const fieldR = Math.max(webR, r0) * 1.3 + 60
  // hub 模式的野星（衛星太少、未自成星系的案件／物件，物件可能上百個）放到更外面當背景，不跟星系搶畫面
  const fieldDist = hubMode ? fieldR * 2.2 : fieldR
  fieldStars.forEach((id, i) => {
    const d = fibDir(i, fieldStars.length)
    const dist = fieldDist * (0.9 + hash01(`${id}f`) * 0.25)
    motions.set(id, { type: 'fixed', p: [d[0] * dist, d[1] * dist, d[2] * dist] })
  })

  // ── 5. 衛星軌道 ───────────────────────────────────────────────
  const galaxyOfCore = new Map<string, number>()
  galaxyGroups.forEach((g, gi) => g.members.forEach(id => galaxyOfCore.set(id, gi)))
  let maxReach = 0
  for (const [a, sats] of satsOf) {
    const gi = galaxyOfCore.get(a)
    const base = gi !== undefined ? galaxies[gi] : null
    sats.forEach((sid, idx) => {
      // 越外層（隔越多層才連到恆星）的衛星繞得越遠
      const level = levelOf.get(sid) ?? 1
      const r = (ORBIT_BASE + ORBIT_STEP * Math.sqrt(idx + 1)) * (1 + (INDIRECT_ORBIT_FACTOR - 1) * Math.min(3, level - 1))
      // 軌道面：在星系盤面附近小幅傾斜（像行星系）；野星的衛星用各自的隨機平面
      let u: Vec3, v: Vec3
      if (base) {
        const tilt = (hash01(`${sid}i`) - 0.5) * (hubMode ? 0.35 : 0.7)
        const c = Math.cos(tilt), s = Math.sin(tilt)
        u = base.u
        v = [base.v[0] * c + base.n[0] * s, base.v[1] * c + base.n[1] * s, base.v[2] * c + base.n[2] * s]
      } else {
        const d = fibDir(Math.floor(hash01(`${a}p`) * 61), 61)
        const [ax, ay, az, bx, by, bz] = orthoBasis(d[0], d[1], d[2])
        u = [ax, ay, az]; v = [bx, by, bz]
      }
      const omega = Math.min(MAX_ORBIT_OMEGA, KEPLER / Math.pow(r, 1.5)) * (base && base.omega < 0 ? -1 : 1)
      motions.set(sid, { type: 'orbit', anchor: a, r, u, v, phase: hash01(`${sid}ph`) * 2 * Math.PI, omega })
      if (r > maxReach) maxReach = r
    })
  }

  // ── 6. 完全沒有錨點的節點：最外層暈 ─────────────────────────────────
  const loose = nodes.filter(n => !motions.has(n.id)).map(n => n.id).sort(byId)
  const haloR = fieldR * 1.25 + maxReach
  loose.forEach((id, i) => {
    const d = fibDir(i, loose.length)
    const dist = haloR * (0.94 + hash01(`${id}o`) * 0.12)
    motions.set(id, { type: 'fixed', p: [d[0] * dist, d[1] * dist, d[2] * dist] })
  })

  // 鏡頭框住「大部分節點所在的範圍」（離中心距離的第 92 百分位），不是最遠那幾顆：外圍稀疏的野星、
  // 暈、遠處的小星系落在畫面邊緣或框外，像遠方的星；否則為了框住零星幾個點，主體會被縮成中央一小團。
  const tmp: Vec3 = [0, 0, 0]
  const pos = new Map<string, Vec3>()
  for (const [id, m] of motions) if (m.type !== 'orbit') { positionAt(m, 0, galaxies, () => undefined, tmp); pos.set(id, [tmp[0], tmp[1], tmp[2]]) }
  const dists: number[] = []
  const faint = new Set(loose)
  if (hubMode) {
    const fieldSet = new Set(fieldStars)
    for (const id of fieldStars) faint.add(id)
    for (const [sid, a] of anchorOf) if (fieldSet.has(a)) faint.add(sid)
  }
  for (const [id, m] of motions) {
    if (faint.has(id)) continue // 背景節點不算進鏡頭框（hub 模式下常有上百個與任何星系都無關的節點）
    if (m.type === 'orbit') positionAt(m, 0, galaxies, a => pos.get(a), tmp)
    else { const p = pos.get(id) as Vec3; tmp[0] = p[0]; tmp[1] = p[1]; tmp[2] = p[2] }
    dists.push(Math.hypot(tmp[0], tmp[1], tmp[2]))
  }
  dists.sort((a, b) => a - b)
  const p92 = dists.length > 0 ? dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.92))] : 0
  return { galaxies, motions, faint, worldRadius: Math.max(p92 * 1.08, 120) }
}

/** hub 模式：每個衛星夠多的核心各自成為一個星系（成員只有它自己），依衛星數排序、最多 MAX_HUB_GALAXIES 個；
 *  其餘核心當外圍野星。少於兩個星系就回 null（交給呼叫端退回）。 */
function hubGalaxies(cores: string[], massOf: (id: string) => number): Clustering | null {
  const ranked = cores
    .filter(id => massOf(id) >= MIN_HUB_MASS)
    .sort((a, b) => massOf(b) - massOf(a) || byId(a, b))
    .slice(0, MAX_HUB_GALAXIES)
  if (ranked.length < MIN_GALAXY_COUNT) return null
  const inGalaxy = new Set(ranked)
  return {
    galaxyGroups: ranked.map(id => ({ members: [id], mass: massOf(id) })),
    fieldStars: cores.filter(id => !inGalaxy.has(id)),
  }
}

interface Clustering { galaxyGroups: Array<{ members: string[]; mass: number }>; fieldStars: string[] }

/**
 * 核心之間的關聯（共同衛星＋直接相連，可選隔一層），以 √(度數×度數) 正規化（超級樞紐不會把所有人吸成一團），
 * 再用標籤傳播分群（確定性：固定順序、固定的平手規則）。分不出像樣的結構時回 null：
 * 少於兩個星系、落單的核心過半、或最大的一群吃掉幾乎全部（那只是一團，不是星系網）。
 */
function clusterCores(
  nodes: LayoutNode[], neighbors: Map<string, Set<string>>, cores: string[], isCore: Set<string>,
  directCoreNbrs: Map<string, string[]>, degOf: (id: string) => number, massOf: (id: string) => number, twoHop: boolean,
): Clustering | null {
  const weight = new Map<string, Map<string, number>>()
  const addW = (a: string, b: string, w: number) => {
    if (a === b) return
    const ma = weight.get(a) ?? new Map<string, number>(); ma.set(b, (ma.get(b) ?? 0) + w); weight.set(a, ma)
    const mb = weight.get(b) ?? new Map<string, number>(); mb.set(a, (mb.get(a) ?? 0) + w); weight.set(b, mb)
  }
  for (const cs of directCoreNbrs.values()) {
    const list = cs.length > MAX_PAIR_FANOUT ? cs.slice(0, MAX_PAIR_FANOUT) : cs
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) addW(list[i], list[j], 1)
  }
  for (const c of cores) {
    for (const id of neighbors.get(c) ?? []) if (isCore.has(id) && c < id) addW(c, id, 2)
  }
  if (twoHop) {
    for (const n of nodes) {
      if (isCore.has(n.id) || directCoreNbrs.has(n.id)) continue
      const reach = new Set<string>()
      for (const id of neighbors.get(n.id) ?? []) for (const c of directCoreNbrs.get(id) ?? []) reach.add(c)
      if (reach.size < 2) continue
      const list = [...reach].sort(byId).slice(0, MAX_PAIR_FANOUT)
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) addW(list[i], list[j], 0.5)
    }
  }
  for (const [a, m] of weight) for (const [b, w] of m) m.set(b, w / Math.sqrt(degOf(a) * degOf(b)))

  const order = cores.slice().sort((a, b) => degOf(b) - degOf(a) || byId(a, b))
  const label = new Map<string, string>(cores.map(id => [id, id]))
  for (let round = 0; round < LPA_ROUNDS; round++) {
    let changed = false
    for (const id of order) {
      const m = weight.get(id)
      if (!m || m.size === 0) continue
      const score = new Map<string, number>()
      for (const [nb, w] of m) {
        const l = label.get(nb) as string
        score.set(l, (score.get(l) ?? 0) + w)
      }
      const cur = label.get(id) as string
      let best = cur, bestS = score.get(cur) ?? 0
      for (const [l, sc] of [...score].sort((p, q) => byId(p[0], q[0]))) {
        if (sc > bestS + 1e-12) { best = l; bestS = sc }
      }
      if (best !== cur) { label.set(id, best); changed = true }
    }
    if (!changed) break
  }
  const groups = new Map<string, string[]>()
  for (const id of order) {
    const l = label.get(id) as string
    const g = groups.get(l)
    if (g) g.push(id)
    else groups.set(l, [id])
  }

  // 星系成員依「在群內的關聯總和」排序：最中心的那位當星系核
  const ranked = [...groups.values()]
    .filter(g => g.length >= MIN_GALAXY)
    .map(g => {
      const inG = new Set(g)
      const strength = (id: string) => {
        let s = 0
        for (const [nb, w] of weight.get(id) ?? []) if (inG.has(nb)) s += w
        return s
      }
      const members = g.slice().sort((a, b) => strength(b) - strength(a) || massOf(b) - massOf(a) || byId(a, b))
      return { members, mass: members.reduce((s, id) => s + massOf(id), 0) }
    })
    .sort((a, b) => b.mass - a.mass || byId(a.members[0], b.members[0]))
  const galaxyGroups = ranked.slice(0, MAX_GALAXIES)
  const covered = galaxyGroups.reduce((s, g) => s + g.members.length, 0)
  if (galaxyGroups.length < MIN_GALAXY_COUNT) return null
  if (covered < cores.length * MIN_GALAXY_COVERAGE) return null
  if (galaxyGroups[0].members.length > covered * MAX_LARGEST_SHARE) return null
  const inGalaxy = new Set(galaxyGroups.flatMap(g => g.members))
  return { galaxyGroups, fieldStars: cores.filter(id => !inGalaxy.has(id)) }
}

/**
 * 某個節點在時間 t（秒）的位置，寫進 out。軌道型需要錨點目前的位置：呼叫端先算完所有
 * 非軌道節點，再算軌道節點（錨點一定是核心，核心一定不是軌道型）。
 */
export function positionAt(m: Motion, t: number, galaxies: Galaxy[], anchorPos: (id: string) => Vec3 | undefined, out: Vec3): void {
  if (m.type === 'fixed') { out[0] = m.p[0]; out[1] = m.p[1]; out[2] = m.p[2]; return }
  if (m.type === 'disk') {
    const g = galaxies[m.g]
    const ang = m.theta + g.omega * t
    const c = Math.cos(ang) * m.r, s = Math.sin(ang) * m.r
    out[0] = g.center[0] + g.u[0] * c + g.v[0] * s + g.n[0] * m.h
    out[1] = g.center[1] + g.u[1] * c + g.v[1] * s + g.n[1] * m.h
    out[2] = g.center[2] + g.u[2] * c + g.v[2] * s + g.n[2] * m.h
    return
  }
  const a = anchorPos(m.anchor) ?? [0, 0, 0]
  const ang = m.phase + m.omega * t
  const c = Math.cos(ang) * m.r, s = Math.sin(ang) * m.r
  out[0] = a[0] + m.u[0] * c + m.v[0] * s
  out[1] = a[1] + m.u[1] * c + m.v[1] * s
  out[2] = a[2] + m.u[2] * c + m.v[2] * s
}
