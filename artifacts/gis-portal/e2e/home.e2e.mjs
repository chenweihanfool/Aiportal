// 新版首頁（v3，產品預設）真實瀏覽器驗證（手動執行；不在 CI 內，同 board.e2e.mjs／timeline.e2e.mjs 的做法）。
//
// 做什麼：本機靜態伺服器提供 dist/public，Playwright 攔截所有 /api/*，以「假 API」模擬 sites／dashboard／happiness history／
// 知識庫／想法庫／地點／遊記／管線／主機狀態／Ollama 用量，驗證新版首頁（v3：搜尋｜現在用得上｜STATUS 三欄）與各子頁路由：
// 桌面 1440（搜尋列、現在用得上、STATUS、推送卡與回饋）、手機 390／360 的單欄順序與不橫向捲動、警示帶與未解鎖狀態；
// #home 相容；#architecture 知識庫架構頁；#dim/<key> 面向頁；#year 年度回顧。
// 舊版首頁（classic）與 #legacy 已不驗（使用者 2026-11-22：「舊版要退場了 有關舊版的都不要去測試」）。全程不碰任何真實服務。
//
// 執行：
//   BASE_PATH=/ PORT=5174 pnpm --filter @workspace/gis-portal run build
//   PLAYWRIGHT_MODULE_DIR=/path/to/node_modules CHROMIUM_PATH=/path/to/chrome node artifacts/gis-portal/e2e/home.e2e.mjs
// 截圖輸出到 E2E_SHOTS_DIR（預設 /tmp/home-e2e-shots）。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const { chromium } = createRequire((process.env.PLAYWRIGHT_MODULE_DIR || '/opt/node22/lib/node_modules') + '/')('playwright')

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/public')
const SHOTS = process.env.E2E_SHOTS_DIR || '/tmp/home-e2e-shots'
fs.mkdirSync(SHOTS, { recursive: true })
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  let p = path.join(DIST, u.pathname === '/' ? 'index.html' : u.pathname)
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html')
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}`
const PWD = 'tok-test'
const results = []
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`) }

// ── 假資料 ──
const tpDate = (offset = 0) => new Date(Date.now() + 8 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10)
const iso = (agoMs = 0) => new Date(Date.now() - agoMs).toISOString()
const link = (label) => [{ label, url: 'https://example.com' }]
const site = (id, name, subtitle, isPrivate, subsystemId = null) => ({ id, name, subtitle, links: link(name), worldXZ: [0, 0], isPrivate, subsystemId })
const sites = [
  site('s1', '人生進度管理系統', 'Life Progress', true, 'pf-cwh'), site('s2', '健身追蹤', 'Fitness Tracking', true, 'fitnessforge'), site('s3', '任務追蹤系統', '', true, 'vikunja'),
  site('s4', '旅遊生活', '', true, 'travel'), site('s5', '圖根點管理系統', 'Survey Control', false), site('s6', '案件排程系統', 'Case Scheduling', false),
  site('s7', '地籍圖套圖+調整', '', false), site('s8', 'Disk Space Analyzer', '', false), site('s9', 'NEC 地籍檔定位修正工具', '', false), site('s10', 'jpg2jgw', '', false),
]
const hhi = (over = {}) => ({
  subsystemId: 'hhi', name: '幸福指數', isPrivate: true, status: 'ok', errorMessage: null, fetchedAt: iso(60e3),
  data: { displayedScore: 71, baseScore: 74.5, weakestScore: 55, finalScore: 72, weakestComponent: '旅遊生活', isSnapshotFinal: true, usingStaleData: false,
    lifeFreedomScore: 68, fitnessHabitScore: 81, calmScore: 74, mindScore: 79, socialScore: 77, travelScore: 55,
    mindCombined: { score: 72, ideas: 68, report: { date: tpDate(0), total: 80, parts: [{ label: '推進', value: 3, note: '' }] } },
    weights: { lifeFreedomWeight: 0.27, fitnessWeight: 0.18, calmWeight: 0.15, mindWeight: 0.15, socialWeight: 0.13, travelWeight: 0.12 } },
  ...over,
})
// 近 200 天、約每 9 天缺一天；最後 4 天 66→68→70→71（連 3 天上升）
const historyRows = (lastGapDays = 0) => {
  const rows = []
  for (let i = 199; i >= 0; i--) {
    if (i < lastGapDays) continue
    if (i > 4 && i % 9 === 0) continue
    const base = i === 3 ? 66 : i === 2 ? 68 : i === 1 ? 70 : i === 0 ? 71 : 62 + Math.round(8 * Math.sin(i / 7) + 4 * Math.sin(i / 2.3))
    rows.push({ date: tpDate(-i), finalScore: base, displayedScore: base, weakestComponent: '旅遊生活' })
  }
  return rows
}
const graph = (computedAgo = 120e3) => ({ available: true, computedAt: iso(computedAgo), metrics: { peopleCount: 186, eventsCount: 1156, casesCount: 52, objectsCount: 626, avgParticipantsPerEvent: 0.9, orphanEventRatioPct: 51, trueOrphanEventRatioPct: 20, newEventsThisWeek: 23, newPeopleThisWeek: 2, mostActivePerson: null, activeCasesCount: 52, personRelationsCount: 0, conceptsCount: 74, methodsCount: 31 }, graph: { people: [], events: [], cases: [], objects: [], edges: [], caseEdges: [], objectEdges: [], personRelations: [], hubNarratives: [], hubAssessments: [] } })
const CATS = ['系統', '工作改善', '財務', '學習', '生活', '健身', '旅遊', '系統', '工作改善', '系統', '財務', '工作改善']
const ideaItems = CATS.map((category, i) => ({
  id: `IDEA-${String(i + 1).padStart(4, '0')}`, title: i === 0 ? '把 HERMES 的管線健康度做成每週自動體檢報告並推送到手機，異常時附上建議修法' : `想法 ${i + 1}：${category}方面想試試的一件事`,
  category, dimension: null, source: '我', why: '一閃而過但值得記下來', value: 1 + (i % 5), effort: 1 + ((i * 2) % 5),
  status: i % 3 === 2 ? 'done' : i === 1 ? 'doing' : 'new', bornAt: `${tpDate(-i * 5)}T10:00:00+08:00`, lastMentioned: `${tpDate(-i * 3)}T10:00:00+08:00`, mentions: 1, backfill: false, days: [], history: [],
  score: i % 3 === 2 ? null : Math.round((22 - i * 1.5) * 100) / 100, scoreWhy: [`價值 ${1 + (i % 5)} × 可行 3`], weakBoost: false,
}))
const ideas = (over = {}) => ({ available: true, generatedAt: tpDate(), receivedAt: iso(3600e3), weakest: '旅遊生活', ideas: ideaItems, top: ideaItems.filter((i) => i.score !== null).sort((a, b) => b.score - a.score).slice(0, 3).map((i) => i.id),
  weeks: [], mind: null, mindShadow: [], ...over })
const places = Array.from({ length: 26 }, (_, i) => ({ id: `FOOD-${String(i + 1).padStart(4, '0')}`, name: `去過的店 ${i + 1}`, area: '台北 大安', status: i % 5 === 0 ? 'favorite' : 'visited', addedAt: tpDate(-300 + i * 5), visitedAt: tpDate(-200 + i * 5), kind: i % 4 === 0 ? 'sight' : 'food', lat: 25, lng: 121 }))
const food = (list = places) => ({ available: list.length > 0, receivedAt: iso(7200e3), places: list })
const trips = (list) => ({ available: (list?.length ?? 1) > 0, receivedAt: iso(7200e3), trips: list ?? [
  { id: 'tainan-2609', name: '台南三日散步', start: tpDate(-25), end: tpDate(-23), status: 'done', area: '台南', summary: null, cover: null, placeIds: [], days: [] },
  { id: 'taichung-2608', name: '台中兩天一夜', start: tpDate(-70), end: tpDate(-69), status: 'done', area: '台中', summary: null, cover: null, placeIds: [], days: [] },
] })
const layer = (h = 'ok', err = null) => ({ status: 'success', lastRun: '', lastRunTs: Date.now() - 14 * 3600e3, processed: 1, committed: 1, failed: 0, backlog: 0, errorSummary: err, durationSeconds: 60, health: h })
const pipeline = (over = {}) => ({ available: true, computedAt: iso(), layers: { L1: layer(), L2: layer(), L3: { ...layer(), schedule: ['每日 00:10'] }, L4: layer(), L5: layer(), ...over } })
const pusher = (feed, level = 'ok', err = null) => ({ feed, path: null, lastOk: iso(60e3), lastFail: null, lastError: err, ageMin: 3, expectedEveryMin: 10, bytes: 1, okCount: 5, failCount: level === 'ok' ? 0 : 2, level })
const status = (over = {}) => ({ available: true, stale: false, computedAt: iso(), cpuPercent: 5, memPercent: 32, disks: [{ drive: '/opt/data', percentUsed: 38, freeGb: 64, totalGb: 102.9 }], containers: Array.from({ length: 12 }, (_, i) => ({ name: 'c' + i, status: 'running', health: 'healthy' })), scheduledTasks: [], diskAlert: 'ok', storage: [], pushers: [pusher('hermes-graph'), pusher('hermes-usage'), pusher('hermes-ideas')], diskForecast: { basedOnDays: 7, insufficient: false, growthGbPerDay: 0.5, daysUntilFull: 80 }, ...over })
const usage = (fc = {}) => ({ available: true, today: tpDate(), days: [], last7Days: {}, balance: { enteredAt: iso(), balanceUsd: 29.3, capUsd: 60, refillAt: tpDate(14), monthUsedUsd: 50 }, entries: [],
  forecast: { callsPerDay: 1296, callsBasedOnDays: 7, usdPerDay: 2.4, source: 'observed', usdPerCall: 0.002, balanceUsd: 29.3, daysUntilEmpty: 12, emptyDate: tpDate(12), daysToRefill: 14, shortfallUsd: null, level: 'ok', ...fc }, scope: 'x' })

// 近 30 天、含 components（後端新欄位）：每個面向一條走勢；social 第 12～14 天前沒資料（斷線）、travel 只有最後 1 天（不畫線）、calm 最後一天比前一天低
const KEYS = ['lifeFreedom', 'fitness', 'calm', 'mind', 'social', 'travel']
const historyWithComponents = (shape = 'ok') => Array.from({ length: 30 }, (_, k) => {
  const i = 29 - k
  const wave = (a, p, base) => Math.round(base + a * Math.sin((i + p) / 4))
  const c = { lifeFreedom: wave(4, 0, 66) + (i < 10 ? 2 : 0), fitness: 70 + Math.round((29 - i) / 3), calm: i === 0 ? 70 : wave(3, 2, 74), mind: wave(5, 1, 76) + (i === 0 ? 3 : 0), social: i >= 12 && i <= 14 ? null : wave(6, 3, 72), travel: i === 0 ? 55 : null }
  if (shape === 'badshape') return { date: tpDate(-i), finalScore: 70, displayedScore: 70, components: i % 2 ? [] : 'oops' }
  if (shape === 'onepoint') return { date: tpDate(-i), finalScore: 70, displayedScore: 70, components: Object.fromEntries(KEYS.map((key) => [key, i === 0 ? 60 : null])) }
  if (shape === 'absent') return { date: tpDate(-i), finalScore: 70, displayedScore: 70 }
  return { date: tpDate(-i), finalScore: 70, displayedScore: 70, components: c }
})

