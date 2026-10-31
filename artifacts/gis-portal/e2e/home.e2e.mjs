// 新首頁（HomeBoard，2.36.0 起的預設首頁）真實瀏覽器驗證（手動執行；不在 CI 內，同 board.e2e.mjs／timeline.e2e.mjs 的做法）。
//
// 做什麼：本機靜態伺服器提供 dist/public，Playwright 攔截所有 /api/*，以「假 API」模擬 sites／dashboard／happiness history／
// 知識庫／想法庫／地點／遊記／管線／主機狀態／Ollama 用量，驗證「預設首頁」（含左側錨點導覽、面向卡的子系統連結、倉庫索引、付費服務卡）：
// 桌面四種尺寸（1366×768、1440×900、1536×864、1920×1080）可往下捲（2026-10-22 起不再要求一個畫面）、不裁切、左側錨點導覽、倉庫索引；手機 390／360 順序與不橫向捲動；
// 未解鎖（沒有任何子系統連結、私領域區塊寫「🔒 解鎖後顯示」、不發私領域請求）、載入中、空、失敗、過期、太久沒更新、異常（⑤ 上移）；
// 六面向新名稱與識別色、里程碑（分組門檻、最多 6 顆、「下一個」進度）、每面向 30 天迷你線（有資料／沒有資料維持數值條）；
// #home 相容（清掉 hash 回首頁）、#legacy 舊版首頁與退路連結。全程不碰任何真實服務。
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

// 場景：每個 API 路徑 → 回應（或 'fail' / 'delay'）
function scenario(name) {
  const s = { dashboard: [hhi(), { subsystemId: 'mind-index', name: '心智指標', isPrivate: true, status: 'ok', errorMessage: null, fetchedAt: iso(60e3), data: { score: 72.4, conversion: 90, linkHealth: 80, vitality: 55, rhythm: 66, stale: false } },
  { subsystemId: 'pf-cwh', name: '人生進度管理系統', isPrivate: true, status: 'ok', errorMessage: null, fetchedAt: iso(60e3), data: { totalAssetsTWD: 12345678, twrr: 0.082, mwrr: 0.071, pacingIndex: 0.93, lifeFreedomIndex: 68 } },
  { subsystemId: 'fitnessforge', name: '運動 APP 系統', isPrivate: true, status: 'ok', errorMessage: null, fetchedAt: iso(60e3), data: { weeklyScore: 1234, trendPct: 4.2, balanceScore: 62, coverageScore: 71, activityBonusPoints: 3, muscleComposites: [{ name: '胸', composite: 90 }], habitIndex: 55 } },
  { subsystemId: 'vikunja', name: '任務追蹤系統', isPrivate: true, status: 'ok', errorMessage: null, fetchedAt: iso(60e3), data: { overdueScore: 40, loadScore: 55, stagnationScore: 30, completionScore: 45, busyIndex: 42, stale: false, taskActions: { overdue: 3, dueToday: 2, dueNext7: 5, doneWeek: 7 } } },
  { subsystemId: 'travel', name: '旅遊生活', isPrivate: true, status: 'ok', errorMessage: null, fetchedAt: iso(60e3), data: { daysSinceLastTrip: 24, lastTripEndDate: '2026-09-23', recencyScore: 78, frequencyScore: 40, tripDaysLast180: 8, anticipationBonus: 0, hasUpcomingTrip: false, travelScore: 59 } },
  { subsystemId: 'social-index', name: '社交指標', isPrivate: true, status: 'ok', errorMessage: null, fetchedAt: iso(60e3), data: { observedDayCount: 6, distinctPersonCount: 3, daysWithInteraction: 4, breadthScore: 60, intensityScore: 47, connectionRateScore: 67, socialScore: 55, personNames: ['小明', '阿華'] } }], history: { history: historyRows() }, graph: graph(), ideas: ideas(), food: food(), trips: trips(), pipeline: pipeline(), status: status(), usage: usage(), fail: new Set(), delayMs: 0, history30: null }
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
async function open(viewport, scn = 'normal', { unlocked = true, hash = '', wait = true } = {}) {
  const S = scenario(scn)
  const ctx = await browser.newContext({ viewport })
  if (unlocked) await ctx.addInitScript((k) => localStorage.setItem('portal_unlocked', k), PWD)
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
  if (wait) await page.waitForSelector('.hm-root', { timeout: 15000 })
  return { ctx, page, errors, calls }
}
const settle = async (page, ms = 1700) => { await page.waitForFunction(() => !document.querySelector('.hm-frame[aria-busy="true"]'), null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(ms) }
const geom = (page) => page.evaluate(() => {
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) } }
  const sc = document.querySelector('.ip-scroll')
  return { today: r('.hm-today'), dims: r('.hm-dimsec'), growth: r('.hm-growth'), fun: r('.hm-fun'), sys: r('.hm-sys'), root: r('.hm-wrap'), aside: r('.ip-aside'),
    scrollH: sc.scrollHeight, clientH: sc.clientHeight, docW: document.documentElement.scrollWidth, innerW: window.innerWidth, innerH: window.innerHeight, scW: sc.scrollWidth, scCW: sc.clientWidth }
})
const clippedCards = (page) => page.evaluate(() => [...document.querySelectorAll('.hm-card')].map((c) => ({ cls: c.className.slice(0, 30), v: c.scrollHeight - c.clientHeight, h: c.scrollWidth - c.clientWidth })).filter((c) => c.v > 2 || c.h > 2))
const innerClipped = (page) => page.evaluate(() => [...document.querySelectorAll('.hm-dim, .hm-tile, .hm-kb-tile, .hm-idea, .hm-sentence, .hm-today-body, .hm-heat, .hm-next')].map((c) => ({ cls: c.className.slice(0, 24), v: c.scrollHeight - c.clientHeight, h: c.scrollWidth - c.clientWidth })).filter((c) => c.v > 2 || c.h > 2))