// ── 新版首頁（v3，2.88.0）用的假資料：現在用得上的四個來源、最近搜尋、搜尋／推送統計、知識頁 feed ──
const feedEnv = (name, payload) => ({ available: true, name, schemaVersion: 1, generatedAt: tpDate(0), receivedAt: iso(), payload })
const v3Data = (name) => {
  const cards5 = name === 'v3-cards5'
  const otd3 = name === 'v3-otd3'
  const match = (id, at) => ({ forDate: tpDate(0), topicId: id, name: `主題 ${id}`, path: ['測量', '鑑界'], published: true, point: '要點一句話', triggers: [{ kind: 'task', title: `任務 ${id}`, due: tpDate(0) }], score: 50, why: `任務「${id}」快到了`, at, matchedBy: 'terms', caseName: null })
  const recall = (id) => ({ topicId: id, name: `回想 ${id}`, path: ['測量'], published: true, point: '去年這時候做過', reason: '去年同一時期做過', lastMonth: '2025-11', years: [2025] })
  return {
    nudges: cards5 ? feedEnv('topic-nudges', { computedAt: iso(), date: tpDate(0), matches: [match('M1', '10:00'), match('M2', '14:00')], recall: [recall('R1'), recall('R2')], resumes: [] }) : null,
    companion: feedEnv('companion', {
      computedAt: iso(), date: tpDate(0), socialDays: [],
      onThisDay: otd3 ? [{ date: `${Number(tpDate(0).slice(0, 4)) - 1}${tpDate(0).slice(4)}`, kind: 'event', title: '去年的今天發生的事' }, { date: `${Number(tpDate(0).slice(0, 4)) - 2}${tpDate(0).slice(4)}`, kind: 'event', title: '前年的今天發生的事' }, { date: `${Number(tpDate(0).slice(0, 4)) - 3}${tpDate(0).slice(4)}`, kind: 'event', title: '三年前的今天發生的事' }] : [],
      quietPeople: cards5 ? [{ name: '阿哲', lastDate: tpDate(-40), daysQuiet: 40, events: 3, usualGapDays: 14 }] : [],
    }),
    personActions: { actions: [] },
    recent: { recent: ['鑑界', '地籍圖', 'HERMES'] },
    searchStats: { days: 7, searches: 12, zero: 3, zeroRate: 0.25, clicked: 6, clickRate: 0.5, topZero: [{ q: '不存在的詞', count: 2 }, { q: '另一個', count: 1 }] },
    pushStats: { days: 14, shown: 20, opened: 8, openRate: 0.4, useful: 5, useless: 3, uselessRate: 0.15, daysWithCards: 9, byKind: [{ kind: 'topic', shown: 12, opened: 6, useless: 1 }, { kind: 'onthisday', shown: 3, opened: 0, useless: 2 }] },
    topics: feedEnv('topics', { computedAt: iso(), total: 2, published: 2, tree: null, topics: [
      { id: 'T1', name: '鑑界流程', kind: 'method', why: '', firstSeen: tpDate(-30), revision: 2, docs: 5, newDocs: 1, monthsSpan: 2, growth: [{ date: tpDate(-2), text: '第一版頁面' }], sources: [], related: [], path: [], monthCounts: [],
        claims: [{ id: 'c1', section: 'what', status: 'active', origin: 'model', pinned: false, firstSeen: tpDate(-1), lastChanged: tpDate(-1), text: '- 一句新的' }, { id: 'c2', section: 'what', status: 'active', origin: 'user', pinned: true, firstSeen: tpDate(-60), lastChanged: tpDate(-60), text: '- 舊句' }],
        claimStats: { active: 2, retired: 0, disputed: 0, user: 1 } },
      { id: 'T2', name: '契約概念', kind: 'concept', why: '', firstSeen: tpDate(-50), revision: 1, docs: 2, newDocs: 0, monthsSpan: 1, growth: [], sources: [], related: [], path: [], monthCounts: [], claimStats: { active: 1, retired: 0, disputed: 0, user: 2 } },
    ] }),
  }
}