// ═══ 1. 桌面四種尺寸：正常（含側欄） ═══
for (const [w, h] of [[1366, 768], [1440, 900], [1536, 864], [1920, 1080]]) {
  const { ctx, page, errors } = await open({ width: w, height: h }, 'normal')
  await page.waitForSelector('.hm-dim .hm-dim-num', { timeout: 15000 })
  await page.waitForSelector('.hm-cell[data-date]')
  await settle(page)
  const g = await geom(page)
  const T = `${w}×${h} 正常`
  check(`${T}：預設首頁是新首頁（沒有舊儀表板卡片）`, (await page.locator('.hm-root').count()) === 1 && (await page.locator('.bd-card').count()) === 0)
  check(`${T}：五段都出現`, (await page.locator('.hm-today, .hm-dimsec, .hm-growth, .hm-fun, .hm-sys').count()) === 5)
  check(`${T}：頁面可往下捲（內容 ${g.scrollH} > 視窗 ${g.clientH}），新增區塊往下長不被截掉`, g.scrollH >= g.clientH)
  check(`${T}：沒有橫向捲動`, g.docW <= g.innerW && g.scW <= g.scCW + 1)
  const cl = await clippedCards(page)
  check(`${T}：卡片內容沒被裁切`, cl.length === 0, JSON.stringify(cl))
  const ic = await innerClipped(page)
  check(`${T}：小卡／文字沒被裁切`, ic.length === 0, JSON.stringify(ic))
  check(`${T}：左側錨點導覽有 ${9} 顆按鈕，且每顆都對得到頁面上的區塊`, (await page.locator('.hm-nav-item').count()) === 9 && (await page.evaluate(() => ['sec-today', 'sec-brief', 'sec-dims', 'sec-companion', 'sec-growth', 'sec-fun', 'sec-repos', 'sec-sys', 'sec-svc'].every((id) => document.getElementById(id)))))
  check(`${T}：導覽在 ≥1300px 是左側直排`, await page.evaluate(() => { const n = document.querySelector('.hm-nav').getBoundingClientRect(); const r = document.querySelector('.hm-root').getBoundingClientRect(); return n.right <= r.left + 1 && n.height > 100 }))
  check(`${T}：倉庫索引列出 17 個（預設隱藏封存與 fork），先顯示 12 個並有「再顯示」`, (await page.locator('.hm-repo').count()) === 12 && /再顯示 5 個（共 17）/.test(await page.locator('.hm-repos-more').innerText()))
  check(`${T}：私有倉庫有 🔒、最近推送的排最前`, (await page.locator('.hm-repo').first().innerText()).startsWith('Aiportal') && /🔒\s*kb-pipeline/.test(await page.locator('.hm-repos').innerText()))
  const dimLinks = await page.evaluate(() => [...document.querySelectorAll('.hm-dim-open')].map((a) => ({ t: a.textContent.trim(), h: a.getAttribute('href'), tg: a.target, rel: a.rel })))
  check(`${T}：面向卡上有 3 個子系統連結（人生進度、健身追蹤、任務追蹤），都開新分頁`, dimLinks.length === 3 && dimLinks.every((l) => l.tg === '_blank' && /noopener/.test(l.rel)) && ['人生進度管理系統', '健身追蹤', '任務追蹤系統'].every((n) => dimLinks.some((l) => l.t.includes(n))), JSON.stringify(dimLinks))
  check(`${T}：旅遊面向沒有外部連結（AdventureLog 已退場）`, (await page.locator('.hm-dim-cell', { hasText: '旅遊' }).locator('.hm-dim-open').count()) === 0)
  const bodyText = await page.locator('body').innerText()
  check(`${T}：工具連結區已拿掉（沒有側欄、沒有公／私領域分區、沒有手動連結）`, (await page.locator('.ip-aside, .ip-tools').count()) === 0 && !/公領域|私領域|圖根點管理系統|案件排程系統/.test(bodyText))
  const leftGap = await page.evaluate(() => document.querySelector('.hm-today').getBoundingClientRect().left - document.querySelector('.hm-layout').getBoundingClientRect().left)
  check(`${T}：主區貼左（左側只剩約 8rem 的錨點導覽，不再有 240px 以上的側欄；距 ${Math.round(leftGap)}px）`, leftGap <= 190, String(leftGap))
  check(`${T}：⑤ 平常在最下面（細列）`, g.sys.top >= g.growth.bottom - 1 && g.sys.top >= g.fun.bottom - 1, JSON.stringify(g.sys))
  const sysH = g.sys.bottom - g.sys.top
  check(`${T}：⑤ 是細列（高 ${sysH}px ≤ 48）`, sysH <= 48)
  check(`${T}：③ 與 ④ 同一列`, Math.abs(g.growth.top - g.fun.top) <= 2)
  const sysLink = await page.locator('.hm-sys .hm-link').boundingBox()
  const gear = await page.locator('button[title="管理後台"]').boundingBox()
  // 2.53.0 起 ⚙ 收進頂欄：改成真正的矩形相交判斷（以前 ⚙ 固定在右下角，只比右下）
  const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  check(`${T}：⑤ 的「戰情室 →」沒被 ⚙ 蓋住`, !overlap(sysLink, gear), JSON.stringify([sysLink, gear]))
  const head = await page.locator('.ip-head').boundingBox()
  check(`${T}：頂欄是單列（高 ${Math.round(head.height)}px ≤ 64），⚙ 在頂欄內`, head.height <= 64 && gear.y >= head.y && gear.y + gear.height <= head.y + head.height + 1, JSON.stringify([head, gear]))
  const glance = await page.evaluate(() => ({ drag: document.querySelector('[data-testid="hm-glance-drag"]')?.innerText ?? '', sys: document.querySelector('[data-testid="hm-glance-sys"]')?.innerText ?? '', todayBottom: document.querySelector('.hm-today').getBoundingClientRect().bottom }))
  check(`${T}：今天卡的「一眼看」有最弱面向（財務自由 68、拉低 8.6 分）與系統燈（全部正常），且都在首屏內`, /最弱面向/.test(glance.drag) && /財務自由/.test(glance.drag) && /68/.test(glance.drag) && /拉低總分 8\.6 分/.test(glance.drag) && /全部正常/.test(glance.sys) && glance.todayBottom <= h, JSON.stringify(glance))
  check(`${T}：最弱面向連到 hash 路由（少了 # 會變站內路徑、畫面全白）`, (await page.locator('[data-testid="hm-glance-drag"]').getAttribute('href')) === '#dim/lifeFreedom')
  const shortcuts = await page.evaluate(() => ({ names: [...document.querySelectorAll('.hm-nav-short')].map((a) => a.innerText.trim()), hrefs: [...document.querySelectorAll('a.hm-nav-short')].map((a) => a.getAttribute('href')), bottom: Math.max(...[...document.querySelectorAll('.hm-nav-short')].map((a) => a.getBoundingClientRect().bottom)) }))
  check(`${T}：常用入口（時間軸、想法庫、關係宇宙）不用捲動就看得到`, shortcuts.names.length === 3 && /時間軸/.test(shortcuts.names[0]) && /想法庫/.test(shortcuts.names[1]) && /關係宇宙/.test(shortcuts.names[2]) && shortcuts.hrefs.join() === '#graph/timeline,#graph' && shortcuts.bottom <= h, JSON.stringify(shortcuts))
  const txt = await page.locator('.hm-root').innerText()
  check(`${T}：① 有分數 71、連 3 天上升、今年已過 %`, /71/.test(txt) && /連 3 天上升/.test(txt) && /已過\s*\d+%/.test(txt))
  check(`${T}：① 一句話含最大短板「財務自由」（biggestDrag：68 分 × 27%）`, /最大的短板是「財務自由」（68 分，拉低總分 8\.6 分）/.test(txt))
  const dimNames = await page.locator('.hm-dim:not(.hm-dim--ghost) .hm-dim-name').allInnerTexts()
  check(`${T}：② 六張面向小卡，名稱＝財務自由／身體／從容／心智／社交／旅遊`, dimNames.length === 6 && ['財務自由', '身體', '從容', '心智', '社交', '旅遊'].every((n, k) => dimNames[k].includes(n)), dimNames.join('|'))
  check(`${T}：② 舊名稱不再出現（人生自由／健身習慣／生活從容／心智指標／社交指標／旅遊生活）`, !/人生自由|健身習慣|生活從容|心智指標|社交指標|旅遊生活/.test(await page.locator('.hm-dimsec').innerText()))
  const colors = await page.evaluate(() => [...document.querySelectorAll('.hm-dim:not(.hm-dim--ghost)')].map((e) => getComputedStyle(e).getPropertyValue('--dim').trim().toLowerCase()))
  check(`${T}：② 識別色＝#d9b44a／#3fb6a8／#5f9bf0／#9b8cf0／#ee7a6e／#f29e4c`, colors.join(',') === '#d9b44a,#3fb6a8,#5f9bf0,#9b8cf0,#ee7a6e,#f29e4c', colors.join(','))
  check(`${T}：② 接口沒有 components → 沒有迷你線，維持六條數值條`, (await page.locator('.hm-dim svg, .hm-dim-spark').count()) === 0 && (await page.locator('.hm-dim-bar').count()) === 6)
  check(`${T}：② 沒有任何「沒有資料來源／錯誤」提示字樣`, !/沒有資料來源|無法取得走勢|迷你線/.test(await page.locator('.hm-dimsec').innerText()))
  check(`${T}：③ 年熱圖 365 格`, (await page.locator('.hm-cell[data-date]').count()) === 365)
  const emptyCells = await page.locator('.hm-cell[data-date].is-empty').count()
  const filled = await page.locator('.hm-cell[data-date]:not(.is-empty)').count()
  check(`${T}：熱圖沒資料的日子是空格（空 ${emptyCells} / 有 ${filled}）`, emptyCells > 100 && filled > 150 && emptyCells + filled === 365)
  check(`${T}：③ 知識庫 186／1,156／74／31 與本週 +23`, /186/.test(txt) && /1,156/.test(txt) && /74/.test(txt) && /本週 \+23/.test(txt))
  const badges = await page.locator('.hm-mile').allInnerTexts()
  check(`${T}：③ 里程碑膠囊（事件突破 1,000／人物突破 100／概念突破 50／方法突破 25／已實行 1 個想法／去過 25 個地點，共 ${badges.length} 顆 ≤ 6）`,
    badges.length === 6 && ['事件突破 1,000', '人物突破 100', '概念突破 50', '方法突破 25', '已實行 1 個想法', '去過 25 個地點'].every((b, k) => badges[k].includes(b)), badges.join('|'))
  const nextTxt = await page.locator('.hm-next-text').innerText()
  check(`${T}：③ 「下一個」＝比例最高的一組（人物 200，186/200）`, /下一個：人物 200（目前 186，還差 14）/.test(nextTxt), nextTxt)
  check(`${T}：③ 「下一個」進度條 93%`, (await page.locator('.hm-next-bar').getAttribute('aria-valuenow')) === '93')
  check(`${T}：③ 兩個入口 #graph/timeline 與 #graph`, (await page.locator('.hm-growth a[href="#graph/timeline"]').count()) === 1 && (await page.locator('.hm-growth a[href="#graph"]').count()) === 1)
  check(`${T}：④ 想法庫前三名`, (await page.locator('.hm-idea').count()) === 3)
  check(`${T}：④ 26 筆全為去過 → 「還沒有想吃的紀錄」連 #food`, /還沒有想吃的紀錄/.test(txt) && (await page.locator('.hm-fun a[href="#food"]').count()) >= 1 && /已去過 26 \/ 26/.test(txt))
  check(`${T}：④ 最新一趟遊記（台南三日散步、3 天、已結束）連 #trips/<id>`, /台南三日散步/.test(txt) && /3 天・已結束/.test(txt) && (await page.locator('.hm-fun a[href="#trips/tainan-2609"]').count()) === 1)
  check(`${T}：⑤ 全部正常`, /全部正常/.test(txt) && (await page.locator('.hm-sys[data-level="ok"]').count()) === 1)
  check(`${T}：沒有頁面錯誤`, errors.length === 0, errors.join(' | ').slice(0, 300))
  if ((w === 1440 && h === 900) || (w === 1920 && h === 1080) || (w === 1366 && h === 768) || (w === 1536 && h === 864)) await page.screenshot({ path: path.join(SHOTS, `home-${w}x${h}.png`) })
  if (w === 1440) {
    const dEntries = await page.evaluate(() => ({ pill: !!document.querySelector('[data-testid="food-entry-pill"]')?.getClientRects().length, text: document.body.innerText }))
    check(`${T}：電腦版頁首與側欄都沒有美食地圖入口（膠囊只在手機）`, !dEntries.pill, JSON.stringify({ pill: dEntries.pill }))
    check(`${T}：整頁沒有 ①～⑤ 或「04」這類意義不明的數字符號`, !/[①②③④⑤]/.test(dEntries.text) && !/(^|\n)04(\s|\n)/.test(dEntries.text), (dEntries.text.match(/[①②③④⑤]|(^|\n)04(\s|\n)/g) ?? []).join(','))
    // 互動：點小卡開幸福指數抽屜、ESC 關；⑤ 開戰情室抽屜；想法開想法庫抽屜
    await page.locator('.hm-score').first().click()
    await page.waitForSelector('.bd-drawer', { timeout: 5000 })
    check(`${T}：點今天的大分數 → 開幸福指數詳情抽屜`, /幸福指數詳情/.test(await page.locator('.bd-drawer').getAttribute('aria-label')))
    const drawerTxt = await page.locator('.bd-drawer').innerText()
    check(`${T}：抽屜的雷達與權重列用新名稱（財務自由／身體／從容／心智／社交／旅遊）`, ['財務自由', '身體', '從容', '心智', '社交', '旅遊'].every((n) => drawerTxt.includes(n)) && !/人生自由|健身習慣|生活從容/.test(drawerTxt), drawerTxt.slice(0, 160).replace(/\n/g, '|'))
    await page.keyboard.press('Escape')
    check(`${T}：ESC 關閉抽屜`, (await page.locator('.bd-drawer').count()) === 0)
    await page.locator('.hm-sys-bar').click()
    await page.waitForSelector('.bd-drawer')
    await page.waitForTimeout(600)
    check(`${T}：點 ⑤ → 開戰情室抽屜（推送健康在最上）`, /HERMES 戰情室/.test(await page.locator('.bd-drawer').getAttribute('aria-label')) && /入口網推送健康/.test(await page.locator('.bd-drawer').innerText()))
    await page.waitForSelector('[data-testid="kb-health"]', { timeout: 5000 })
    const kb = await page.locator('[data-testid="kb-health"]').innerText()
    check(`${T}：戰情室有「知識庫體檢」：本週新事件 23、佇列積壓、L3 最近落地、健康分 72（四項）`, /本週新事件/.test(kb) && /23/.test(kb) && /佇列積壓/.test(kb) && /L3 最近落地/.test(kb) && /知識庫健康分/.test(kb) && /72/.test(kb) && /轉化 90・連結 80・活化 55・節奏 66/.test(kb), kb.replace(/\n/g, '|').slice(0, 200))
    await page.keyboard.press('Escape')
    check(`${T}：有「付費服務」卡，五個服務都在（Ollama、Claude Pro、JEV、Tavily、DeepSeek）`, (await page.locator('.hm-svc [data-testid^="svc-chip-"]').count()) === 5)
    await page.locator('.hm-svc-bar').click()
    await page.waitForSelector('.bd-drawer .hm-svc-list')
    const svcTxt = await page.locator('.bd-drawer').innerText()
    check(`${T}：付費服務抽屜：DeepSeek 餘額自動讀到、Tavily 提示未設金鑰、Claude Pro／JEV 只有連結、Ollama 有「更新餘額」`, /¥88\.50/.test(svcTxt) && /未設定 TAVILY_API_KEY/.test(svcTxt) && (await page.locator('[data-testid="svc-row-claude"] a[href^="https://"]').count()) === 1 && (await page.locator('[data-testid="svc-row-jev"] a[href^="https://"]').count()) === 1 && /更新餘額|輸入目前餘額/.test(svcTxt), svcTxt.replace(/\n/g, '|').slice(0, 240))
    await page.keyboard.press('Escape')
    await page.locator('.hm-idea').first().click()
    await page.waitForSelector('.bd-drawer')
    check(`${T}：點想法 → 開想法庫抽屜`, /想法庫/.test(await page.locator('.bd-drawer').getAttribute('aria-label')))
    await page.keyboard.press('Escape')
    // 鍵盤：Tab 能走到小卡與 ⑤
    await page.locator('.hm-nav-item').first().focus()
    const seen = new Set()
    for (let i = 0; i < 60; i++) { await page.keyboard.press('Tab'); const c = await page.evaluate(() => document.activeElement?.className?.toString().split(' ')[0] ?? ''); seen.add(c) }
    check(`${T}：鍵盤 Tab 走得到分數、面向小卡、想法、⑤`, ['hm-score', 'hm-dim', 'hm-idea', 'hm-sys-bar'].every((k) => seen.has(k)), [...seen].join(','))
    // 預設首頁不再有「預覽版」標示
    check(`${T}：頁首沒有「預覽版」徽章、也沒有「回到目前首頁」`, (await page.locator('.hm-preview-badge, .hm-back').count()) === 0 && !/預覽版|回到目前首頁/.test(await page.locator('body').innerText()))
    check(`${T}：頁首保留（翰翰儀表板、版本歷程、帳號）`, /翰翰儀表板/.test(await page.locator('h1').innerText()) && /版本歷程/.test(await page.locator('body').innerText()))
    await page.locator('button', { hasText: '版本歷程' }).click()
    await page.waitForTimeout(300)
    check(`${T}：版本歷程最新是 2.36.0，寫出使用者看得到的變化`, /2\.36\.0/.test(await page.locator('body').innerText()) && /新首頁成為預設首頁/.test(await page.locator('body').innerText()))
    await page.keyboard.press('Escape')
  }
  await ctx.close()
}