// 場景：每個 API 路徑 → 回應（或 'fail' / 'delay'）
function scenario(name) {
  const s = { dashboard: [hhi(), { subsystemId: 'mind-index', name: '心智指標', isPrivate: true, status: 'ok', errorMessage: null, fetchedAt: iso(60e3), data: { score: 72.4, conversion: 90, linkHealth: 80, vitality: 55, rhythm: 66, stale: false } },
  { subsystemId: 'pf-cwh', name: '人生進度管理系統', isPrivate: true, status: 'ok', errorMessage: null, fetchedAt: iso(60e3), data: { totalAssetsTWD: 12345678, twrr: 0.082, mwrr: 0.071, pacingIndex: 0.93, lifeFreedomIndex: 68 } },
  { subsystemId: 'fitnessforge', name: '運動 APP 系統', isPrivate: true, status: 'ok', errorMessage: null, fetchedAt: iso(60e3), data: { weeklyScore: 1234, trendPct: 4.2, balanceScore: 62, coverageScore: 71, activityBonusPoints: 3, muscleComposites: [{ name: '胸', composite: 90 }], habitIndex: 55 } },
  { subsystemId: 'vikunja', name: '任務追蹤系統', isPrivate: true, status: 'ok', errorMessage: null, fetchedAt: iso(60e3), data: { overdueScore: 40, loadScore: 55, stagnationScore: 30, completionScore: 45, busyIndex: 42, stale: false, taskActions: { overdue: 3, dueToday: 2, dueNext7: 5, doneWeek: 7 } } },
  { subsystemId: 'travel', name: '旅遊生活', isPrivate: true, status: 'ok', errorMessage: null, fetchedAt: iso(60e3), data: { daysSinceLastTrip: 24, lastTripEndDate: '2026-09-23', recencyScore: 78, frequencyScore: 40, tripDaysLast180: 8, anticipationBonus: 0, hasUpcomingTrip: false, travelScore: 59 } },
  { subsystemId: 'social-index', name: '社交指標', isPrivate: true, status: 'ok', errorMessage: null, fetchedAt: iso(60e3), data: { observedDayCount: 6, distinctPersonCount: 3, daysWithInteraction: 4, breadthScore: 60, intensityScore: 47, connectionRateScore: 67, socialScore: 55, personNames: ['小明', '阿華'] } }], history: { history: historyRows() }, graph: graph(), ideas: ideas(), food: food(), trips: trips(), pipeline: pipeline(), status: status(), usage: usage(), fail: new Set(), delayMs: 0, history30: null, nudges: null, companion: null, personActions: null, recent: null, searchStats: null, pushStats: null, topics: null }
  if (name.startsWith('v3')) Object.assign(s, v3Data(name), { history30: { history: historyWithComponents('ok') } })
  if (name === 'v3-alert') { s.pipeline = pipeline({ L3: layer('crit', 'apply 失敗：磁碟寫入錯誤') }) }
  if (name === 'alert') {
    s.pipeline = pipeline({ L3: layer('crit', 'apply 失敗：磁碟寫入錯誤') })
    s.usage = usage({ level: 'warn', shortfallUsd: 21.4, daysUntilEmpty: 9, emptyDate: tpDate(9) })
    s.status = status({ pushers: [pusher('hermes-graph'), pusher('hermes-usage', 'crit', 'HTTP 502'), pusher('hermes-ideas')], diskAlert: 'warn', diskForecast: { basedOnDays: 7, insufficient: false, growthGbPerDay: 2, daysUntilFull: 21 } })
  }
  if (name === 'empty') {
    s.history = { history: [] }; s.ideas = ideas({ available: false, ideas: [], top: [] }); s.food = food([]); s.trips = trips([])
  }
  if (name === 'wantfood') {
    s.food = food([{ ...places[0], status: 'want', name: '示範・鱔魚意麵', area: '台南 中西', addedAt: tpDate(-268), visitedAt: null, kind: 'food' }, { ...places[1], kind: 'sight', status: 'want', name: '示範・想去的山', area: '苗栗 三義', addedAt: tpDate(-100), visitedAt: null }, ...places.slice(2)])
  }
  if (name === 'error') { s.fail = new Set(['history', 'graph', 'ideas', 'food', 'trips', 'pipeline', 'repos']) }
  if (name === 'repos-no-token') s.fail = new Set(['repos-no-token'])
  if (name === 'stale') {
    s.dashboard = [hhi({ fetchedAt: iso(120 * 60e3) })]            // 2 小時前（預期 60 分 → 過期）
    s.history = { history: historyRows(3) }                        // 最後一筆 3 天前 → 資料已 >36h
    s.graph = graph(200 * 60e3)                                    // 預期 120 分，200 分 → 過期
  }
  if (name === 'dead') {
    s.dashboard = [hhi({ fetchedAt: iso(5 * 3600e3) })]            // 5 小時 > 3×60 分 → dead
    s.history = { history: historyRows(6) }                        // 6 天前 → 超過 72h
    s.graph = graph(600 * 60e3)                                    // 10 小時 > 3×120 分
  }
  if (name === 'loading') s.delayMs = 2500
  if (name === 'spark') s.history30 = { history: historyWithComponents('ok') }
  if (name === 'spark-bad') s.history30 = { history: historyWithComponents('badshape') }
  if (name === 'spark-one') s.history30 = { history: historyWithComponents('onepoint') }
  if (name === 'spark-fail') s.fail = new Set(['history30'])
  if (name === 'spark-alert') { s.history30 = { history: historyWithComponents('ok') }; s.pipeline = pipeline({ L3: layer('crit', 'apply 失敗：磁碟寫入錯誤') }) }
  return s
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
// 版面：一律用新版首頁（v3，產品預設）；只驗 v3，不驗舊版。localStorage 先寫好，避免受前一個情境影響
async function open(viewport, scn = 'normal', { unlocked = true, hash = '', wait = true, layout = 'v3', expandNow = true } = {}) {
  const S = scenario(scn)
  const ctx = await browser.newContext({ viewport })
  if (unlocked) await ctx.addInitScript((k) => localStorage.setItem('portal_unlocked', k), PWD)
  if (layout) await ctx.addInitScript((v) => { if (localStorage.getItem('hm-layout') === null) localStorage.setItem('hm-layout', v) }, layout)
  const page = await ctx.newPage()
  const errors = []
  const calls = []
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 600)))
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT|ERR_NAME_NOT_RESOLVED|ERR_FAILED|ERR_TUNNEL|50\d|40\d|Failed to load resource/.test(m.text())) errors.push(m.text()) })
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url())
    const p = u.pathname
    calls.push(p)
    const authed = route.request().headers()['x-admin-password'] === PWD
    const json = (o, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(o) })
    if (p === '/api/sites') return json({ sites: authed ? sites.filter((x) => x.subsystemId) : [] })   // 2026-10-22：只回有綁子系統的列，未解鎖回空
    if (p === '/api/dashboard') return json({ summaries: S.dashboard, unlocked: authed })
    if (p === '/api/auth/me') return json({ message: 'none' }, 404)
    if (!authed) return json({ message: 'no' }, 403)
    // 新版首頁（2.88.0）用的端點；場景沒給資料就回 404（＝後端還沒部署，各列自己顯示原因）
    const v3Routes = { '/api/feed/topic-nudges': 'nudges', '/api/feed/companion': 'companion', '/api/companion/person-actions': 'personActions', '/api/search/recent': 'recent', '/api/search/stats': 'searchStats', '/api/push/stats': 'pushStats', '/api/feed/topics': 'topics' }
    if (v3Routes[p]) { calls.push(p === '/api/search/stats' || p === '/api/push/stats' ? `${p}?days=${u.searchParams.get('days')}` : p); return S[v3Routes[p]] ? json(S[v3Routes[p]]) : json({ message: 'none' }, 404) }
    if (p === '/api/push/feedback') { calls.push(`${route.request().method()} ${p}`); try { const b = JSON.parse(route.request().postData() || '{}'); if (b.action) calls.push(`feedback:${b.action}:${b.cardKind}`) } catch { /* 沒有 body 就算了 */ } return route.request().method() === 'POST' ? json({ ok: true }) : json({ suppressed: [], later: [] }) }
    const key = { '/api/happiness/history': 'history', '/api/hermes-graph': 'graph', '/api/hermes-ideas': 'ideas', '/api/hermes-places': 'food', '/api/hermes-trips': 'trips', '/api/hermes-pipeline': 'pipeline', '/api/hermes-status': 'status', '/api/hermes-usage': 'usage' }[p]
    if (key) {
      // 面向頁（#dim/…）與年度回顧（#year…）抓 365 天，假資料用「含 components 的那一份」（首頁的 365 天年熱圖仍用 S.history）
      const k = key === 'history' && (u.searchParams.get('days') === '30' || u.searchParams.get('days') === '90' || (u.searchParams.get('days') === '365' && /#(dim|year)\b/.test(page.url()))) ? 'history30' : key
      calls.push(`${p}?days=${u.searchParams.get('days')}`)
      if (k === 'history30' && S.fail.has('history30')) return json({ message: 'boom' }, 500)
      if (S.delayMs) await new Promise((r) => setTimeout(r, S.delayMs))
      if (S.fail.has(key)) return json({ message: 'boom' }, 500)
      return json(k === 'history30' ? (S.history30 ?? S.history) : S[key])
    }
    if (p === '/api/feed/kb-arch-stats') {
      calls.push(p)
      if (S.fail.has('arch-stats')) return json({ message: 'boom' }, 500)
      if (S.archStatsEmpty) return json({ available: false, name: 'kb-arch-stats', schemaVersion: 1, payload: null, generatedAt: null, receivedAt: null })
      return json({ available: true, name: 'kb-arch-stats', schemaVersion: 1, generatedAt: tpDate(0), receivedAt: iso(), payload: { computedAt: iso(120e3), nodes: {
        L1: { metrics: [{ label: '候選事件（累計）', value: 4321, hint: '佇列內所有天的候選事件' }, { label: '今日新增', value: 12 }, { label: '近 7 天', value: 90 }] },
        L2: { metrics: [{ label: '待正規化', value: 7, hint: '已有候選、還沒被 L2 正規化的候選數' }, { label: '已正規化', value: 3900 }] },
        L4: { error: 'RuntimeError: 找不到收件夾' },
      } } })
    }
    if (p === '/api/feed/vikunja-gantt') {
      if (S.fail.has('gantt')) return json({ message: 'boom' }, 500)
      const d = (n) => tpDate(n)   // 正＝往後幾天、負＝幾天前
      const t = (id, projectId, o) => ({ id, title: `任務 ${id}`, projectId, start: null, end: null, due: null, done: false, doneAt: null, priority: 0, percentDone: 0, ...o })
      return json({ available: true, name: 'vikunja-gantt', schemaVersion: 1, generatedAt: tpDate(0), receivedAt: iso(), payload: {
        computedAt: iso(120e3), baseUrl: 'https://v.example.test', doneDays: 30, undatedOpen: 4, truncated: 0,
        projects: [{ id: 1, title: '工作', color: '#e2584f' }, { id: 2, title: '生活', color: null }, { id: 3, title: '進修', color: '#3fb6a8' }],
        tasks: [
          t(1, 1, { title: '季報資料整理', start: d(-3), end: d(10), percentDone: 40 }),
          t(2, 1, { title: '回覆客戶合約修改意見（很長的標題測試截斷）', due: d(-5), priority: 4 }),
          t(3, 1, { title: '早就逾期的報帳', due: d(-40) }),
          t(4, 2, { title: '牙醫回診', due: d(3) }),
          t(5, 2, { title: '整理書櫃', start: d(1), end: d(20) }),
          t(6, 2, { title: '繳房屋稅', due: d(-2), done: true, doneAt: d(-2) }),
          t(7, 3, { title: '線上課程第三單元', start: d(-10), due: d(60) }),
          t(8, 3, { title: '明年的事', start: d(200) }),
        ],
      } })
    }
    if (p === '/api/paid-services') return json({ deepseek: { status: 'ok', data: { available: true, balances: [{ currency: 'CNY', total: 88.5, granted: 0, toppedUp: 88.5 }] } }, tavily: { status: 'no-key' }, fetchedAt: iso() })
    if (p === '/api/github/repos') {
      if (S.fail.has('repos')) return json({ message: 'boom' }, 502)
      const repo = (name, o = {}) => ({ name, fullName: `chenweihanfool/${name}`, description: null, url: `https://github.com/chenweihanfool/${name}`, private: false, fork: false, archived: false, language: null, topics: [], pushedAt: iso(86400e3), stars: 0, openIssues: 0, defaultBranch: 'main', ...o })
      return json({ status: 'ok', owner: 'chenweihanfool', privateIncluded: !S.fail.has('repos-no-token'), fetchedAt: iso(60e3), ageSec: 60, stale: false, repos: [
        repo('Aiportal', { language: 'TypeScript', description: '入口網', pushedAt: iso(3600e3), homepage: 'https://aiportal.example.test/' }), repo('kb-pipeline', { language: 'Python', private: true, description: '知識庫管線', pushedAt: iso(7200e3) }),
        repo('hermes-control-channel', { language: 'PowerShell', private: true }), repo('old-thing', { archived: true, language: 'Python' }), repo('forked', { fork: true }),
        ...Array.from({ length: 14 }, (_, i) => repo(`extra-${i}`, { language: 'TypeScript' })),
      ] })
    }
    if (p === '/api/hermes-activity') return json({ activity: [] })
    if (p === '/api/hermes-status/history') return json({ history: [] })
    return json({}, 404)
  })
  await page.goto(BASE + '/' + hash)
  if (wait) await page.waitForSelector('.st-home', { timeout: 15000 })
  // 2.99.0：v3 的「現在用得上」收在角落（預設只有一顆小鈕），既有斷言都針對展開後的區塊，所以先按開（未解鎖沒有小鈕就略過）
  if (wait && expandNow) {
    await page.waitForSelector('[data-testid="now-corner-btn"]', { timeout: 3000 }).catch(() => {})
    const corner = page.locator('[data-testid="now-corner-btn"]')
    if ((await corner.count()) > 0) { await corner.click(); await page.waitForSelector('[data-testid="now-section"]', { timeout: 5000 }) }
  }
  return { ctx, page, errors, calls }
}
const settle = async (page, ms = 1700) => { await page.waitForFunction(() => !document.querySelector('.hm-frame[aria-busy="true"]'), null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(ms) }

// ═══ 3c. 知識庫架構頁（#architecture，2026-10-22）═══
{
  const { ctx, page, errors, calls } = await open({ width: 1440, height: 900 }, 'normal', { hash: '#architecture', wait: false })
  await page.waitForSelector('.ar-node', { timeout: 15000 }); await settle(page)
  check('架構頁：五個分層（資料來源、萃取管線、權威儲存、衍生索引、入口網）', (await page.locator('.ar-band').count()) === 5)
  check('架構頁：15 個節點、沒有頁面錯誤', (await page.locator('.ar-node').count()) === 15 && errors.length === 0, errors.join('|'))
  check('架構頁：L1～L5 有健康燈（解鎖後取即時狀態）', (await page.locator('.ar-lamp--corner').count()) === 5)
  await page.locator('.ar-node', { hasText: 'L2 消歧' }).click()
  const flow = await page.locator('.ar-detail').innerText()
  check('架構頁：點 L2 → 上游有 L1、L4、任務系統，下游有 L3', (() => { const [up, down] = flow.split('下游（它餵誰）'); return ['L1 快掃', 'L4 文件', '任務系統'].every((n) => up.includes(n)) && down.includes('L3 入庫') && !down.includes('L1 快掃') })(), flow.replace(/\n/g, '|').slice(0, 200))
  check('架構頁：選取後無關節點淡化（data-rel="none"），上下游有標記', (await page.locator('.ar-node[data-rel="none"]').count()) > 5 && (await page.locator('.ar-node[data-rel="up"]').count()) === 3 && (await page.locator('.ar-node[data-rel="down"]').count()) === 1)
  const retired = await page.locator('[data-testid="ar-retired"]').innerText()
  check('架構頁：LightRAG＋Neo4j 不再是節點，改以「已擱置並移除」說明（含重啟條件）', (await page.locator('.ar-node', { hasText: 'LightRAG' }).count()) === 0 && /已擱置並移除：LightRAG/.test(retired) && /重啟條件/.test(retired) && /embedding/.test(retired))
  check('架構頁：節點卡片顯示真實數字（L1 候選 4,321）', /候選事件（累計）\s*4,321/.test(await page.locator('.ar-node', { hasText: 'L1 快掃' }).innerText()))
  await page.locator('.ar-node', { hasText: 'L1 快掃' }).click()
  check('架構頁：詳情列出 L1 完整數字（近 7 天 90）', /近 7 天\s*90/.test(await page.locator('[data-testid="ar-stats"]').innerText()))
  await page.locator('.ar-node', { hasText: 'L2 消歧' }).click()
  const st = await page.locator('[data-testid="ar-stats"]').innerText()
  check('架構頁：詳情列出完整數字與說明（待正規化 7、已正規化 3,900、怎麼算）', /待正規化\s*7/.test(st) && /已正規化\s*3,900/.test(st) && /還沒被 L2 正規化/.test(st) && !/已過期/.test(st), st)
  await page.locator('.ar-node', { hasText: 'RAW 文件' }).click()
  check('架構頁：沒資料的節點寫「沒有可量的處理數字」', /沒有可量的處理數字/.test(await page.locator('[data-testid="ar-stats"]').innerText()))
  await page.locator('.ar-node', { hasText: 'L4' }).first().click()
  check('架構頁：單一節點算不出來只標該節點（其他數字照常）', /算不出來：RuntimeError/.test(await page.locator('[data-testid="ar-stats"]').innerText()))
  await page.locator('.ar-node', { hasText: 'kb-ledger' }).click()
  check('架構頁：kb-ledger 備註寫明「沒有任何一個 primary」', /沒有任何一個 primary/.test(await page.locator('.ar-detail').innerText()))
  await page.locator('.ar-chip', { hasText: 'Obsidian vault' }).click()
  check('架構頁：點上游晶片可跳到該節點', /Obsidian vault/.test(await page.locator('.ar-detail h2').innerText()))
  check('架構頁：L3 班表來自即時資料（不是手寫）', await (async () => { await page.locator('.ar-node', { hasText: 'L3 入庫' }).click(); return /班表：/.test(await page.locator('.ar-detail').innerText()) })())
  await page.screenshot({ path: path.join(SHOTS, 'architecture-1440x900.png') })
  await page.locator('.ar-back').click()
  await page.waitForSelector('.st-home', { timeout: 10000 })
  check('架構頁：返回 → 回到首頁（hash 清空）', (await page.evaluate(() => location.hash)) === '' && (await page.locator('.st-home').count()) === 1)
  await ctx.close()
}
{
  const { ctx, page, calls } = await open({ width: 1440, height: 900 }, 'normal', { unlocked: false, hash: '#architecture', wait: false })
  await page.waitForSelector('.ar-node', { timeout: 15000 }); await settle(page, 600)
  check('架構頁（未解鎖）：結構照樣顯示，狀態寫「🔒 解鎖後顯示」，不發管線請求、沒有健康燈', (await page.locator('.ar-node').count()) === 15 && (await page.locator('.ar-unlock').count()) === 1 && (await page.locator('.ar-lamp--corner').count()) === 0 && !calls.some((c) => /hermes-pipeline/.test(c)), calls.join(','))
  await ctx.close()
}
{
  const { ctx, page, errors } = await open({ width: 390, height: 844 }, 'normal', { hash: '#architecture', wait: false })
  await page.waitForSelector('.ar-node', { timeout: 15000 }); await settle(page, 600)
  const g = await page.evaluate(() => { const r = document.querySelector('.ar-root'); return { sw: r.scrollWidth, cw: r.clientWidth } })
  check(`架構頁（手機）：不橫向捲動（${g.sw}/${g.cw}）、沒有頁面錯誤`, g.sw <= g.cw + 1 && errors.length === 0, errors.join('|'))
  await page.locator('.ar-node', { hasText: 'L3 入庫' }).click()
  check('架構頁（手機）：點節點後詳情在下方可見', await page.locator('.ar-detail').isVisible())
  await ctx.close()
}
// ═══ 6. 路由：#home 相容、⌘K（全站搜尋）═══
{ // #home：進來就回預設首頁（v3），hash 清掉
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, 'normal', { hash: '#home' })
  check('#home（舊分享連結）：顯示預設首頁（新版 v3），hash 已清掉', (await page.locator('.st-home').count()) === 1 && (await page.evaluate(() => location.hash)) === '', await page.evaluate(() => location.hash))
  check('#home：沒有「預覽版」', !/預覽版/.test(await page.locator('body').innerText()))
  check('#home：沒有頁面錯誤', errors.length === 0, errors.join('|'))
  await ctx.close()
}
// ⌘K：聚焦首頁的全站搜尋框（2.86.0 起取代指令面板）；不驗舊版指令前往的檢查
{
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, 'normal')
  await page.waitForSelector('.st-home')
  await page.keyboard.press('Control+k')
  check('⌘K → 聚焦全站搜尋框（.om-root 內的輸入框）', await page.evaluate(() => document.activeElement?.closest('.om-root') !== null && document.activeElement?.tagName === 'INPUT'))
  await page.fill('.om-root input', '>舊版')
  check('⌘K 輸入「>舊版」→ 指令清單有「舊版首頁」；舊的「新首頁（預覽版）」不在', (await page.locator('.om-root [role="option"]', { hasText: '舊版首頁' }).count()) === 1 && (await page.getByText('新首頁（預覽版）').count()) === 0)
  check('⌘K：沒有頁面錯誤', errors.length === 0, errors.join('|'))
  await ctx.close()
}

// ═══ 7. 面向頁（#dim/<key>）：六個面向各有自己的頁，不是同一個抽屜 ═══
const DIM_EXPECT = {
  lifeFreedom: { name: '財務自由', score: '68', detail: ['TWRR', 'MWRR', '休假配速'] },
  fitness: { name: '身體', score: '81', detail: ['覆蓋率', '均衡度', '本週積分'] },
  calm: { name: '從容', score: '74', detail: ['逾期壓力', '近期負荷', '停滯程度'] },
  mind: { name: '心智', score: '79', detail: ['想法分數', '日報分數'] },
  social: { name: '社交', score: '77', detail: ['廣度', '互動強度', '規律'] },  // 社交 v2 起「連結率」改「規律」
  travel: { name: '旅遊', score: '55', detail: ['Recency', 'Frequency', '距上次旅行'] },
}
{
  // 7a 從首頁點面向小格 → 進該面向的頁（網址變 #dim/<key>），不是同一個抽屜
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, 'spark')
  await page.waitForSelector('[data-testid="st-dim"]'); await settle(page)
  await page.locator('[data-testid="st-dim"][data-dim="fitness"]').click()
  await page.waitForSelector('[data-testid="dim-page"]', { timeout: 5000 })
  check('面向頁：點「身體」小卡 → 網址 #dim/fitness、開的是面向頁而不是抽屜', (await page.evaluate(() => location.hash)) === '#dim/fitness' && (await page.locator('.bd-drawer').count()) === 0 && (await page.locator('[data-testid="dim-page"]').getAttribute('data-dim')) === 'fitness')
  check('面向頁：Esc 回首頁', await (async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(300); return (await page.evaluate(() => location.hash)) === '' && (await page.locator('[data-testid="dim-page"]').count()) === 0 })())
  check('面向頁：從首頁進出沒有頁面錯誤', errors.length === 0, errors.join(' | ').slice(0, 300))
  await ctx.close()
}
for (const [key, ex] of Object.entries(DIM_EXPECT)) {
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, 'spark', { hash: `#dim/${key}`, wait: false })
  await page.waitForSelector('[data-testid="dim-page"]', { timeout: 8000 })
  await page.waitForSelector('[data-testid="dp-detail"]', { timeout: 8000, state: 'attached' })
  // 旅遊在假資料裡只有最後一天有值（有效點不到 2 個）：走勢區應說明原因，而不是畫一條假線
  const noTrend = key === 'travel'
  await page.waitForSelector(noTrend ? '[data-testid="dp-trend-pending"]' : '[data-testid="dp-chart"]', { timeout: 8000 })
  const hero = await page.locator('.dp-hero').innerText()
  const det = await page.locator('[data-testid="dp-detail"]').textContent()
  const T = `面向頁 ${ex.name}`
  check(`${T}：標題、分數 ${ex.score}、權重與貢獻`, hero.includes(ex.name) && new RegExp(`\\b${ex.score}\\b`).test(hero) && /權重 \d+%・貢獻/.test(hero), hero.replace(/\n/g, '|').slice(0, 120))
  check(`${T}：「分數怎麼來」是這個面向自己的數據（${ex.detail.join('、')}）`, ex.detail.every((t) => det.includes(t)), det.replace(/\n/g, '|').slice(0, 140))
  const others = Object.entries(DIM_EXPECT).filter(([k]) => k !== key).flatMap(([, e]) => e.detail)
  check(`${T}：不含其他面向的數據（頁面不是共用同一份內容）`, !others.some((t) => det.includes(t) && !ex.detail.includes(t)), others.filter((t) => det.includes(t)).join(','))
  check(noTrend ? `${T}：有效點不足 → 走勢區說明原因、不畫圖，仍有「衡量什麼」` : `${T}：走勢圖、四個統計（平均／最高／最低／區間變化）、有說明「衡量什麼」`, (noTrend ? (await page.locator('[data-testid="dp-chart"]').count()) === 0 : (await page.locator('[data-testid="dp-stats"] > div').count()) === 4) && /衡量什麼/.test(hero) && /資料來源/.test(hero))
  check(`${T}：沒有頁面錯誤`, errors.length === 0, errors.join(' | ').slice(0, 300))
  if (key === 'travel') {
    const linkTxt = await page.locator('.dp-links').innerText()
    check(`${T}：相關連結有「遊記」「美食及旅遊地圖」「前往 旅遊生活」`, /遊記/.test(linkTxt) && /美食及旅遊地圖/.test(linkTxt) && /前往 旅遊生活/.test(linkTxt), linkTxt.replace(/\n/g, '|'))
    await page.screenshot({ path: path.join(SHOTS, 'dim-travel-1440.png') })
  }
  if (key === 'lifeFreedom') {
    check(`${T}：目前最大短板標記（權重 × 離滿分最大）`, /目前最大短板/.test(hero))
    await page.screenshot({ path: path.join(SHOTS, 'dim-lifeFreedom-1440.png') })
  }
  await ctx.close()
}
{
  // 7b 面向之間切換、上一個／下一個、區間切換、返回
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, 'spark', { hash: '#dim/calm', wait: false })
  await page.waitForSelector('[data-testid="dp-chart"]')
  check('面向頁：頁首六顆切換鈕，目前的是 aria-current', (await page.locator('.dp-nav .dp-chip').count()) === 6 && (await page.locator('.dp-chip[aria-current="page"]').getAttribute('data-testid')) === 'dp-nav-calm')
  check('面向頁：「分數怎麼來」預設收起', (await page.locator('details.dp-detail').getAttribute('open')) === null)
  await page.locator('[data-testid="dp-detail-toggle"]').click(); await page.waitForTimeout(150)
  check('面向頁：點「分數怎麼來」展開', await page.locator('[data-testid="dp-detail"]').isVisible())
  { const t = await page.locator('[data-testid="dp-detail"]').innerText(); check('面向頁（從容）：顯示「今天要做什麼」四個數字', /今天要做什麼/.test(t) && /已逾期\s*3/.test(t) && /今天到期\s*2/.test(t) && /7 天內到期\s*5/.test(t) && /近 7 天完成\s*7/.test(t)) }
  await page.locator('[data-testid="dp-nav-social"]').click(); await page.waitForTimeout(300)
  check('面向頁：點頁首「社交」→ #dim/social，內容換成社交的', (await page.evaluate(() => location.hash)) === '#dim/social' && /廣度/.test(await page.locator('[data-testid="dp-detail"]').innerText()))
  await page.locator('[data-testid="dp-next"]').click(); await page.waitForTimeout(300)
  check('面向頁：「下一個」→ 旅遊；再下一個回到財務自由（循環）', (await page.evaluate(() => location.hash)) === '#dim/travel')
  await page.locator('[data-testid="dp-next"]').click(); await page.waitForTimeout(300)
  check('面向頁：循環到財務自由', (await page.evaluate(() => location.hash)) === '#dim/lifeFreedom')
  const before = await page.locator('[data-testid="dp-chart"]').innerHTML()
  await page.locator('[data-testid="dp-range-90"]').click(); await page.waitForTimeout(200)
  check('面向頁：切到「近 90 天」按鈕狀態更新、統計仍在', (await page.locator('[data-testid="dp-range-90"]').getAttribute('aria-pressed')) === 'true' && (await page.locator('[data-testid="dp-stats"]').count()) === 1, before.length + '')
  await page.locator('[data-testid="dp-back"]').click(); await page.waitForTimeout(400)
  check('面向頁：「← 首頁」回首頁', (await page.evaluate(() => location.hash)) === '' && (await page.locator('.st-home').count()) === 1)
  check('面向頁：切換與返回沒有頁面錯誤', errors.length === 0, errors.join(' | ').slice(0, 300))
  await ctx.close()
}
{
  // 7b2 寬螢幕版面（2.62.0）：1920 三欄（左一覽｜主｜右近況），1200 兩欄；從容的甘特圖在主欄分數卡正下方、「分數怎麼來」在主欄最後
  const { ctx, page, errors } = await open({ width: 1920, height: 1080 }, 'spark', { hash: '#dim/calm', wait: false })
  await page.waitForSelector('[data-testid="dp-chart"]'); await page.waitForSelector('[data-testid="dp-overview"] .dp-ov-row'); await page.waitForTimeout(400)
  const box = async (sel) => page.locator(sel).first().boundingBox()
  const [ov, hero, rec, gantt, trend, det] = await Promise.all(['[data-testid="dp-overview"]', '.dp-hero', '[data-testid="dp-recent"]', '[data-testid="dp-gantt"]', '.dp-trend', 'details.dp-detail'].map(box))
  check('面向頁 1920：三欄——一覽在左、主內容在中、近況在右，同一列起頭', ov.x + ov.width < hero.x && hero.x + hero.width < rec.x && Math.abs(ov.y - hero.y) < 4 && Math.abs(rec.y - hero.y) < 4, JSON.stringify({ ov, hero, rec }))
  check('面向頁 1920：主欄夠寬（≥ 1000px）、兩旁沒有大片空白', hero.width >= 1000 && ov.x < 60, `${Math.round(hero.width)} / ${Math.round(ov.x)}`)
  check('面向頁 1920：甘特圖緊接分數卡、在走勢之前；「分數怎麼來」在最後', gantt.y > hero.y && gantt.y < trend.y && det.y > trend.y)
  check('面向頁 1920：一覽六列、目前面向標示 aria-current', (await page.locator('.dp-ov-row').count()) === 6 && (await page.locator('.dp-ov-row[aria-current="page"]').count()) === 1)
  check('面向頁 1920：近況卡有近 7 天平均與名次', /近 7 天平均/.test(await page.locator('[data-testid="dp-recent"]').innerText()) && /第 \d+ 高/.test(await page.locator('[data-testid="dp-recent"]').innerText()))
  const chartH = (await box('[data-testid="dp-chart"]')).height
  check(`面向頁 1920：走勢圖不因寬度被等比放大（高 ${Math.round(chartH)}px ≤ 260）`, chartH <= 260)
  await page.screenshot({ path: path.join(SHOTS, 'dim-calm-1920.png') })
  await page.setViewportSize({ width: 1200, height: 900 }); await page.waitForTimeout(400)
  const [ov2, hero2, rec2] = await Promise.all(['[data-testid="dp-overview"]', '.dp-hero', '[data-testid="dp-recent"]'].map(box))
  check('面向頁 1200：兩欄——主欄在左，近況與一覽疊在右欄', hero2.x + hero2.width < rec2.x && Math.abs(rec2.x - ov2.x) < 2 && ov2.y > rec2.y, JSON.stringify({ hero2, rec2, ov2 }))
  await page.screenshot({ path: path.join(SHOTS, 'dim-calm-1200.png') })
  check('面向頁 寬螢幕：沒有頁面錯誤', errors.length === 0, errors.join(' | ').slice(0, 300))
  await ctx.close()
}
{
  // 7c 手機：不橫向捲動、切換鈕不被擠出畫面
  const { ctx, page, errors } = await open({ width: 390, height: 844 }, 'spark', { hash: '#dim/fitness', wait: false })
  await page.waitForSelector('[data-testid="dp-chart"]'); await page.waitForTimeout(400)
  const m = await page.evaluate(() => { const b = document.querySelector('.dp-body'); const nav = document.querySelector('.dp-nav').getBoundingClientRect(); return { docW: document.documentElement.scrollWidth, innerW: window.innerWidth, bodyW: b.scrollWidth, bodyCW: b.clientWidth, navR: Math.round(nav.right), heroTop: Math.round(document.querySelector('.dp-hero').getBoundingClientRect().top), headH: Math.round(document.querySelector('.dp-head').getBoundingClientRect().height) } })
  check('面向頁 手機 390：不橫向捲動、頁首切換鈕在畫面內', m.docW <= m.innerW && m.bodyW <= m.bodyCW + 1 && m.navR <= m.innerW, JSON.stringify(m))
  check(`面向頁 手機 390：頁首不超過 130px（${m.headH}px），分數卡在首屏上半部（top ${m.heroTop}px）`, m.headH <= 130 && m.heroTop < 200, JSON.stringify(m))
  await page.screenshot({ path: path.join(SHOTS, 'dim-fitness-mobile-top.png') })
  await page.setViewportSize({ width: 390, height: 2000 }); await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(SHOTS, 'dim-fitness-mobile-full.png') })
  check('面向頁 手機 390：沒有頁面錯誤', errors.length === 0, errors.join(' | ').slice(0, 300))
  await ctx.close()
}
{
  // 7d 沒有歷史 components（接口未部署）：走勢區寫明原因、不報錯；未解鎖：鎖頭、不發私領域請求；不認得的 key 回首頁
  const a = await open({ width: 1440, height: 900 }, 'normal', { hash: '#dim/mind', wait: false })
  await a.page.waitForSelector('[data-testid="dim-page"]'); await a.page.waitForSelector('[data-testid="dp-trend-pending"]', { timeout: 8000 })
  check('面向頁：歷史沒有 components 時，走勢區說明原因（不畫假線、不報錯）', /還沒有資料/.test(await a.page.locator('[data-testid="dp-trend-pending"]').innerText()) && a.errors.length === 0, a.errors.join(' | ').slice(0, 200))
  await a.ctx.close()
  const b = await open({ width: 1440, height: 900 }, 'normal', { unlocked: false, hash: '#dim/calm', wait: false })
  await b.page.waitForSelector('[data-testid="dim-page"]'); await b.page.waitForTimeout(800)
  const privCalls = b.calls.filter((p) => /hermes-|happiness|media/.test(p))
  check('面向頁：未解鎖 → 顯示「🔒 解鎖後顯示」、不發私領域請求', (await b.page.locator('.hm-lock').count()) >= 1 && privCalls.length === 0, JSON.stringify(privCalls))
  await b.ctx.close()
  const c = await open({ width: 1440, height: 900 }, 'normal', { hash: '#dim/nope' })
  check('面向頁：不認得的面向網址 → 當作首頁（沒有面向頁）', (await c.page.locator('[data-testid="dim-page"]').count()) === 0 && (await c.page.locator('.st-home').count()) === 1)
  await c.ctx.close()
}