// ═══ 2. 想吃狀態、異常（燈變色並上移）═══
{
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, 'wantfood')
  await page.waitForSelector('.hm-tile-link'); await settle(page)
  const t = await page.locator('.hm-fun').innerText()
  check('想吃最久：顯示店名、地區、想吃 268 天了', /示範・鱔魚意麵/.test(t) && /台南 中西/.test(t) && /想吃 268 天了/.test(t) || /想去 268 天了/.test(t), t.replace(/\n/g, ' | ').slice(0, 200))
  const eatTxt = await page.locator('[data-testid="hm-want-eat"]').innerText(), goTxt = await page.locator('[data-testid="hm-want-go"]').innerText()
  check('首頁：想吃（美食）與想去（景點）各列出等最久的一個', /示範・鱔魚意麵/.test(eatTxt) && /想吃 268 天了/.test(eatTxt) && /示範・想去的山/.test(goTxt) && /苗栗 三義/.test(goTxt) && /想去 100 天了/.test(goTxt), `${eatTxt} | ${goTxt}`.replace(/\n/g, ' '))
  await page.evaluate(() => { location.hash = 'food' })
  await page.waitForSelector('.fm-page'); await settle(page)
  const stat = await page.locator('.fm-stats').innerText()
  check('美食地圖：統計卡分成「想吃」與「想去」兩個數字', /想吃\s*1\b/.test(stat.replace(/\n/g, ' ')) && /想去\s*1\b/.test(stat.replace(/\n/g, ' ')), stat.replace(/\n/g, ' | '))
  const head = await page.locator('.fm-page header').innerText()
  check('美食地圖：頁首同時有「想吃最久」與「想去最久」', /想吃最久：示範・鱔魚意麵（268 天）/.test(head) && /想去最久：示範・想去的山（100 天）/.test(head), head.replace(/\n/g, ' | '))
  const btnTexts = async () => (await page.locator('.fm-page button').allInnerTexts()).join('|')
  check('狀態篩選：全部種類時寫「想吃／想去」', (await btnTexts()).includes('🔖 想吃／想去') && (await btnTexts()).includes('想吃／想去最久'))
  await page.locator('.fm-page button', { hasText: '🧭 旅遊' }).click()
  check('狀態篩選：選旅遊 → 「想去」，排序 → 「想去最久」', (await btnTexts()).includes('🔖 想去|') && (await btnTexts()).includes('想去最久'), await btnTexts())
  await page.locator('.fm-page button', { hasText: '🍜 美食' }).click()
  check('狀態篩選：選美食 → 「想吃」，排序 → 「想吃最久」', (await btnTexts()).includes('🔖 想吃|') && !(await btnTexts()).includes('🔖 想去'), await btnTexts())
  await ctx.close()
}
for (const [w, h] of [[1366, 768], [1440, 900], [1536, 864], [1920, 1080]]) {
  const { ctx, page, errors } = await open({ width: w, height: h }, 'alert')
  await page.waitForSelector('.hm-sys .hm-lamp'); await settle(page)
  const g = await geom(page)
  const T = `${w}×${h} 異常`
  check(`${T}：data-sys=alert，⑤ 移到 ① 下方（today 底 ${g.today.bottom} ≈ sys 頂 ${g.sys.top}）`, (await page.locator('.hm-root[data-sys="alert"]').count()) === 1 && Math.abs(g.sys.top - g.today.bottom) <= 14 && g.sys.top < g.dims.top)
  const lamp = await page.evaluate(() => getComputedStyle(document.querySelector('.hm-sys .hm-lamp')).backgroundColor)
  check(`${T}：燈變色（crit 紅 ${lamp}）`, /226, 88, 79/.test(lamp))
  const t = await page.locator('.hm-sys').innerText()
  check(`${T}：寫出原因（管線 L3、Ollama、推送、硬碟）`, /管線 L3 失敗（14 小時前）：apply 失敗/.test(t) && /Ollama 會在補點前用完/.test(t), t.replace(/\n/g, ' | ').slice(0, 300))
  check(`${T}：頁面可往下捲、不被截掉`, g.scrollH >= g.clientH, `${g.scrollH}/${g.clientH}`)
  const cl = await clippedCards(page); const ic = await innerClipped(page)
  check(`${T}：異常時卡片與小卡沒被裁切`, cl.length === 0 && ic.length === 0, JSON.stringify([...cl, ...ic]))
  check(`${T}：沒有頁面錯誤`, errors.length === 0, errors.join(' | ').slice(0, 300))
  if (w === 1440 || w === 1920) await page.screenshot({ path: path.join(SHOTS, `home-alert-${w}x${h}.png`) })
  await ctx.close()
}