{
  // 8 年度回顧（#year）與各面向年熱圖（P2-1）
  const Y = Number(tpDate().slice(0, 4))
  const a = await open({ width: 1440, height: 900 }, 'spark', { hash: '#year', wait: false })
  await a.page.waitForSelector('[data-testid="year-page"]')
  check(`年度回顧：網址 #year、頁面是今年（${Y}）`, (await a.page.evaluate(() => location.hash)) === '#year' && (await a.page.locator('[data-testid="year-page"]').getAttribute('data-year')) === String(Y))
  await a.page.waitForSelector('[data-testid="yr-hhi-stats"]', { timeout: 8000 })
  const hhiText = await a.page.locator('[data-testid="yr-hhi-stats"]').innerText()
  check('年度回顧：幸福指數區有年平均、最好／最低的一天、有紀錄天數', /年平均/.test(hhiText) && /最好的一天/.test(hhiText) && /最低的一天/.test(hhiText) && /有紀錄/.test(hhiText), hhiText.replace(/\s+/g, ' ').slice(0, 120))
  check('年度回顧：六個面向各一列，有「全年最強」「全年最弱」', (await a.page.locator('[data-testid="yr-dims"] .yr-dim').count()) === 6 && (await a.page.locator('[data-testid="yr-dims"]').innerText()).includes('全年最強') && (await a.page.locator('[data-testid="yr-dims"]').innerText()).includes('全年最弱'))
  check('年度回顧：旅行與去過的地點兩區有內容或明確的「沒有」說明', (await a.page.locator('[data-testid="yr-trips"]').innerText()).length > 8 && (await a.page.locator('[data-testid="yr-places"]').innerText()).length > 8)
  check('年度回顧：今年不能再往後（下一年鈕停用）', await a.page.locator('[data-testid="yr-next"]').isDisabled())
  await a.page.locator('[data-testid="yr-prev"]').click(); await a.page.waitForTimeout(300)
  check(`年度回顧：往前一年 → #year/${Y - 1}`, (await a.page.evaluate(() => location.hash)) === `#year/${Y - 1}` && (await a.page.locator('[data-testid="year-page"]').getAttribute('data-year')) === String(Y - 1))
  check('年度回顧：沒有頁面錯誤', a.errors.length === 0, a.errors.join(' | ').slice(0, 300))
  await a.ctx.close()
  const b = await open({ width: 1440, height: 900 }, 'spark', { hash: '#dim/fitness', wait: false })
  await b.page.waitForSelector('[data-testid="dp-heat"] .hm-heat-grid', { timeout: 8000 })
  const cells = await b.page.locator('[data-testid="dp-heat"] .hm-cell:not(.is-empty)').count()
  check(`面向頁：「近一年每天」年熱圖有格子，有資料的日子上色（${cells} 格有值）`, cells >= 25 && (await b.page.locator('[data-testid="dp-heat"] .hm-heat-grid i').count()) >= 365, String(cells))
  check('面向頁：歷史改向 /api/happiness/history 取 365 天', b.calls.includes('/api/happiness/history'))
  await b.ctx.close()
  const c = await open({ width: 1440, height: 900 }, 'normal', { hash: '#dim/mind', wait: false })
  await c.page.waitForSelector('[data-testid="dp-heat-pending"]', { timeout: 8000 })
  check('面向頁：歷史沒有 components 時，年熱圖區寫明原因（不畫假圖）', /還不到 2 天/.test(await c.page.locator('[data-testid="dp-heat-pending"]').innerText()))
  await c.ctx.close()
  const d = await open({ width: 1440, height: 900 }, 'normal', { hash: '#year/1999' })
  check('年度回顧：年份不合理（#year/1999）→ 當作首頁', (await d.page.locator('[data-testid="year-page"]').count()) === 0 && (await d.page.locator('.st-home').count()) === 1)
  await d.ctx.close()
  const e = await open({ width: 390, height: 844 }, 'spark', { hash: '#year', wait: false })
  await e.page.waitForSelector('[data-testid="yr-hhi-stats"]', { timeout: 8000 })
  const mm = await e.page.evaluate(() => ({ docW: document.documentElement.scrollWidth, innerW: window.innerWidth }))
  check('年度回顧 手機 390：不橫向捲動', mm.docW <= mm.innerW, JSON.stringify(mm))
  await e.page.screenshot({ path: path.join(SHOTS, 'year-mobile.png') })
  await e.ctx.close()
}