// ═══ 3. 每面向 30 天迷你線 ═══
for (const [w, h] of [[1366, 768], [1440, 900], [1536, 864], [1920, 1080]]) {
  const { ctx, page, errors, calls } = await open({ width: w, height: h }, 'spark')
  await page.waitForSelector('.hm-dim .hm-dim-num'); await page.waitForSelector('.hm-dim-spark'); await settle(page)
  const g = await geom(page)
  const T = `${w}×${h} 迷你線`
  const sparks = await page.locator('.hm-dim-spark').count()
  check(`${T}：有資料的面向畫迷你線（${sparks} 條；travel 只有 1 天資料 → 不畫，共 5 條）`, sparks === 5 && (await page.locator('.hm-dim:has(.hm-dim-spark)').count()) === 5 && (await page.locator('.hm-dim:not(.has-spark) .hm-dim-bar').count()) === 1)
  check(`${T}：所有小卡仍保有數值條（${await page.locator('.hm-dim-bar').count()} 條）`, (await page.locator('.hm-dim-bar').count()) === 6)
  check(`${T}：有向 /api/happiness/history?days=30 取資料`, calls.includes('/api/happiness/history?days=30'), calls.filter((c) => /history/.test(c)).join(','))
  const strokes = await page.evaluate(() => [...document.querySelectorAll('.hm-dim:not(.hm-dim--ghost)')].map((e) => { const l = e.querySelector('.hm-spark-line'); return l ? getComputedStyle(l).stroke : null }))
  const dims = await page.evaluate(() => [...document.querySelectorAll('.hm-dim:not(.hm-dim--ghost)')].map((e) => getComputedStyle(e).getPropertyValue('--dim').trim()))
  const hexToRgb = (hx) => { const n = parseInt(hx.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})` }
  check(`${T}：迷你線用該面向的識別色`, strokes.every((c, k) => c === null || c === hexToRgb(dims[k])), JSON.stringify(strokes))
  // social 中間 3 天沒資料 → 兩段線（斷線），不補 0
  const polylines = await page.evaluate(() => [...document.querySelectorAll('.hm-dim:not(.hm-dim--ghost)')].map((e) => e.querySelectorAll('.hm-spark-line').length))
  check(`${T}：social 中間缺 3 天 → 斷成 2 段（各面向線段數 ${polylines.join('/')}）`, polylines[4] === 2 && polylines[0] === 1 && polylines[1] === 1 && polylines[3] === 1)
  const endDots = await page.locator('.hm-dim .hm-spark-end').count()
  check(`${T}：每條線的終點標一個點（${endDots}）`, endDots === 5)
  const deltas = await page.locator('.hm-spark-delta').allInnerTexts()
  const deltaColors = await page.evaluate(() => [...document.querySelectorAll('.hm-spark-delta')].map((e) => getComputedStyle(e).color))
  check(`${T}：最後一個值與昨天的差用 ▲／▼ 小字（${deltas.join('、')}）`, deltas.length >= 3 && deltas.every((d) => /^(▲ \d+|▼ \d+|— 0)$/.test(d)))
  const calmDelta = await page.locator('.hm-dim', { hasText: '從容' }).locator('.hm-spark-delta').innerText()
  const mindDelta = await page.locator('.hm-dim', { hasText: '心智' }).locator('.hm-spark-delta').innerText()
  check(`${T}：變好 ▲ 綠、變差 ▼ 紅（心智 ${mindDelta}、從容 ${calmDelta}）`, /^▲/.test(mindDelta) && /^▼/.test(calmDelta) && deltaColors.some((c) => /95, 191, 122|63, 182|\d+/.test(c)) && (await page.locator('.hm-dim', { hasText: '心智' }).locator('.hm-spark-delta').evaluate((e) => getComputedStyle(e).color)) !== (await page.locator('.hm-dim', { hasText: '從容' }).locator('.hm-spark-delta').evaluate((e) => getComputedStyle(e).color)))
  const svgW = await page.locator('.hm-dim .hm-spark svg').first().evaluate((e) => e.getBoundingClientRect().width)
  check(`${T}：迷你線寬度自適應（${Math.round(svgW)}px，不超出小卡）`, svgW > 60 && (await innerClipped(page)).length === 0, String(svgW))
  check(`${T}：不裁切`, (await clippedCards(page)).length === 0, `${g.scrollH}/${g.clientH}；${JSON.stringify(await clippedCards(page))}`)
  check(`${T}：沒有頁面錯誤`, errors.length === 0, errors.join(' | ').slice(0, 300))
  if (w === 1440 || w === 1366) await page.screenshot({ path: path.join(SHOTS, `home-spark-${w}x${h}.png`) })
  if (w === 1440) {
    await page.locator('.hm-dimsec').screenshot({ path: path.join(SHOTS, 'home-spark-dims-1440.png') })
    check(`${T}：aria-label 描述走勢（螢幕閱讀器）`, /近 30 天走勢，\d+ 天有資料，最新 \d+ 分/.test((await page.locator('.hm-dim-spark').first().getAttribute('aria-label')) ?? ''))
    // 減少動態：不做進場動畫
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.hm-spark')).animationName)
    check(`${T}：prefers-reduced-motion 時迷你線沒有進場動畫（animation-name ${anim}）`, anim === 'none')
  }
  await ctx.close()
}
for (const scn of ['spark-bad', 'spark-one', 'spark-fail']) {
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, scn)
  await page.waitForSelector('.hm-dim .hm-dim-num'); await settle(page)
  const t = await page.locator('.hm-dimsec').innerText()
  check(`${scn}（欄位形狀不對／只有一點／接口失敗）：不畫迷你線，維持六條數值條，沒有錯誤提示`, (await page.locator('.hm-dim-spark, .hm-dim svg').count()) === 0 && (await page.locator('.hm-dim-bar').count()) === 6 && !/錯誤|失敗|暫時無法/.test(t), t.replace(/\n/g, '|').slice(0, 120))
  const g = await geom(page)
  check(`${scn}：不裁切`, (await clippedCards(page)).length === 0)
  check(`${scn}：沒有頁面錯誤`, errors.length === 0, errors.join('|'))
  await ctx.close()
}
{ // 迷你線＋異常：⑤ 上移後各面向小卡仍不裁切
  for (const [w, h] of [[1366, 768], [1440, 900]]) {
    const { ctx, page, errors } = await open({ width: w, height: h }, 'spark-alert')
    await page.waitForSelector('.hm-dim-spark'); await settle(page)
    const g = await geom(page)
    check(`${w}×${h} 迷你線＋異常：不裁切`, (await clippedCards(page)).length === 0 && (await innerClipped(page)).length === 0, `${g.scrollH}/${g.clientH}；${JSON.stringify(await innerClipped(page))}`)
    if (w === 1440) await page.screenshot({ path: path.join(SHOTS, 'home-spark-alert-1440x900.png') })
    await ctx.close()
  }
}

// ═══ 3b. 錨點導覽與倉庫索引（2026-10-22）═══
{
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, 'normal')
  await page.waitForSelector('.hm-repo'); await settle(page)
  await page.locator('.hm-nav-item', { hasText: '倉庫' }).click()
  await page.waitForTimeout(1200)
  const top = await page.evaluate(() => document.getElementById('sec-repos').getBoundingClientRect().top)
  check(`導覽：點「倉庫」捲到倉庫區（區塊上緣離視窗頂 ${Math.round(top)}px）`, top >= 0 && top < 450)
  check('導覽：捲到那裡後，「倉庫」按鈕高亮（aria-current）', (await page.locator('.hm-nav-item[aria-current="location"]').innerText()).includes('倉庫'))
  await page.locator('.hm-repos-langs .hm-pill', { hasText: 'Python' }).click()
  check('倉庫：語言篩選 Python → 只剩 1 個（kb-pipeline；封存的 old-thing 預設隱藏）', (await page.locator('.hm-repo').count()) === 1 && /kb-pipeline/.test(await page.locator('.hm-repo').first().innerText()))
  await page.locator('.hm-repos-langs .hm-pill', { hasText: '全部' }).click()
  await page.locator('.hm-repos-q').fill('入口')
  check('倉庫：搜尋「入口」比對描述 → Aiportal', (await page.locator('.hm-repo').count()) === 1 && /Aiportal/.test(await page.locator('.hm-repo').first().innerText()))
  await page.locator('.hm-repos-q').fill('')
  await page.getByLabel('含封存', { exact: false }).check()
  check('倉庫：勾「含封存」多出封存的倉庫', (await page.locator('.hm-repos').innerText()).includes('封存'))
  check('倉庫：連結開新分頁且帶 noreferrer，有填網站的倉庫另有「🌐 網站」連結', await page.evaluate(() => { const a = document.querySelector('.hm-repo-main'); const w = document.querySelector('.hm-repo-site'); return a.target === '_blank' && /noreferrer/.test(a.rel) && !!w && w.target === '_blank' && /noopener/.test(w.rel) && w.href === 'https://aiportal.example.test/' }))
  check('倉庫：有設 token 時不顯示「只顯示公開倉庫」提示', !/GITHUB_TOKEN/.test(await page.locator('.hm-repos').innerText()))
  check('導覽與倉庫：沒有頁面錯誤', errors.length === 0, errors.join('|'))
  await ctx.close()
}
{
  const { ctx, page } = await open({ width: 1440, height: 900 }, 'repos-no-token')
  await page.waitForSelector('.hm-repo'); await settle(page)
  check('倉庫：伺服器沒設 token → 明講只顯示公開倉庫', /只顯示公開倉庫.*GITHUB_TOKEN/.test(await page.locator('.hm-repos').innerText()))
  await ctx.close()
}
{
  const { ctx, page } = await open({ width: 1440, height: 900 }, 'error')
  await page.waitForSelector('.hm-dim .hm-dim-num'); await settle(page)
  check('倉庫：抓取失敗 → 「暫時無法取得」＋重試鈕，其他區塊不受影響', /GitHub 倉庫暫時無法取得/.test(await page.locator('.hm-repos').innerText()) && (await page.locator('.hm-repos .hm-retry').count()) === 1)
  await ctx.close()
}
{
  const { ctx, page } = await open({ width: 390, height: 844 }, 'normal')
  await page.waitForSelector('.hm-repo'); await settle(page)
  check('手機：導覽是頂部橫排（寬 > 高），可橫向滑動', await page.evaluate(() => { const n = document.querySelector('.hm-nav').getBoundingClientRect(); return n.height < 80 && n.width > 300 }))
  const g = await geom(page)
  check('手機：倉庫卡片沒有造成橫向捲動', g.docW <= g.innerW && g.scW <= g.scCW + 1)
  await ctx.close()
}

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
  await page.waitForSelector('.hm-root', { timeout: 10000 })
  check('架構頁：返回 → 回到首頁（hash 清空）', (await page.evaluate(() => location.hash)) === '' && (await page.locator('.hm-root').count()) === 1)
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
{
  const { ctx, page } = await open({ width: 1440, height: 900 }, 'normal')
  await page.waitForSelector('.hm-dim .hm-dim-num'); await settle(page)
  await page.locator('[data-testid="hm-arch-link"]').click()
  await page.waitForSelector('.ar-node', { timeout: 10000 })
  check('首頁「成長軌跡 → 知識庫架構」連結可進架構頁', (await page.evaluate(() => location.hash)) === '#architecture')
  await ctx.close()
}

// ═══ 4. 手機：順序與橫向捲動 ═══
for (const [w, h] of [[390, 844], [360, 740]]) {
  for (const scn of ['normal', 'alert', 'spark']) {
    const { ctx, page, errors } = await open({ width: w, height: h }, scn)
    await page.waitForSelector('.hm-dim .hm-dim-num'); await settle(page)
    const g = await geom(page)
    const T = `手機 ${w}×${h} ${scn}`
    check(`${T}：不橫向捲動`, g.docW <= g.innerW && g.scW <= g.scCW + 1, `${g.docW}/${g.innerW}, ${g.scW}/${g.scCW}`)
    const order = scn !== 'alert' ? g.today.top < g.dims.top && g.dims.top < g.fun.top && g.fun.top < g.growth.top && g.growth.top < g.sys.top
      : g.today.top < g.sys.top && g.sys.top < g.dims.top && g.dims.top < g.fun.top && g.fun.top < g.growth.top
    check(`${T}：順序 ${scn !== 'alert' ? '① → ② → ④ → ③ → ⑤（細列在最後）' : '① → ⑤ → ② → ④ → ③'}`, order, JSON.stringify({ t: g.today.top, s: g.sys.top, d: g.dims.top, f: g.fun.top, gr: g.growth.top }))
    const cols = await page.evaluate(() => { const d = [...document.querySelectorAll('.hm-dim:not(.hm-dim--ghost)')].map((e) => Math.round(e.getBoundingClientRect().left)); return new Set(d).size })
    check(`${T}：② 兩欄`, cols === 2, String(cols))
    const cl = await clippedCards(page); const ic = await innerClipped(page)
    check(`${T}：沒有內容被裁切`, cl.length === 0 && ic.length === 0, JSON.stringify([...cl, ...ic]))
    check(`${T}：熱圖 365 格`, (await page.locator('.hm-cell[data-date]').count()) === 365)
    check(`${T}：沒有頁面錯誤`, errors.length === 0, errors.join(' | ').slice(0, 300))
    // 手機的工具連結（頁面最下面）與頁首入口
    if (scn === 'normal') {
      check(`${T}：頁首有「🍜🧭 美食及旅遊地圖」入口、沒有工具連結區`, (await page.locator('[data-testid="food-entry-pill"]').isVisible()) && (await page.locator('.ip-tools').count()) === 0)
      // 整頁合理性：美食入口只出現一個（手機＝頁首膠囊；側欄已沒有大卡）、沒有意義不明的數字符號
      const entries = await page.evaluate(() => ({ pill: !!document.querySelector('[data-testid="food-entry-pill"]')?.getClientRects().length, text: document.body.innerText }))
      check(`${T}：美食及旅遊地圖入口只有一個（頁首膠囊）`, entries.pill, JSON.stringify({ pill: entries.pill }))
      check(`${T}：整頁沒有 ①～⑤ 或「04」這類意義不明的數字符號`, !/[①②③④⑤]/.test(entries.text) && !/(^|\n)04(\s|\n)/.test(entries.text), (entries.text.match(/[①②③④⑤]|(^|\n)04(\s|\n)/g) ?? []).join(','))
      // 首屏利用率：頁首壓成一小條，②面向小卡的上緣在第一屏內（原本頁首獨佔近半個螢幕、② 要捲很久才看到）
      const top = await page.evaluate(() => { const r = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect() : null }; const hd = r('.ip-head'), td = r('.hm-today'), dm = r('.hm-dimsec'), sc = r('.hm-score-n'), mt = r('.hm-score-meta'); return { headH: Math.round(hd.height), todayH: Math.round(td.height), dimsTop: Math.round(dm.top), scoreTop: Math.round(sc.top), metaTop: Math.round(mt.top), scoreRight: Math.round(sc.right), metaLeft: Math.round(mt.left) } })
      check(`${T}：頁首壓成一條（高 ${top.headH}px ≤ ${Math.round(h * 0.17)}px）`, top.headH <= h * 0.17, JSON.stringify(top))
      check(`${T}：① 今天卡不超過首屏 40%（${top.todayH}px）`, top.todayH <= h * 0.4, JSON.stringify(top))
      check(`${T}：② 面向小卡的上緣在首屏內，且露出至少 100px（${top.dimsTop}px）`, top.dimsTop + 100 <= h, JSON.stringify(top))
      check(`${T}：分數與等級／差並排（同一列，分數在左）`, Math.abs(top.scoreTop - top.metaTop) < 60 && top.metaLeft >= top.scoreRight - 2, JSON.stringify(top))
      // 手機頁首跟著內容捲走（不釘在最上面）
      const sc = await page.evaluate(async () => { const sh = document.querySelector('.ip-shell'); sh.scrollTo({ top: 500 }); await new Promise((r) => setTimeout(r, 200)); const hd = document.querySelector('.ip-head').getBoundingClientRect(); return { top: Math.round(sh.scrollTop), headBottom: Math.round(hd.bottom) } })
      check(`${T}：往下捲時頁首跟著捲走（scrollTop ${sc.top}、頁首下緣 ${sc.headBottom}）`, sc.top > 300 && sc.headBottom <= 0, JSON.stringify(sc))
      await page.evaluate(() => document.querySelector('.ip-shell').scrollTo({ top: 0 }))
      if (w === 390) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, 'home-mobile-390-first-screen.png') }) }
      check(`${T}：手機面向卡也有子系統連結`, (await page.locator('.hm-dim-open').count()) === 3)
    }
    if (scn === 'spark') {
      check(`${T}：迷你線有畫、寬度不超出小卡`, (await page.locator('.hm-dim-spark').count()) === 5 && (await page.evaluate(() => [...document.querySelectorAll('.hm-dim-spark')].every((e) => e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().right <= e.closest('.hm-dim').getBoundingClientRect().right + 1))))
    }
    if (w === 390 && scn === 'normal') {
      await page.screenshot({ path: path.join(SHOTS, 'home-mobile-390-top.png') })
      await page.setViewportSize({ width: 390, height: 2600 }); await page.waitForTimeout(400)
      await page.screenshot({ path: path.join(SHOTS, 'home-mobile-390-full.png') })
    }
    if (w === 390 && scn === 'alert') { await page.setViewportSize({ width: 390, height: 2600 }); await page.waitForTimeout(400); await page.screenshot({ path: path.join(SHOTS, 'home-mobile-390-alert-full.png') }) }
    if (w === 390 && scn === 'spark') { await page.setViewportSize({ width: 390, height: 2600 }); await page.waitForTimeout(400); await page.screenshot({ path: path.join(SHOTS, 'home-mobile-390-spark-full.png') }) }
    if (w === 360 && scn === 'normal') { await page.setViewportSize({ width: 360, height: 2600 }); await page.waitForTimeout(400); await page.screenshot({ path: path.join(SHOTS, 'home-mobile-360-full.png') }) }
    await ctx.close()
  }
}
// 平板、寬而矮、窄桌面（1100–1299：主區太窄，改堆疊並捲動）
for (const [w, h] of [[820, 1180], [1280, 600], [1280, 720], [1100, 800]]) {
  const { ctx, page, errors } = await open({ width: w, height: h }, 'spark')
  await page.waitForSelector('.hm-dim .hm-dim-num'); await settle(page)
  const g = await geom(page)
  check(`${w}×${h}：堆疊版型不橫向捲動、無裁切`, g.docW <= g.innerW && g.scW <= g.scCW + 1 && (await clippedCards(page)).length === 0 && (await innerClipped(page)).length === 0, JSON.stringify([g.docW, g.innerW, g.scW, g.scCW, await clippedCards(page), await innerClipped(page)]))
  if (w >= 1100) {
    check(`${w}×${h}：沒有工具連結側欄`, (await page.locator('.ip-aside, .ip-tools').count()) === 0)
    await page.evaluate(() => { const s = document.querySelector('.ip-scroll'); s.scrollTop = s.scrollHeight })
    const last = await page.locator('.hm-sys').boundingBox()
    check(`${w}×${h}：捲到底看得到 ⑤（沒被切掉）`, last.y + last.height <= h + 1, JSON.stringify(last))
  }
  check(`${w}×${h}：沒有頁面錯誤`, errors.length === 0)
  if (w === 1280 && h === 720) await page.screenshot({ path: path.join(SHOTS, 'home-1280x720.png') })
  await ctx.close()
}

// ═══ 5. 狀態機 ═══
{ // 未解鎖
  const { ctx, page, errors, calls } = await open({ width: 1440, height: 900 }, 'normal', { unlocked: false })
  await settle(page, 600)
  const t = await page.locator('.hm-root').innerText()
  check('未解鎖：私領域區塊都寫「🔒 解鎖後顯示」（①②③④⑤）', (t.match(/🔒 解鎖後顯示/g) ?? []).length >= 7, String((t.match(/🔒 解鎖後顯示/g) ?? []).length))
  check('未解鎖：不顯示任何假分數（沒有 71、186、1,156）', !/\b71\b|186|1,156/.test(t))
  check('未解鎖：「一眼看」不露出最弱面向與系統燈（只留今年進度）', (await page.locator('[data-testid="hm-glance-drag"], [data-testid="hm-glance-sys"]').count()) === 0 && !/最弱面向/.test(t))
  check('未解鎖：今年已過 % 仍可顯示（不是私領域資料）', /已過\s*\d+%/.test(t))
  check('未解鎖：沒有向私領域 API 發請求', !calls.some((c) => /hermes-|happiness\/history/.test(c)), calls.join(','))
  const g = await geom(page)
  check('未解鎖：不被裁切', (await clippedCards(page)).length === 0)
  check('未解鎖：沒有里程碑假資料、沒有迷你線', (await page.locator('.hm-mile, .hm-next, .hm-dim-spark').count()) === 0)
  check('未解鎖：沒有工具連結區，也沒有任何子系統連結（/api/sites 未解鎖回空）', (await page.locator('.ip-tools').count()) === 0 && (await page.locator('.hm-dim-open').count()) === 0)
  await page.screenshot({ path: path.join(SHOTS, 'home-state-locked-1440x900.png') })
  await page.locator('.hm-today .hm-lock').click()
  check('未解鎖：點「🔒 解鎖後顯示」會開解鎖視窗', (await page.locator('input[type=password]').count()) >= 1)
  check('未解鎖：沒有頁面錯誤', errors.length === 0, errors.join('|'))
  await ctx.close()
}
{ // 未解鎖＋手機
  const { ctx, page, errors, calls } = await open({ width: 390, height: 844 }, 'normal', { unlocked: false })
  await settle(page, 600)
  const g = await geom(page)
  check('未解鎖 手機：不橫向捲動、不發私領域請求', g.docW <= g.innerW && !calls.some((c) => /hermes-|happiness\/history/.test(c)))
  await page.setViewportSize({ width: 390, height: 2600 }); await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(SHOTS, 'home-mobile-390-locked-full.png') })
  check('未解鎖 手機：沒有頁面錯誤', errors.length === 0, errors.join('|'))
  await ctx.close()
}
{ // 載入中
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, 'loading')
  await page.waitForTimeout(900)
  const busy = await page.locator('.hm-frame[aria-busy="true"]').count()
  const skel = await page.locator('.hm-skel').count()
  const t = await page.locator('.hm-root').innerText()
  check(`載入中：有骨架（${skel} 組、${busy} 個 aria-busy 區塊），不寫「載入中…」字樣`, skel >= 4 && busy >= 4 && !/載入中…/.test(t))
  check('載入中：沒有假數字（沒有 1,156、186）', !/1,156|\b186\b/.test(t))
  await page.screenshot({ path: path.join(SHOTS, 'home-state-loading-1440x900.png') })
  await settle(page, 800)
  check('載入中 → 載完後出現資料', /1,156/.test(await page.locator('.hm-root').innerText()))
  check('載入中：沒有頁面錯誤', errors.length === 0, errors.join('|'))
  await ctx.close()
}
{ // 空（新系統：沒有歷史、沒想法、沒地點、沒遊記）
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, 'empty')
  await page.waitForSelector('.hm-dim .hm-dim-num'); await settle(page)
  const t = await page.locator('.hm-root').innerText()
  check('空：歷史沒資料 → 熱圖顯示「資料累積中」，不畫全空的圖', /資料累積中/.test(t) && (await page.locator('.hm-cell[data-date]').count()) === 0)
  check('空：① 趨勢顯示「資料累積中：再 N 天」而不是 0', /資料累積中：再 1 天會畫出趨勢/.test(t) && !/▲|▼/.test(await page.locator('.hm-today').innerText()))
  check('空：想法庫「還沒有想法」、地點「還沒有想吃的紀錄」、遊記「還沒有遊記」', /還沒有想法/.test(t) && /還沒有想吃的紀錄/.test(t) && /還沒有遊記/.test(t))
  const badges = await page.locator('.hm-mile').allInnerTexts()
  check(`空：里程碑只列確定的（事件突破 1,000、人物突破 100、概念突破 50、方法突破 25；遊記 0 與地點 0 不列膠囊，下一個＝人物 200）`, badges.join('|').includes('事件突破 1,000') && !/遊記|去過|已實行|幸福指數紀錄/.test(badges.join('|')) && /下一個：人物 200/.test(await page.locator('.hm-next-text').innerText()), badges.join('|'))
  await page.screenshot({ path: path.join(SHOTS, 'home-state-empty-1440x900.png') })
  check('空：沒有頁面錯誤', errors.length === 0, errors.join('|'))
  await ctx.close()
}
{ // 失敗
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, 'error')
  await page.waitForSelector('.hm-dim .hm-dim-num'); await settle(page)
  const t = await page.locator('.hm-root').innerText()
  check('失敗：各區塊寫「暫時無法取得」並有重試鈕', /幸福指數歷史暫時無法取得/.test(t) && /想法庫暫時無法取得/.test(t) && (await page.locator('.hm-retry').count()) >= 3, String(await page.locator('.hm-retry').count()))
  check('失敗：① 趨勢說明為「趨勢暫時無法取得」，且一句話不謊稱「昨天沒有紀錄」', /趨勢暫時無法取得/.test(await page.locator('.hm-today').innerText()) && !/昨天沒有紀錄/.test(t))
  check('失敗：⑤ 燈變色並寫「管線讀取失敗」', /管線讀取失敗/.test(await page.locator('.hm-sys').innerText()) && (await page.locator('.hm-root[data-sys="alert"]').count()) === 1)
  check('失敗：分數（來自 dashboard）仍顯示 71', /71/.test(await page.locator('.hm-today').innerText()))
  check('失敗：資料來源失敗的里程碑組整組略過，不顯示 0', (await page.locator('.hm-mile').count()) === 0 && !/下一個/.test(t))
  const g = await geom(page)
  check('失敗：不裁切', (await clippedCards(page)).length === 0 && (await innerClipped(page)).length === 0, JSON.stringify(await innerClipped(page)))
  await page.screenshot({ path: path.join(SHOTS, 'home-state-error-1440x900.png') })
  check('失敗：沒有頁面錯誤', errors.length === 0, errors.join('|'))
  await ctx.close()
}
{ // 過期
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, 'stale')
  await page.waitForSelector('.hm-dim .hm-dim-num'); await settle(page)
  const badges = await page.locator('.hm-badge--stale').allInnerTexts()
  check(`過期：標「資料 n 小時前／天前」（${badges.join('、')}）`, badges.length >= 3 && badges.every((b) => /^資料 \d+ (分鐘|小時|天)前$/.test(b)))
  const op = await page.evaluate(() => getComputedStyle(document.querySelector('.hm-frame--stale > .hm-faded')).opacity)
  check(`過期：內容淡化（opacity ${op}）、數字仍顯示`, Number(op) < 0.7 && /71/.test(await page.locator('.hm-today').innerText()))
  check('過期：仍不影響燈（只是過期，不是死）', (await page.locator('.hm-root[data-sys="ok"]').count()) === 1)
  await page.screenshot({ path: path.join(SHOTS, 'home-state-stale-1440x900.png') })
  check('過期：沒有頁面錯誤', errors.length === 0, errors.join('|'))
  await ctx.close()
}
{ // 太久沒更新
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, 'dead')
  await page.waitForSelector('.hm-sys .hm-lamp'); await settle(page)
  const t = await page.locator('.hm-root').innerText()
  check('死：數字換成「—」並寫「已 n 小時／天沒有更新：來源」', /已 \d+ (小時|天)沒有更新：幸福指數/.test(t) && /已 \d+ 天沒有更新：幸福指數歷史/.test(t) && /已 \d+ 小時沒有更新：知識庫/.test(t), t.replace(/\n/g, ' | ').slice(0, 400))
  check('死：① 不再顯示分數 71', !/\b71\b/.test(await page.locator('.hm-today').innerText()))
  check('死：⑤ 燈亮並寫出哪個資料多久沒更新，且移到 ① 下方', (await page.locator('.hm-root[data-sys="alert"]').count()) === 1 && /已 \d+ (小時|天)沒有更新/.test(await page.locator('.hm-sys').innerText()))
  await page.screenshot({ path: path.join(SHOTS, 'home-state-dead-1440x900.png') })
  check('死：沒有頁面錯誤', errors.length === 0, errors.join('|'))
  await ctx.close()
}

// ═══ 6. 路由：#home 相容、#legacy 舊版首頁與退路、⌘K ═══
{ // #home：進來就回預設首頁，hash 清掉
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, 'normal', { hash: '#home' })
  await page.waitForSelector('.hm-dim .hm-dim-num')
  check('#home（舊分享連結）：顯示預設首頁（新首頁），hash 已清掉', (await page.locator('.hm-root').count()) === 1 && (await page.evaluate(() => location.hash)) === '', await page.evaluate(() => location.hash))
  check('#home：沒有「預覽版」', !/預覽版/.test(await page.locator('body').innerText()))
  check('#home：沒有頁面錯誤', errors.length === 0, errors.join('|'))
  await ctx.close()
}
{ // #legacy：完整舊版（DesktopBoard 六張卡＋側欄），頁首有「回到新首頁」
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, 'normal', { hash: '#legacy', wait: false })
  await page.waitForSelector('.bd-card', { timeout: 15000 })
  await page.waitForTimeout(1200)
  check('#legacy：舊版首頁（六張 .bd-card）、沒有新首頁元素', (await page.locator('.bd-card').count()) === 6 && (await page.locator('.hm-root').count()) === 0)
  check('#legacy：沒有工具連結側欄、沒有美食入口卡', (await page.locator('.ip-aside, .ip-tools').count()) === 0 && (await page.locator('[data-testid="food-entry"]').count()) === 0)
  const back = page.locator('.hm-legacy-back')
  check('#legacy：頁首有「舊版首頁」標示與「← 回到新首頁」連結', (await back.count()) === 1 && /舊版首頁/.test(await back.innerText()) && /回到新首頁/.test(await back.innerText()))
  const hdr = await page.evaluate(() => { const b = document.querySelector('.ip-scroll').getBoundingClientRect(); return b.top })
  await page.screenshot({ path: path.join(SHOTS, 'legacy-1440x900.png') })
  await back.click()
  await page.waitForSelector('.hm-root', { timeout: 10000 })
  check('#legacy → 點「回到新首頁」：回到新首頁、hash 清空', (await page.locator('.hm-root').count()) === 1 && (await page.evaluate(() => location.hash)) === '' && (await page.locator('.hm-legacy-back').count()) === 0)
  check('#legacy：沒有頁面錯誤', errors.length === 0, errors.join('|'))
  await ctx.close()
}
{ // #legacy 手機
  const { ctx, page, errors } = await open({ width: 390, height: 844 }, 'normal', { hash: '#legacy', wait: false })
  await page.waitForSelector('.bd-card', { timeout: 15000 })
  const g = await page.evaluate(() => ({ docW: document.documentElement.scrollWidth, w: innerWidth }))
  check('#legacy 手機：不橫向捲動、有退路連結', g.docW <= g.w && (await page.locator('.hm-legacy-back').isVisible()))
  await ctx.close()
}
// ⌘K：「舊版首頁」捷徑
{
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, 'normal')
  await page.waitForSelector('.hm-dim .hm-dim-num')
  await page.keyboard.press('Control+k')
  await page.fill('input[placeholder^="搜尋工具連結"]', '舊版')
  check('⌘K 輸入「舊版」→ 有「舊版首頁（退路）」捷徑；舊的「新首頁（預覽版）」不在', (await page.getByText('舊版首頁（退路）').count()) === 1 && (await page.getByText('新首頁（預覽版）').count()) === 0)
  await page.getByText('舊版首頁（退路）').click()
  await page.waitForSelector('.bd-card', { timeout: 10000 })
  check('⌘K 選「舊版首頁」→ 前往 #legacy', (await page.evaluate(() => location.hash)) === '#legacy')
  check('⌘K：沒有頁面錯誤', errors.length === 0, errors.join('|'))
  await ctx.close()
}

// ═══ 7. 面向頁（#dim/<key>）：六個面向各有自己的頁，不是同一個抽屜 ═══
const DIM_EXPECT = {
  lifeFreedom: { name: '財務自由', score: '68', detail: ['TWRR', 'MWRR', '休假配速'] },
  fitness: { name: '身體', score: '81', detail: ['覆蓋率', '均衡度', '本週積分'] },
  calm: { name: '從容', score: '74', detail: ['逾期壓力', '近期負荷', '停滯程度'] },
  mind: { name: '心智', score: '79', detail: ['想法分數', '日報分數'] },
  social: { name: '社交', score: '77', detail: ['廣度', '互動強度', '連結率'] },
  travel: { name: '旅遊', score: '55', detail: ['Recency', 'Frequency', '距上次旅行'] },
}
{
  // 7a 從首頁點小卡 → 進該面向的頁（網址變 #dim/<key>），不再是同一個抽屜
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, 'spark')
  await page.waitForSelector('.hm-dim .hm-dim-num'); await settle(page)
  await page.locator('.hm-dim').nth(1).click()
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
  check('面向頁：「← 首頁」回首頁', (await page.evaluate(() => location.hash)) === '' && (await page.locator('.hm-root').count()) === 1)
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
  check('面向頁：不認得的面向網址 → 當作首頁（沒有面向頁）', (await c.page.locator('[data-testid="dim-page"]').count()) === 0 && (await c.page.locator('.hm-root').count()) === 1)
  await c.ctx.close()
}

{
  // 8 年度回顧（#year）與各面向年熱圖（P2-1）
  const Y = Number(tpDate().slice(0, 4))
  const a = await open({ width: 1440, height: 900 }, 'spark')
  check('成長軌跡有「年度回顧 →」入口', (await a.page.locator('[data-testid="hm-year-link"]').count()) === 1)
  await a.page.locator('[data-testid="hm-year-link"]').click(); await a.page.waitForSelector('[data-testid="year-page"]')
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
  check('年度回顧：年份不合理（#year/1999）→ 當作首頁', (await d.page.locator('[data-testid="year-page"]').count()) === 0 && (await d.page.locator('.hm-root').count()) === 1)
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

await browser.close()
server.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed; screenshots: ${SHOTS}`)
process.exit(failed.length ? 1 : 0)