{
  // 7e 從容面板的任務甘特圖（feed vikunja-gantt）：依專案分組、狀態上色、點列連到 Vikunja、手機不撐開整頁、失敗與未解鎖
  const { ctx, page, errors, calls } = await open({ width: 1440, height: 900 }, 'spark', { hash: '#dim/calm', wait: false })
  await page.waitForSelector('[data-testid="gt-row"]', { timeout: 8000 })
  const rows = await page.locator('[data-testid="gt-row"]').count()
  check(`甘特圖：畫出未完成且在視窗內的任務（${rows} 列；已完成與太遠的不畫）`, rows === 6, String(rows))
  check('甘特圖：摘要數字（進行中 7、逾期 2、7 天內到期 1、沒排日期 4）', /7\s*項進行中/.test(await page.locator('[data-testid="gt-sum"]').innerText()) && /2\s*項逾期/.test(await page.locator('[data-testid="gt-sum"]').innerText()) && /4\s*項沒排日期/.test(await page.locator('[data-testid="gt-sum"]').innerText()))
  check('甘特圖：預設「依到期日排序」——不分專案、最上面是逾期最久的、列前有專案色點', (await page.locator('[data-testid="gt-bydue"]').isChecked()) && (await page.locator('.gt-proj').count()) === 0 && (await page.locator('.gt-flat .gt-label-t').first().innerText()) === '早就逾期的報帳' && (await page.locator('.gt-flat .gt-dot').count()) === 6)
  check('甘特圖：「在 Vikunja 開啟」連到即將到期清單（含逾期與沒排日期）', (await page.locator('[data-testid="gt-open"]').getAttribute('href')) === 'https://v.example.test/tasks/by/upcoming?showOverdue=true&showNulls=true')
  await page.locator('[data-testid="gt-bydue"]').uncheck(); await page.waitForTimeout(150)
  check('甘特圖：關掉到期日排序 → 依專案分組，有逾期的專案（工作）排第一、逾期列是紅色狀態', (await page.locator('.gt-proj-t').first().innerText()) === '工作' && (await page.locator('.gt-row.is-overdue').count()) === 2)
  check('甘特圖：點列連到 Vikunja 任務頁（新分頁）', (await page.locator('[data-testid="gt-row"]').first().getAttribute('href'))?.startsWith('https://v.example.test/tasks/') && (await page.locator('[data-testid="gt-row"]').first().getAttribute('target')) === '_blank')
  await page.locator('[data-testid="dp-gantt"]').scrollIntoViewIfNeeded()
  await page.locator('[data-testid="dp-gantt"]').screenshot({ path: path.join(SHOTS, 'dim-calm-gantt.png') })
  await page.locator('[data-testid="gt-done"]').check(); await page.waitForTimeout(200)
  check('甘特圖：勾「含近 30 天完成」多出已完成的那一列', (await page.locator('.gt-row.is-done').count()) === 1)
  await page.locator('.gt-proj').first().click(); await page.waitForTimeout(150)
  check('甘特圖：點專案標頭收合', (await page.locator('.gt-proj').first().getAttribute('aria-expanded')) === 'false' && (await page.locator('[data-testid="gt-row"]').count()) === 4)
  await page.locator('[data-testid="dp-gantt"] .dp-range').nth(1).click(); await page.waitForTimeout(150)
  check('甘特圖：切到「近 3 個月」時間軸變長', (await page.locator('.gt-tick').count()) >= 12)
  check('甘特圖：有發 /api/feed/vikunja-gantt、沒有頁面錯誤', calls.includes('/api/feed/vikunja-gantt') && errors.length === 0, errors.join(' | ').slice(0, 300))
  await ctx.close()
  const m = await open({ width: 390, height: 844 }, 'spark', { hash: '#dim/calm', wait: false })
  await m.page.waitForSelector('[data-testid="gt-row"]', { timeout: 8000 })
  const g = await m.page.evaluate(() => { const b = document.querySelector('.dp-body'); const sc = document.querySelector('.gt-scroll'); const t = document.querySelector('.gt-today').getBoundingClientRect(), r = sc.getBoundingClientRect(); return { docW: document.documentElement.scrollWidth, innerW: window.innerWidth, bodyW: b.scrollWidth, bodyCW: b.clientWidth, scW: sc.scrollWidth, scCW: sc.clientWidth, todayX: Math.round(t.left - r.left), scLeft: sc.scrollLeft } })
  check('甘特圖 手機 390：時間軸在卡片內左右滑，不撐開整頁', g.docW <= g.innerW && g.bodyW <= g.bodyCW + 1 && g.scW > g.scCW, JSON.stringify(g))
  check('甘特圖 手機 390：一打開就捲到今天附近（今天線在卡片可見範圍內）', g.scLeft > 0 && g.todayX > 0 && g.todayX < g.scCW, JSON.stringify(g))
  const order = await m.page.evaluate(() => { const y = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().top); return { hero: y('.dp-hero'), gantt: y('[data-testid="dp-gantt"]'), trend: y('.dp-trend'), detail: y('.dp-detail') } })
  check('甘特圖 手機 390：排在分數卡正下方（在走勢、分數怎麼來之前）', order.hero < order.gantt && order.gantt < order.trend && order.gantt < order.detail, JSON.stringify(order))
  await m.page.locator('[data-testid="dp-gantt"]').scrollIntoViewIfNeeded()
  await m.page.locator('[data-testid="dp-gantt"]').screenshot({ path: path.join(SHOTS, 'dim-calm-gantt-mobile.png') })
  await m.ctx.close()
  { // 電腦版（2.62.0 起）：甘特圖同樣緊接分數卡、在走勢之前（使用者 2026-10-25「甘特圖才是會常看的」）
    const w = await open({ width: 1440, height: 900 }, 'spark', { hash: '#dim/calm', wait: false })
    await w.page.waitForSelector('[data-testid="gt-row"]', { timeout: 8000 })
    const o = await w.page.evaluate(() => ({ hero: Math.round(document.querySelector('.dp-hero').getBoundingClientRect().bottom), trend: Math.round(document.querySelector('.dp-trend').getBoundingClientRect().top), gantt: Math.round(document.querySelector('[data-testid="dp-gantt"]').getBoundingClientRect().top) }))
    check('甘特圖 電腦版：緊接分數卡、在走勢之前', o.gantt > o.hero && o.gantt < o.trend, JSON.stringify(o))
    await w.ctx.close()
  }
  const f = await open({ width: 1440, height: 900 }, 'spark', { hash: '#dim/calm', wait: false })
  await f.page.route('**/api/feed/vikunja-gantt', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
  await f.page.reload(); await f.page.waitForSelector('[data-testid="dp-gantt"] .hm-frame[data-state="error"]', { timeout: 8000 }).catch(() => {})
  check('甘特圖：接口失敗 → 卡片顯示錯誤狀態，其他區塊照常', (await f.page.locator('[data-testid="dp-gantt"] .hm-frame[data-state="error"]').count()) === 1 && (await f.page.locator('[data-testid="dp-chart"]').count()) === 1)
  await f.ctx.close()
  const u = await open({ width: 1440, height: 900 }, 'spark', { unlocked: false, hash: '#dim/calm', wait: false })
  await u.page.waitForSelector('[data-testid="dp-gantt"]'); await u.page.waitForTimeout(600)
  check('甘特圖：未解鎖 → 🔒、不發甘特圖請求', (await u.page.locator('[data-testid="dp-gantt"] .hm-lock').count()) === 1 && !u.calls.includes('/api/feed/vikunja-gantt'))
  await u.ctx.close()
}

// ═══ 新版首頁 v3（2.88.0）：搜尋框｜現在用得上｜STATUS 右欄 ═══
{
  const top = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top) : null }, sel)
  const noHScroll = (page) => page.evaluate(() => { const sc = document.querySelector('.ip-scroll'); return document.documentElement.scrollWidth <= window.innerWidth && sc.scrollWidth <= sc.clientWidth + 1 })

  // ── 桌機 1440×900 ──
  {
    const { ctx, page, errors, calls } = await open({ width: 1440, height: 900 }, 'v3-otd3', { layout: 'v3' })
    await page.waitForSelector('[data-testid="st-dim"]'); await settle(page)
    const T = 'v3 桌機 1440×900'
    const tops = { om: await top(page, '.om-root'), now: await top(page, '[data-testid="now-section"]'), aside: await top(page, '.st-aside') }
    check(`${T}：搜尋列、現在用得上、STATUS 的上緣都在首屏內`, Object.values(tops).every((t) => t !== null && t < 900), JSON.stringify(tops))
    // 3.10.0：大搜尋框改成頂欄的一行搜尋列；結果是往下展開的浮層
    check(`${T}：搜尋列在頂欄插槽內、頁面不再有大標題 om-title`, await page.evaluate(() => { const s = document.querySelector('[data-testid="tb-search-slot"]'), o = document.querySelector('.om-root'); return !!s && !!o && s.contains(o) && Math.round(o.getBoundingClientRect().top) < 80 && !document.querySelector('.om-title') }))
    const popH = () => page.evaluate(() => Math.round(document.querySelector('[data-testid="om-pop"]')?.getBoundingClientRect().height ?? 0))
    check(`${T}：浮層預設不可見`, (await popH()) === 0)
    await page.locator('[data-testid="tb-search-slot"] input').click(); await page.waitForTimeout(200)
    check(`${T}：聚焦搜尋列後浮層展開（有模式鈕與最近找過）`, (await popH()) > 0 && (await page.locator('[data-testid="om-pop"] .om-modes').count()) === 1)
    // 3.14.1：按下浮層裡的按鈕不能讓輸入框失焦（失焦浮層會先收起，click 送不到按鈕）
    await page.locator('[data-testid="om-pop"] .om-mode').first().click(); await page.waitForTimeout(150)
    check(`${T}：點前綴鈕會把前綴帶進搜尋列、輸入框保持聚焦`, await page.evaluate(() => { const i = document.querySelector('[data-testid="tb-search-slot"] input'); return document.activeElement === i && i.value === '@' }))
    await page.locator('[data-testid="tb-search-slot"] input').fill(''); await page.waitForTimeout(150)
    await page.keyboard.press('Escape'); await page.waitForTimeout(150)
    check(`${T}：沒有字時按 Escape 收起浮層`, (await popH()) === 0)
    await page.keyboard.press('/'); await page.waitForTimeout(200)
    check(`${T}：浮層左緣對齊搜尋列、右緣不出視窗`, await page.evaluate(() => { const s = document.querySelector('[data-testid="tb-search-slot"]').getBoundingClientRect(), p = document.querySelector('[data-testid="om-pop"]').getBoundingClientRect(); return Math.abs(p.left - s.left) <= 1 && p.right <= window.innerWidth && p.width >= s.width - 1 }))
    check(`${T}：按 / 聚焦搜尋列並展開浮層`, await page.evaluate(() => document.activeElement === document.querySelector('[data-testid="tb-search-slot"] input') && (document.querySelector('[data-testid="om-pop"]')?.getBoundingClientRect().height ?? 0) > 0))
    await page.keyboard.press('Escape'); await page.waitForTimeout(150)
    // 3.16.0：附近搬到搜尋框旁；點了直接開美食地圖的「附近・由近到遠」
    check(`${T}：搜尋框旁有「📍 附近」按鈕`, (await page.locator('[data-testid="tb-nearby"]').count()) === 1 && (await page.locator('[data-testid="tb-nearby"]').getAttribute('aria-label')) === '附近有什麼：開美食地圖，由近到遠')
    check(`${T}：DOM 順序＝左欄（STATUS）→ 中欄（想法板 → 現在用得上）→ 右欄 → 心得島嶼；心得島嶼在最後（有聚焦卡）`, await page.evaluate(() => {
      const l = document.querySelector('.st-col--l'), c = document.querySelector('.st-col--c'), r = document.querySelector('.st-col--r')
      const b = document.querySelector('[data-testid="idea-board"]'), n = document.querySelector('[data-testid="now-section"]')
      const t = document.querySelector('[data-testid="insight-islands"]'), h = document.querySelector('.st-home')
      const F = Node.DOCUMENT_POSITION_FOLLOWING
      return !!l && !!c && !!r && !!b && !!n && !!t && !!h && !!(l.compareDocumentPosition(c) & F) && !!(c.compareDocumentPosition(r) & F) && !!(r.compareDocumentPosition(t) & F) && c.contains(b) && c.contains(n) && !!(b.compareDocumentPosition(n) & F) && t === h.lastElementChild && b.querySelectorAll('[data-testid="idea-board-focus"] .ib-card--focus').length === 1
    }))
    check(`${T}：沒有 .hm-today，也沒有九個舊區塊`, (await page.locator('.hm-today, .hm-dimsec, .hm-growth, .hm-fun, .hm-sys, .hm-repos, .hm-companion, .hm-brief').count()) === 0)
    check(`${T}：STATUS 的盒子都在（面向、成長與系統、最近、好玩的、捷徑）`, (await page.locator('[data-testid="st-dims"], [data-testid="st-growth"], [data-testid="st-recent"], [data-testid="st-fun"], [data-testid="st-shortcuts"]').count()) === 5)
    // 3.16.0：首頁順序改為 STATUS → 想法板 → 現在用得上 → 心得島嶼（島嶼移到最下方；STATUS 佔滿整列）
    check(`${T}：三欄（.st-col--l/c/r 的 left 遞增、top 差 ≤ 4px）、想法板在現在用得上之前、心得島嶼在三欄下方且跨全寬`, await page.evaluate(() => {
      const R = (q) => document.querySelector(q).getBoundingClientRect()
      const h = R('.st-home'), l = R('.st-col--l'), c = R('.st-col--c'), r = R('.st-col--r')
      const t = R('[data-testid="insight-islands"]'), b = R('[data-testid="idea-board"]'), n = R('[data-testid="now-section"]')
      return l.left < c.left && c.left < r.left && Math.abs(l.top - c.top) <= 4 && Math.abs(c.top - r.top) <= 4
        && n.top >= b.bottom - 1 && t.top >= Math.max(l.bottom, c.bottom, r.bottom) - 1 && t.width >= h.width * 0.9
    }))
    check(`${T}：st-dims 有 6 格、盒頭有 STATUS 與整體分數 71`, (await page.locator('[data-testid="st-dim"]').count()) === 6 && /STATUS/.test(await page.locator('[data-testid="st-dims"]').innerText()) && (await page.locator('[data-testid="st-hhi"]').innerText()) === '71')
    const spark = await page.locator('[data-testid="st-spark"]').count()
    check(`${T}：6 個面向都有 7 天迷你線（假資料有 30 天 components；travel 只有 1 天所以不畫）`, spark >= 4 && spark <= 5, String(spark))
    const deltas = await page.evaluate(() => [...document.querySelectorAll('.st-dim-d')].map((e) => e.textContent.trim()))
    check(`${T}：差值是 ▲n／▼n／—`, deltas.length === 6 && deltas.every((d) => /^(▲\d+|▼\d+|—)$/.test(d)), JSON.stringify(deltas))
    check(`${T}：點面向小格 → 面向頁 #dim/<key>`, await (async () => { await page.locator('[data-testid="st-dim"]').first().click(); await page.waitForTimeout(200); return /^#dim\//.test(await page.evaluate(() => location.hash)) })())
    await page.evaluate(() => { location.hash = '' }); await page.waitForSelector('.st-home')
    const g = await page.locator('[data-testid="st-growth"]').innerText()
    check(`${T}：成長與系統盒五列＋付費服務列（知識庫這週 +1 頁・+1 句、更正 3 筆、查無結果率 25%・本週 12 次、推送被點開 40%・沒用 3 則）`,
      /知識庫這週\s*\+1 頁・\+1 句/.test(g) && /你的更正\s*3 筆已生效/.test(g) && /搜尋查無結果率\s*25%・本週 12 次/.test(g) && /推送被點開\s*40%・沒用 3 則/.test(g) && /系統/.test(g) && (await page.locator('[data-testid="st-svc"]').count()) === 1, g.replace(/\s+/g, ' '))
    check(`${T}：知識庫兩列是開抽屜的按鈕（不再連到 #knowledge）`, (await page.locator('button[data-testid="st-kb"]').count()) === 1 && (await page.locator('button[data-testid="st-fixes"]').count()) === 1)
    await page.locator('[data-testid="st-search"]').click(); await page.waitForSelector('[data-testid="search-stats-panel"]')
    const sp = await page.locator('[data-testid="search-stats-panel"]').innerText()
    check(`${T}：點「搜尋查無結果率」開小抽屜（14 天、查無結果的詞）`, /查無結果最多的詞/.test(sp) && /不存在的詞/.test(sp) && calls.includes('/api/search/stats?days=14') && calls.includes('/api/search/stats?days=7'), sp.replace(/\s+/g, ' ').slice(0, 120))
    await page.keyboard.press('Escape'); await page.waitForTimeout(150)
    await page.locator('[data-testid="st-push"]').click(); await page.waitForSelector('[data-testid="push-stats-panel"]')
    const pp = await page.locator('[data-testid="push-stats-panel"]').innerText()
    check(`${T}：點「推送被點開」開小抽屜（種類表含歷年今天）`, /歷年今天/.test(pp) && /主題知識/.test(pp) && calls.includes('/api/push/stats?days=14'), pp.replace(/\s+/g, ' ').slice(0, 120))
    await page.keyboard.press('Escape'); await page.waitForTimeout(150)
    await page.locator('[data-testid="st-sys"]').click(); await page.waitForSelector('.bd-drawer')
    check(`${T}：點「系統」開 HERMES 戰情室抽屜，裡面有倉庫段落`, /戰情室/.test(await page.locator('.bd-drawer-title').innerText()) && (await page.locator('[data-testid="st-ops-repos"] .hm-repo').count()) > 0)
    await page.keyboard.press('Escape'); await page.waitForTimeout(150)
    await page.locator('[data-testid="st-svc"]').click(); await page.waitForSelector('.bd-drawer')
    check(`${T}：點付費服務列開付費服務抽屜`, /付費服務/.test(await page.locator('.bd-drawer-title').innerText()))
    await page.keyboard.press('Escape'); await page.waitForTimeout(150)
    await page.locator('[data-testid="st-dims"] .st-boxhead--btn').click(); await page.waitForSelector('.bd-drawer')
    check(`${T}：點 STATUS 盒頭開幸福指數抽屜，最上面是活動洞察、後面有成長軌跡熱圖`, await page.evaluate(() => { const b = document.querySelector('.bd-drawer-body'); const i = b.querySelector('[data-testid="activity-insight"]'); const gr = b.querySelector('[data-testid="st-hhi-growth"]'); return !!i && !!gr && b.firstElementChild === i && !!(i.compareDocumentPosition(gr) & Node.DOCUMENT_POSITION_FOLLOWING) && !!gr.querySelector('.hm-cell[data-date]') }))
    await page.keyboard.press('Escape'); await page.waitForTimeout(150)
    const sc = await page.locator('[data-testid="st-shortcuts"]').innerText()
    check(`${T}：捷徑列（時間軸、想法庫、卷宗、知識）在 STATUS 最下面`, /時間軸/.test(sc) && /想法庫/.test(sc) && /卷宗/.test(sc) && /知識/.test(sc) && await page.evaluate(() => { const f = document.querySelector('[data-testid="st-fun"]'); const s = document.querySelector('[data-testid="st-shortcuts"]'); return !!(f.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) && s === document.querySelector('.st-aside--right').lastElementChild }))
    await page.locator('[data-testid="st-shortcuts"] button').click(); await page.waitForSelector('.bd-drawer')
    check(`${T}：捷徑「想法庫」開想法抽屜`, /想法庫/.test(await page.locator('.bd-drawer-title').innerText()))
    await page.keyboard.press('Escape'); await page.waitForTimeout(150)
    const fun = await page.locator('[data-testid="st-fun"]').innerText()
    check(`${T}：好玩的小盒四行（想法、想吃、想去、最近遊記）`, /想法/.test(fun) && /想吃/.test(fun) && /想去/.test(fun) && /最近遊記/.test(fun) && /台南三日散步/.test(fun), fun.replace(/\s+/g, ' '))
    // 最近盒：點一個籤 → 搜尋框的值等於該詞
    const chips = await page.locator('[data-testid="st-recent-chip"]').allInnerTexts()
    await page.locator('[data-testid="st-recent-chip"]').nth(1).click(); await page.waitForTimeout(300)
    check(`${T}：最近盒有 3 個籤；點第二個後搜尋框的值等於該詞、浮層打開`, chips.length === 3 && (await page.locator('.om-root input[type="text"]').inputValue()) === chips[1] && (await page.evaluate(() => (document.querySelector('[data-testid="om-pop"]')?.getBoundingClientRect().height ?? 0) > 0)), JSON.stringify(chips))
    // 收掉浮層，免得蓋住後面要點的卡片（第一次 Escape 清字、第二次收起）
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(200)
    // 歷年今天：3 筆 onThisDay → 今天分頁最多 1 張 onthisday 卡，why 寫「N 年前的今天」
    const otd = await page.locator('[data-testid="now-card"][data-kind="onthisday"]').count()
    check(`${T}：companion 有 3 筆歷年今天 → 今天分頁最多 1 張 onthisday 卡`, otd === 1, String(otd))
    check(`${T}：onthisday 卡的 why 是「N 年前的今天」、有「沒用」按鈕`, /\d+ 年前的今天/.test(await page.locator('[data-testid="now-card"][data-kind="onthisday"] .nw-why').innerText()) && (await page.locator('[data-testid="now-card"][data-kind="onthisday"] button[aria-label^="沒用"]').count()) === 1)
    await page.locator('[data-testid="now-card"][data-kind="onthisday"] button[aria-label^="沒用"]').click(); await page.waitForTimeout(800)
    check(`${T}：按「沒用」送出 cardKind=onthisday 的回饋；那張卡離開，換下一張歷年今天（仍只有 1 張）`, calls.includes('feedback:useless:onthisday') && (await page.locator('[data-testid="now-card"][data-kind="onthisday"]').count()) === 1 && !/去年的今天發生的事/.test(await page.locator('[data-testid="now-card"][data-kind="onthisday"]').innerText()))
    check(`${T}：今天的一行（趨勢＋建議）在現在用得上標題列上方`, await page.evaluate(() => { const l = document.querySelector('[data-testid="st-today-line"]'); const h = document.querySelector('.nw-head'); return !!l && !!(l.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING) && l.textContent.trim().length > 0 }))
    check(`${T}：沒有橫向捲動、沒有頁面錯誤`, (await noHScroll(page)) && errors.length === 0, errors.join(' | ').slice(0, 300))
    await page.screenshot({ path: path.join(SHOTS, 'home-v3-1440.png') })
    // 3.16.0：附近來回頁面放在這個情境最後（回首頁後部分區塊不會重新出現，放前面會讓後面的檢查找不到元素）
    await page.locator('[data-testid="tb-nearby"]').click(); await page.waitForTimeout(400)
    check(`${T}：點「📍 附近」→ 網址變 #food/nearby`, (await page.evaluate(() => location.hash)) === '#food/nearby')
    await ctx.close()
  }

  // ── 想法板：聚焦／候選想法的標題可點，直接開想法庫並定位那一張（3.9.1）──
  for (const [w, h] of [[1440, 900], [375, 812]]) {
    const T = `v3 想法板卡片 ${w}×${h}`
    const { ctx, page, errors } = await open({ width: w, height: h }, 'v3-otd3', { layout: 'v3' })
    await page.waitForSelector('[data-testid="idea-board-open"]', { timeout: 15000 })
    const cardTitle = (await page.locator('[data-testid="idea-board-open"]').first().innerText()).trim().replace(/^🎯\s*/, '')
    await page.locator('[data-testid="idea-board-open"]').first().click()
    await page.waitForSelector('.bd-drawer details.bd-idea-item[open]', { timeout: 10000 }); await page.waitForTimeout(300)
    // 抽屜最上面的「📊 想法儀表」也是展開的 bd-idea-item，要用標題篩
    const hit = await page.locator('.bd-drawer details.bd-idea-item[open]', { hasText: cardTitle }).count()
    check(`${T}：點聚焦卡標題 → 想法庫抽屜出現且展開被點的那張`, cardTitle !== '' && hit >= 1, cardTitle)
    await page.keyboard.press('Escape'); await page.waitForTimeout(200)
    check(`${T}：關掉抽屜、沒有頁面錯誤、沒有橫向捲動`, (await page.locator('.bd-drawer').count()) === 0 && errors.length === 0 && (await noHScroll(page)), errors.join(' | ').slice(0, 200))
    await ctx.close()
  }

  // ── 明日報告：明天分頁的「看全文」開抽屜 ──
  {
    const { ctx, page } = await open({ width: 1440, height: 900 }, 'v3-cards5', { layout: 'v3' })
    await page.waitForSelector('[data-testid="now-card"]'); await settle(page)
    check('v3：沒有明日報告區塊（改為抽屜）', (await page.locator('#sec-brief').count()) === 0)
    await ctx.close()
  }

  // ── 系統燈黃／紅：首頁最上方出警示帶（3.10.0 起搜尋列在頂欄，警示帶改成在內容最上方） ──
  {
    const { ctx, page } = await open({ width: 1440, height: 900 }, 'v3-alert', { layout: 'v3' })
    await page.waitForSelector('[data-testid="st-alert"]', { timeout: 10000 }); await settle(page)
    check('v3 警示：系統燈異常時，內容最上方出現警示帶、根元素 data-sys=alert', await page.evaluate(() => { const a = document.querySelector('[data-testid="st-alert"]'); const h = document.querySelector('.st-home'); const o = document.querySelector('[data-testid="tb-search-slot"] .om-root'); const r = document.querySelector('[data-testid="st-root"]'); return !!a && !!h && !!o && a.getBoundingClientRect().bottom <= h.getBoundingClientRect().top + 1 && r.getAttribute('data-sys') === 'alert' }))
    await page.locator('[data-testid="st-alert"]').click(); await page.waitForSelector('.bd-drawer')
    check('v3 警示：點警示帶開戰情室', /戰情室/.test(await page.locator('.bd-drawer-title').innerText()))
    await ctx.close()
  }

  // ── 未解鎖：不發私領域請求、STATUS 各列寫 🔒 ──
  {
    const { ctx, page, calls } = await open({ width: 1440, height: 900 }, 'v3-cards5', { layout: 'v3', unlocked: false })
    await page.waitForSelector('.st-aside'); await page.waitForTimeout(800)
    const priv = calls.filter((c) => /search\/(recent|stats)|push\/stats|feed\/topics|push\/feedback/.test(c))
    check('v3 未解鎖：不發最近搜尋、統計、知識頁、推送回饋請求', priv.length === 0, JSON.stringify(priv))
    check('v3 未解鎖：最近盒不顯示、各列寫「解鎖後顯示」', (await page.locator('[data-testid="st-recent"]').count()) === 0 && /解鎖後顯示/.test(await page.locator('[data-testid="st-growth"]').innerText()))
    await ctx.close()
  }

  // ── 手機：0 張與 5 張推送卡（規格 18、19）──
  for (const [w, h, limit] of [[390, 844, 1266], [360, 740, 1110]]) {
    for (const cards of [0, 5]) {
      const { ctx, page, errors } = await open({ width: w, height: h }, `v3-cards${cards}`, { layout: 'v3' })
      await page.waitForSelector('[data-testid="st-dim"]'); await settle(page)
      const T = `v3 手機 ${w}×${h} ${cards} 張卡`
      const nowTop = await top(page, '[data-testid="now-section"]')
      const omTop = await top(page, '.om-root')
      const dimsTop = await top(page, '[data-testid="st-dims"]')
      const shownCards = await page.locator('[data-testid="now-card"]').count()
      // 3.10.0：搜尋列在頂欄（手機擠到第二行），不再佔首頁內容的一整塊
      const inSlot = await page.evaluate(() => { const s = document.querySelector('[data-testid="tb-search-slot"]'), o = document.querySelector('.om-root'); return !!s && !!o && s.contains(o) })
      await page.evaluate(() => window.scrollTo(0, 0)); await page.locator('[data-testid="tb-search-slot"] input').click(); await page.waitForTimeout(200)
      const popBox = await page.evaluate(() => { const p = document.querySelector('[data-testid="om-pop"]').getBoundingClientRect(); return { l: Math.round(p.left), r: Math.round(p.right), h: Math.round(p.height), vw: window.innerWidth } })
      check(`${T}：點搜尋列後浮層展開且完全在視窗內（左右都不切到）`, popBox.h > 0 && popBox.l >= 0 && popBox.r <= popBox.vw, JSON.stringify(popBox))
      await page.keyboard.press('Escape'); await page.waitForTimeout(150)
      check(`${T}：搜尋列在頂欄插槽內、搜尋列與「現在用得上」標題在首屏內（om ${omTop}、now ${nowTop} < ${h}）`, inSlot && omTop !== null && omTop < h && nowTop !== null && nowTop < h)
      // 3.16.0：心得島嶼移到最下方，STATUS 不再被它往下推，直接比 1.5 屏
      check(`${T}：st-dims 的上緣 ${dimsTop} ≤ ${limit}（1.5 屏）`, dimsTop !== null && dimsTop <= limit, String(dimsTop))
      check(`${T}：st-dims 有 6 格、3 欄 2 列`, (await page.locator('[data-testid="st-dim"]').count()) === 6 && (await page.evaluate(() => new Set([...document.querySelectorAll('[data-testid="st-dim"]')].map((e) => Math.round(e.getBoundingClientRect().left))).size)) === 3)
      check(`${T}：不橫向捲動、沒有頁面錯誤`, (await noHScroll(page)) && errors.length === 0, errors.join(' | ').slice(0, 300))
      check(`${T}：單欄順序 st-dims → idea-board → now-section → st-fun → insight-islands`, await page.evaluate(() => { const ids = ['[data-testid="st-dims"]', '[data-testid="idea-board"]', '[data-testid="now-section"]', '[data-testid="st-fun"]', '[data-testid="insight-islands"]']; const rs = ids.map((q) => document.querySelector(q)?.getBoundingClientRect()); return rs.every(Boolean) && rs.every((x, i) => i === 0 || x.top >= rs[i - 1].bottom - 1) }))
      if (cards === 5) {
        check(`${T}：5 張推送卡時先顯示 2 張，其餘收在「再看 3 則」（畫面上 ${shownCards} 張）`, shownCards === 2 && /再看 3 則/.test(await page.locator('[data-testid="now-more"]').innerText()), String(shownCards))
        await page.locator('[data-testid="now-more"]').click(); await page.waitForTimeout(500)
        const afterCards = await page.locator('[data-testid="now-card"]').count()
        check(`${T}：按「再看 3 則」後 5 張全部出現、按鈕消失`, afterCards === 5 && (await page.locator('[data-testid="now-more"]').count()) === 0, String(afterCards))
        if (w === 390) { await page.evaluate(() => document.querySelector('.ip-shell').scrollTo({ top: 0 })); await page.waitForTimeout(200) }
      } else {
        // 3.4.0 起最弱面向卡一定在（由幸福指數算出，不靠推送），所以沒有推送卡時畫面上只剩這一張
        check(`${T}：沒有推送卡時只剩最弱面向卡`, shownCards === 1 && /今天最弱的一面/.test(await page.locator('[data-testid="now-card"]').first().innerText()), String(shownCards))
      }
      await ctx.close()
    }
  }
  // 截圖：390×844 5 張卡的首屏（收合狀態）
  {
    const { ctx, page } = await open({ width: 390, height: 844 }, 'v3-cards5', { layout: 'v3' })
    await page.waitForSelector('[data-testid="st-dim"]'); await settle(page)
    await page.screenshot({ path: path.join(SHOTS, 'home-v3-390-5cards.png') })
    await ctx.close()
  }
}

await browser.close()
server.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed; screenshots: ${SHOTS}`)
process.exit(failed.length ? 1 : 0)
