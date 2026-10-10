// 桌面首頁儀表板（DesktopBoard）真實瀏覽器驗證（手動執行；不在 CI 內，同 timeline.e2e.mjs 的做法）。
//
// 做什麼：本機靜態伺服器提供 dist/public，以「假 API」模擬 sites／dashboard／hermes-usage／hermes-ideas／graph／pipeline／status，
// 用 Playwright 驅動 Chromium 驗證：各種桌面尺寸一個畫面放得下（頁面不需捲動就看得到六張卡）、
// 卡片內容沒有被裁切、想法庫前三名與抽屜篩選、Ollama 小卡＋抽屜輸入餘額會 POST 並重畫、手機寬度不顯示儀表板且不橫向捲動。全程不碰任何真實服務。
//
// 執行：
//   BASE_PATH=/ PORT=5174 pnpm --filter @workspace/gis-portal run build
//   PLAYWRIGHT_MODULE_DIR=/path/to/node_modules CHROMIUM_PATH=/path/to/chrome node artifacts/gis-portal/e2e/board.e2e.mjs
// 截圖輸出到 E2E_SHOTS_DIR（預設 /tmp/board-e2e-shots）。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const { chromium } = createRequire((process.env.PLAYWRIGHT_MODULE_DIR || '/opt/node22/lib/node_modules') + '/')('playwright')

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/public')
const SHOTS = process.env.E2E_SHOTS_DIR || '/tmp/board-e2e-shots'
fs.mkdirSync(SHOTS, { recursive: true })
const PWD = 'tok-test'
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }

// ── 假資料（數字沿用 2026-10-08 的實況，示範用）──
const link = (label) => [{ label, url: 'https://example.com' }]
const site = (id, name, subtitle, isPrivate, subsystemId = null) => ({ id, name, subtitle, links: link(name), worldXZ: [0, 0], isPrivate, subsystemId })
const sites = [
  site('s1', '人生進度管理系統', 'Life Progress', true), site('s2', '健身追蹤', 'Fitness Tracking', true), site('s3', '任務追蹤系統', '', true),
  site('s4', '旅遊生活', '', true), site('s5', '圖根點管理系統', 'Survey Control', false), site('s6', '案件排程系統', 'Case Scheduling', false),
  site('s7', '地籍圖套圖+調整', '', false), site('s8', 'Disk Space Analyzer', '', false), site('s9', 'NEC 地籍檔定位修正工具', '', false), site('s10', 'jpg2jgw', '', false),
]
const hhi = {
  subsystemId: 'hhi', name: '幸福指數', isPrivate: true, status: 'ok', errorMessage: null, fetchedAt: new Date().toISOString(),
  data: { displayedScore: 72, baseScore: 74.5, weakestScore: 55, finalScore: 73, weakestComponent: '旅遊生活', isSnapshotFinal: true, usingStaleData: false,
    lifeFreedomScore: 68, fitnessHabitScore: 81, calmScore: 74, mindScore: 79, socialScore: 77, travelScore: 55,
    weights: { lifeFreedomWeight: 0.27, fitnessWeight: 0.18, calmWeight: 0.15, mindWeight: 0.15, socialWeight: 0.13, travelWeight: 0.12 } },
}
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const dayAt = (i) => new Date(Date.now() + 8 * 3600e3 - i * 86400e3).toISOString().slice(0, 10)
const calls = [1430, 1296, 1300, 1102, 1430, 2240, 2928, 4292, 1296, 1300, 1280, 1100, 1250, 613]
let entries = []
const usage = () => {
  const bal = entries.length ? entries[entries.length - 1] : null
  const burn = entries.length >= 2 ? 2.5 : null
  const perDay = burn ?? 2.4
  const daysUntilEmpty = bal ? Math.round((bal.balanceUsd / perDay) * 10) / 10 : null
  return {
    available: true, today, days: calls.map((c, i) => ({ date: dayAt(calls.length - 1 - i), calls: c })),
    last7Days: { 'deepseek-v4.1-flash': 8400, 'glm-5.3-flash:cloud': 190 },
    balance: bal && { enteredAt: bal.enteredAt, balanceUsd: bal.balanceUsd, capUsd: 60, refillAt: bal.refillAt, monthUsedUsd: bal.monthUsedUsd, note: null },
    entries: entries.map((e) => ({ enteredAt: e.enteredAt, balanceUsd: e.balanceUsd })),
    forecast: { callsPerDay: 1296, callsBasedOnDays: 7, usdPerDay: perDay, source: entries.length >= 2 ? 'observed' : 'estimated', usdPerCall: 0.00237,
      balanceUsd: bal ? bal.balanceUsd : null, daysUntilEmpty, emptyDate: daysUntilEmpty !== null ? dayAt(-Math.floor(daysUntilEmpty)) : null,
      daysToRefill: bal ? 21 : null, shortfallUsd: bal && daysUntilEmpty < 21 ? Math.round((perDay * 21 - bal.balanceUsd) * 100) / 100 : null,
      level: bal && daysUntilEmpty < 21 ? 'warn' : 'ok' },
    scope: 'x',
  }
}
const graph = { available: true, computedAt: new Date().toISOString(), metrics: { peopleCount: 186, eventsCount: 1156, casesCount: 52, objectsCount: 626, avgParticipantsPerEvent: 0.9, orphanEventRatioPct: 51, trueOrphanEventRatioPct: 20, newEventsThisWeek: 5, newPeopleThisWeek: 1, mostActivePerson: { name: '呂佳泰', eventCount: 48 }, activeCasesCount: 52, personRelationsCount: 0 }, graph: { people: [], events: [], cases: [], objects: [], edges: [], caseEdges: [], objectEdges: [], personRelations: [], hubNarratives: [], hubAssessments: [] } }
const layer = (h = 'ok') => ({ status: 'success', lastRun: '', lastRunTs: Date.now() - 5 * 3600e3, processed: 1, committed: 1, failed: 0, backlog: 0, errorSummary: null, durationSeconds: 60, health: h })
const pipeline = { available: true, computedAt: new Date().toISOString(), layers: { L1: { ...layer(), schedule: ['10:30', '16:30', '20:30'] }, L2: layer(), L3: layer(), L4: layer(), L5: layer() } }
const status = { available: true, stale: false, computedAt: new Date().toISOString(), scheduledTasks: [{ name: 'L1 日記快掃', lastRunTime: new Date().toISOString(), lastTaskResult: 0, schedule: '10:30 16:30 20:30' }],  diskAlert: 'ok', storage: [{ label: 'vault', bytes: 12e9 }, { label: 'docker', bytes: 8e9 }, { label: '其他', bytes: 5e9 }], cpuPercent: 0, memPercent: 32, disks: [{ drive: '/opt/data', percentUsed: 38, freeGb: 64, totalGb: 102.9 }], containers: Array.from({ length: 12 }, (_, i) => ({ name: 'c' + i, project: null, status: 'running', health: 'healthy' })), scheduledTasks: [], computedAt: new Date().toISOString(), stale: false,
  pushers: [
    { feed: 'hermes-graph', path: '/api/admin/hermes-graph', lastOk: new Date().toISOString(), lastFail: null, lastError: null, ageMin: 3, expectedEveryMin: 10, bytes: 900000, okCount: 40, failCount: 0, level: 'ok' },
    { feed: 'hermes-usage', path: '/api/admin/hermes-usage', lastOk: null, lastFail: new Date().toISOString(), lastError: 'HTTP 502 /api/admin/hermes-usage', ageMin: null, expectedEveryMin: 720, bytes: null, okCount: 0, failCount: 2, level: 'crit' },
    { feed: 'hermes-doc', path: null, lastOk: null, lastFail: null, lastError: null, ageMin: null, expectedEveryMin: null, bytes: null, okCount: 0, failCount: 0, level: 'ok' },
  ],
  diskForecast: { basedOnDays: 7, insufficient: false, growthGbPerDay: 0.5, daysUntilFull: 80 } }

// 想法庫（數字仿 2026-10-09 回補後的分佈：系統、工作改善最多）。系統類也參加排名（使用者 2026-10-09 裁定）。
const IDEA_CATS = ['系統', '工作改善', '財務', '學習', '生活', '健身', '旅遊', '系統', '工作改善', '系統', '財務', '工作改善']
const ideaItems = IDEA_CATS.map((category, i) => {
  const status = i === 4 ? 'done' : i === 9 ? 'dropped' : i === 1 ? 'doing' : 'new'
  const open = ['new', 'evaluating', 'doing'].includes(status)
  const base = 22 - i * 1.5
  const weak = category === '旅遊'
  return {
    id: `IDEA-${String(i + 1).padStart(4, '0')}`,
    title: i === 0 ? '把 HERMES 的管線健康度做成每週自動體檢報告並推送到手機，異常時附上建議修法' : `想法 ${i + 1}：${category}方面想試試的一件事`,
    category, dimension: weak ? '旅遊生活' : null, source: i % 3 === 0 ? '我' : 'HERMES',
    why: i === 0 ? '每週不用自己翻 log，就知道哪一層快出事；這一句故意寫很長來測試首頁會不會把字截斷或撐破卡片版面' : '一閃而過但值得記下來',
    value: 1 + (i % 5), effort: 1 + ((i * 2) % 5), status, bornAt: `${dayAt(i * 5)}T10:00:00+08:00`, lastMentioned: `${dayAt(i * 3)}T10:00:00+08:00`,
    mentions: i === 2 ? 3 : 1, backfill: i > 6, days: [dayAt(i * 5)], history: [{ status: 'new', at: `${dayAt(i * 5)}T10:00:00+08:00` }],
    score: open ? Math.round(base * (weak ? 1.3 : 1) * 100) / 100 : null,
    scoreWhy: open ? [`價值 ${1 + (i % 5)} × 可行 ${5 - ((i * 2) % 5)}`, ...(weak ? ['補短板：「旅遊生活」是幸福指數最弱項 ×1.3'] : [])] : [],
    weakBoost: weak,
  }
})
const ideasTop = ideaItems.filter((i) => i.score !== null).sort((a, b) => b.score - a.score).slice(0, 3).map((i) => i.id)
const ideas = { available: true, generatedAt: today, receivedAt: new Date().toISOString(), weakest: '旅遊生活', ideas: ideaItems, top: ideasTop,
  weeks: Array.from({ length: 8 }, (_, i) => ({ weekStart: dayAt(49 - i * 7), born: [2, 0, 5, 3, 1, 4, 6, 2][i], done: [0, 1, 0, 0, 2, 0, 1, 1][i] })),
  mind: { score: 62.4, birth: { score: 100, born7: 3, baseline: 2, weekly: [2, 0, 5, 3, 1, 4, 6, 2] }, action: { score: 37.3, done28: 1, eligible: 9, rate: 0.111, target: 0.2 }, formula: '產生 100 × 40% ＋ 實行 37.3 × 60% ＝ 62.4' },
  mindShadow: Array.from({ length: 12 }, (_, i) => {
    const ideas = i < 2 ? null : 50 + i * 2
    const report = i >= 9 ? 65 : null
    return { date: dayAt(11 - i), ideas, diary: 40 + (i % 4) * 8, report, combined: ideas === null ? null : Math.round((report === null ? ideas : 0.8 * ideas + 0.2 * report) * 10) / 10 }
  }),
  mindReport: { date: dayAt(0), total: 65, parts: [['progress', '推進', 3], ['decision', '決策', 2], ['blocker', '卡點', 3], ['awareness', '覺察', 2], ['energy', '能量', 3]].map(([key, label, value]) => ({ key, label, value, note: '依據' })) } }

const posted = []
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const json = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
  const authed = req.headers['x-admin-password'] === PWD
  if (u.pathname.startsWith('/api/')) {
    if (u.pathname === '/api/sites') return json({ sites })
    if (u.pathname === '/api/dashboard') return json({ summaries: [hhi], unlocked: authed })
    if (u.pathname === '/api/auth/me') return json({ message: 'none' }, 404)
    if (!authed && u.pathname !== '/api/happiness-index/history') return json({ message: 'no' }, 403)
    if (u.pathname === '/api/hermes-usage') return json(usage())
    if (u.pathname === '/api/hermes-ideas') return json(ideas)
    if (u.pathname === '/api/hermes-graph') return json(graph)
    if (u.pathname === '/api/hermes-pipeline') return json(pipeline)
    if (u.pathname === '/api/hermes-status') return json(status)
    if (u.pathname === '/api/happiness/history') return json({ history: Array.from({ length: 30 }, (_, i) => ({ date: dayAt(29 - i), finalScore: 60 + (i % 7), displayedScore: 60 + Math.round(i / 3), weakestComponent: '旅遊生活' })) })
    if (u.pathname === '/api/hermes-activity') return json({ activity: [] })
    if (u.pathname === '/api/hermes-status/history') return json({ history: Array.from({ length: 14 }, (_, i) => ({ date: dayAt(13 - i), diskUsedGb: 30 + i * 0.6 })) })
    if (u.pathname === '/api/admin/ollama-balance' && req.method === 'POST') {
      let b = ''
      req.on('data', (c) => (b += c))
      req.on('end', () => {
        const body = JSON.parse(b)
        posted.push(body)
        if (!(body.balanceUsd >= 0)) return json({ message: '餘額要是 0 以上的數字（美元）' }, 400)
        entries.push({ enteredAt: new Date().toISOString(), balanceUsd: body.balanceUsd, refillAt: body.refillAt ?? null, monthUsedUsd: body.monthUsedUsd ?? null })
        json({ success: true, id: entries.length })
      })
      return
    }
    return json({}, 404)
  }
  let p = path.join(DIST, u.pathname === '/' ? 'index.html' : u.pathname)
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html')
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const results = []
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`) }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript((k) => localStorage.setItem('portal_unlocked', k), PWD)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 700)))
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT|ERR_NAME_NOT_RESOLVED|ERR_FAILED|ERR_TUNNEL|403|404|400 \(Bad Request\)/.test(m.text())) errors.push(m.text()) })
  return { ctx, page, errors }
}

// 每張卡的內容有沒有被 overflow:hidden 裁掉：scrollHeight 比 clientHeight 大＝內容被截
const clipped = (page) => page.evaluate(() => [...document.querySelectorAll('.bd-card')].map((c) => ({ cls: c.className, over: c.scrollHeight - c.clientHeight, w: c.scrollWidth - c.clientWidth })).filter((c) => c.over > 2 || c.w > 2))

for (const [w, h] of [[1920, 1080], [1920, 900], [1440, 900], [1536, 864], [1366, 768], [1600, 700]]) {
  entries = []
  const { ctx, page, errors } = await newPage({ width: w, height: h })
  await page.goto(base + '/')
  await page.waitForSelector('.bd-idea .bd-idea-row', { timeout: 15000 })
  await page.waitForSelector('.bd-oll .bd-kv')
  await page.waitForSelector('.bd-net .bd-tiles')
  await page.waitForSelector('.bd-sys .bd-sys-grid')
  await page.waitForTimeout(1500)
  const cards = await page.evaluate(() => [...document.querySelectorAll('.bd-card')].map((c) => { const r = c.getBoundingClientRect(); return { cls: c.className.replace('bd-card ', ''), top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) } }))
  const maxBottom = Math.max(...cards.map((c) => c.bottom))
  check(`${w}×${h}：六張卡都在第一個畫面內（最低邊 ${maxBottom} ≤ ${h}）`, cards.length === 6 && maxBottom <= h)
  const cl = await clipped(page)
  check(`${w}×${h}：沒有卡片內容被裁切`, cl.length === 0, JSON.stringify(cl))
  check(`${w}×${h}：頁面本身不橫向捲動`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  const txt = await page.locator('.ip-board').innerText()
  check(`${w}×${h}：幸福指數顯示「今日值 × 權重 ＝ 貢獻分」與計算鏈`, /人生自由/.test(txt) && /27%/.test(txt) && /18\.4/.test(txt) && /加權平均/.test(txt) && /74\.5/.test(txt) && /短板修正/.test(txt))
  const order = await page.evaluate(() => { const h = document.querySelector('.bd-hhi')?.getBoundingClientRect(); const o = document.querySelector('.bd-idea')?.getBoundingClientRect(); return h && o ? { hhiLeft: h.left, ideaLeft: o.left, hhiW: h.width, ideaW: o.width, sameRow: Math.abs(h.top - o.top) < 2 } : null })
  check(`${w}×${h}：幸福指數在左、比想法庫寬（主體），想法庫在第一列`, !!order && order.hhiLeft < order.ideaLeft && order.hhiW > order.ideaW && order.sameRow, JSON.stringify(order))
  const ideaTxt = await page.locator('.bd-idea').innerText()
  const ranks = await page.locator('.bd-idea .bd-idea-rank').allInnerTexts()
  check(`${w}×${h}：想法庫顯示前三名（名次 1–3、系統類也參加排名）`, ranks.join('') === '123' && /系統/.test(ideaTxt) && /把 HERMES 的管線健康度/.test(ideaTxt), ranks.join(','))
  check(`${w}×${h}：前三名附類別徽章、價值與難度`, (await page.locator('.bd-idea .bd-idea-row .bd-cat').count()) === 3 && /價值/.test(ideaTxt) && /難度/.test(ideaTxt))
  check(`${w}×${h}：想法庫有本週統計與開放中數量`, /本週 新想法/.test(ideaTxt) && /個開放中/.test(ideaTxt))
  check(`${w}×${h}：想法庫卡顯示心智分數（想法版・並行中）`, /心智（想法版・並行中）\s*62\.4/.test(ideaTxt))
  const rowOver = await page.evaluate(() => [...document.querySelectorAll('.bd-idea-row')].filter((e) => e.scrollHeight > e.clientHeight + 2).length)
  check(`${w}×${h}：前三名每列沒有被撐破（長標題兩行截斷）`, rowOver === 0, String(rowOver))
  const cellColor = await page.evaluate(() => { const td = document.querySelector('.bd-hhi .bd-hval'); return td ? getComputedStyle(td).color : null })
  const lum = cellColor ? cellColor.match(/\d+/g).slice(0, 3).map(Number).reduce((x, y) => x + y, 0) / 3 : 0
  check(`${w}×${h}：幸福指數「今日值」不是黑色（${cellColor}）`, lum > 100)
  const trunc = await page.evaluate(() => [...document.querySelectorAll('.bd-hhi .bd-hlabel, .bd-hhi .bd-hval, .bd-hhi .bd-hpts, .bd-hhi .bd-hw, .bd-hhi .bd-chain span, .bd-hhi .bd-hhead span')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent))
  check(`${w}×${h}：幸福指數卡沒有被截斷的字`, trunc.length === 0, JSON.stringify(trunc))
  const rowH = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.bd-hhi button.bd-hrow')].map((e) => e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).fontSize))))
  check(`${w}×${h}：六維度每列至少 1.3 行高（${rowH.toFixed(2)}）`, rowH >= 1.3)
  check(`${w}×${h}：電腦版首頁沒有舊面板（戰情室／幸福指數大卡／六維度不渲染）`, (await page.locator('.ip-war, .ip-hhi, .ip-dims').count()) === 0)
  const sc = await page.evaluate(() => { const e = document.querySelector('.ip-scroll'); return e ? { sh: e.scrollHeight, ch: e.clientHeight } : null })
  check(`${w}×${h}：首頁不必縱向捲動（${sc?.sh} ≤ ${sc?.ch}+2）`, !!sc && sc.sh <= sc.ch + 2)
  check(`${w}×${h}：硬碟容量融入主機卡（百分比、預估${h >= 800 ? '、分項' : '；矮視窗分項收進抽屜'}）`, /硬碟容量/.test(txt) && /個月後寫滿/.test(txt) && (h < 800 || /vault/.test(txt)))
  check(`${w}×${h}：主機卡標題旁提醒推送落後`, /推送 1 項落後/.test(await page.locator('.bd-sys h2').innerText()))
  check(`${w}×${h}：關係網路用真實數字（186／1156）`, /186/.test(txt) && /1156/.test(txt))
  check(`${w}×${h}：Ollama 小卡尚無餘額時顯示輸入提示與「粗估」`, /還沒輸入餘額/.test(txt) && /粗估/.test(txt) && /預估用完/.test(txt) && (await page.locator('.bd-oll .bd-kv').count()) === 1)
  await page.screenshot({ path: path.join(SHOTS, `board-${w}x${h}-empty.png`) })

  if (w === 1920 && h === 1080) {
    // 抽屜：舊面板的功能都在這裡
    await page.locator('.bd-hhi .bd-more').click()
    await page.waitForSelector('.bd-drawer', { timeout: 5000 })
    await page.waitForTimeout(600)
    const d1 = await page.locator('.bd-drawer').innerText()
    check('幸福指數抽屜：有趨勢入口、計算明細與六維度子系統', /六維度子系統/.test(d1) && /歷史趨勢圖|近 30 天/.test(d1) && /平滑後/.test(d1), d1.slice(0, 160))
    await page.screenshot({ path: path.join(SHOTS, 'drawer-hhi.png') })
    await page.keyboard.press('Escape')
    check('ESC 關閉抽屜', (await page.locator('.bd-drawer').count()) === 0)
    await page.locator('.bd-hhi button.bd-hrow').first().click()
    check('點六維度任一列也會打開幸福指數抽屜', (await page.locator('.bd-drawer').count()) === 1)
    await page.mouse.click(20, 500)
    check('點抽屜外側關閉', (await page.locator('.bd-drawer').count()) === 0)
    await page.locator('.bd-sys .bd-more').click()
    await page.waitForSelector('.bd-drawer')
    await page.waitForTimeout(800)
    const d2 = await page.locator('.bd-drawer').innerText()
    check('戰情室抽屜最上方有入口網推送健康表（3 種資料、失敗那列顯示錯誤）', (await page.locator('.bd-drawer .bd-push-row').count()) === 3 && /入口網推送健康/.test(d2) && /1 項需要注意/.test(d2) && /HTTP 502/.test(d2) && /有變動才送/.test(d2), d2.slice(0, 300))
    check('戰情室抽屜：排程任務、近期活動、容器清單、近期趨勢、硬碟容量都在', ['排程任務狀態', '近期活動', '容器清單', '近期趨勢', '硬碟容量'].every((k) => d2.includes(k)), d2.slice(0, 200))
    await page.screenshot({ path: path.join(SHOTS, 'drawer-ops.png') })
    await page.keyboard.press('Escape')
    // 想法庫抽屜：全部清單、狀態與類別篩選、展開看優先分算式
    await page.locator('.bd-idea .bd-more').click()
    await page.waitForSelector('.bd-drawer .bd-idea-item')
    const mindTxt = await page.locator('.bd-drawer section').first().innerText()
    check('想法庫抽屜最上方有心智分數（想法版）算式與並行標示', /心智分數（想法版）/.test(mindTxt) && /並行中/.test(mindTxt) && /近 7 天新想法 3 個 ÷ 過去 8 週每週中位數 2/.test(mindTxt) && /近 28 天實行 1 個 ÷ 有機會實行的 9 個/.test(mindTxt), mindTxt.slice(0, 200))
    check('三版對照曲線都有畫出來（想法版／合成版／日記篇數版）', (await page.locator('.bd-drawer svg[aria-label="心智分數各版對照"] polyline').count()) === 3)
    check('合成版：最新一天 0.8×想法＋0.2×日報', /🧮 合成版 70\.6（.*想法 72\.0 × 80% ＋ 日報 65 × 20%）/.test(mindTxt), mindTxt.slice(0, 400))
    check('日報分數與五項明細', /📊 日報分數 65（.*推進 3・決策 2・卡點 3・覺察 2・能量 3）/.test(mindTxt))
    const nOpen = await page.locator('.bd-drawer .bd-idea-item').count()
    check(`想法庫抽屜預設列出開放中的想法（${nOpen} 筆）`, nOpen === ideaItems.filter((i) => i.score !== null).length)
    await page.locator('.bd-drawer button', { hasText: /^全部$/ }).click()
    check('想法庫抽屜「全部」含已實行與放棄', (await page.locator('.bd-drawer .bd-idea-item').count()) === ideaItems.length)
    await page.locator('.bd-drawer button', { hasText: /^財務 \d+$/ }).click()
    const fin = await page.locator('.bd-drawer .bd-idea-item').allInnerTexts()
    check('想法庫抽屜依類別篩選（財務）', fin.length === 2 && fin.every((t) => /財務/.test(t)), String(fin.length))
    await page.locator('.bd-drawer .bd-idea-item summary').first().click()
    const det = await page.locator('.bd-drawer .bd-idea-item[open]').innerText()
    check('展開一筆看得到為什麼、優先分、出處日期、狀態歷程', /為什麼想做/.test(det) && /優先分/.test(det) && /出現在日記/.test(det) && /狀態歷程/.test(det))
    // 複製給 HERMES：入口網不寫入，只複製要貼到 Telegram 的那句話
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base })
    const reqs = []
    page.on('request', (r) => { if (r.method() !== 'GET') reqs.push(r.url()) })
    const open1 = page.locator('.bd-drawer .bd-idea-item[open]')
    const firstId = (await open1.locator('.bd-idea-id').innerText()).trim()
    await open1.locator('input[aria-label="補充說明"]').fill('花了三個晚上')
    await open1.getByRole('button', { name: '✅ 已實行' }).click()
    await page.waitForSelector('.bd-drawer .bd-idea-copytext')
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    check('按「✅ 已實行」複製含編號、標題、標記與補充的一句話', clip.startsWith(`💡✅ ${firstId}「`) && /」已實行\n花了三個晚上$/.test(clip), JSON.stringify(clip))
    check('複製後畫面顯示已複製的內容', /已複製/.test(await open1.innerText()))
    check('複製按鈕不送出任何寫入請求（入口網只顯示）', reqs.length === 0, reqs.join(','))
    check('不提供目前狀態的按鈕（新想法不能再選「新想法」）', (await open1.getByRole('button', { name: /新想法/ }).count()) === 0)
    await page.screenshot({ path: path.join(SHOTS, 'drawer-ideas.png') })
    await page.keyboard.press('Escape')
  }

  if (w === 1920 && h === 1080) {
    // 手動輸入餘額：首頁 Ollama 小卡 →「走勢・更新餘額」抽屜（完整面板搬到這裡）
    await page.locator('.bd-oll .bd-more').click()
    await page.waitForSelector('.bd-drawer .bd-oll-body')
    await page.getByRole('button', { name: '輸入目前餘額' }).click()
    await page.fill('#bd-bal', '29.31'); await page.fill('#bd-used', '50.69'); await page.fill('#bd-refill', '2026-10-29')
    await page.getByRole('button', { name: '儲存' }).click()
    await page.waitForFunction(() => /\$29\.31/.test(document.querySelector('.bd-drawer')?.textContent ?? ''), null, { timeout: 8000 })
    check('輸入餘額後 POST 內容正確並在抽屜重畫（$29.31）', posted.length === 1 && posted[0].balanceUsd === 29.31 && posted[0].monthUsedUsd === 50.69 && posted[0].refillAt === '2026-10-29')
    const t2 = await page.locator('.bd-drawer').innerText()
    check('抽屜有餘額走勢、每日請求數與補點前缺口警示', /預估用完日/.test(t2) && /補點前用完/.test(t2) && /近 14 天每日請求數/.test(t2))
    await page.screenshot({ path: path.join(SHOTS, 'drawer-ollama.png') })
    // 輸入錯誤顯示人話訊息、不關表單
    await page.getByRole('button', { name: '更新餘額', exact: true }).click()
    await page.fill('#bd-bal', '-3')
    await page.getByRole('button', { name: '儲存' }).click()
    await page.waitForFunction(() => /餘額要是 0 以上/.test(document.querySelector('.bd-drawer')?.textContent ?? ''), null, { timeout: 5000 })
    check('輸入錯誤時顯示後端的人話訊息並保留表單', (await page.locator('#bd-bal').count()) === 1)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => /\$29\.31/.test(document.querySelector('.bd-oll')?.textContent ?? ''), null, { timeout: 8000 })
    const t3 = await page.locator('.bd-oll').innerText()
    check('關掉抽屜後首頁小卡更新為新餘額與缺口提示', /\$29\.31/.test(t3) && /補點前用完/.test(t3))
    check('輸入後卡片仍未被裁切', (await clipped(page)).length === 0, JSON.stringify(await clipped(page)))
    await page.screenshot({ path: path.join(SHOTS, `board-${w}x${h}-balance.png`) })
  }
  check(`${w}×${h}：沒有頁面錯誤`, errors.length === 0, errors.join(' | ').slice(0, 300))
  await ctx.close()
}

// 版本歷程（時間軸）：左版號日期、右標題可折疊、搜尋、類型篩選、ESC 關閉（電腦與手機各一次）
for (const [vw, vhh] of [[1440, 900], [390, 844]]) {
  const { ctx, page, errors } = await newPage({ width: vw, height: vhh })
  await page.goto(base + '/')
  await page.getByRole('button', { name: /版本歷程/ }).first().click()
  await page.waitForSelector('.vh-dialog .vh-row')
  const rows = await page.locator('.vh-row').count()
  check(`${vw}：版本歷程以時間軸列出所有版本（${rows} 版）`, rows >= 50)
  const geo = await page.evaluate(() => { const r = document.querySelector('.vh-row'); const l = r.querySelector('.vh-left').getBoundingClientRect(); const t = r.querySelector('.vh-title').getBoundingClientRect(); const n = r.querySelector('.vh-node').getBoundingClientRect(); return { leftRight: l.right, nodeX: n.left, titleLeft: t.left } })
  check(`${vw}：版號日期在左、節點在中、標題在右`, geo.leftRight <= geo.nodeX && geo.nodeX < geo.titleLeft, JSON.stringify(geo))
  check(`${vw}：預設只展開最新一版`, (await page.locator('.vh-changes').count()) === 1 && (await page.locator('.vh-row').first().locator('.vh-changes').count()) === 1)
  const second = page.locator('.vh-row').nth(1).locator('.vh-title')
  await second.click()
  check(`${vw}：點標題展開`, (await page.locator('.vh-row').nth(1).locator('.vh-changes').count()) === 1 && (await second.getAttribute('aria-expanded')) === 'true')
  await second.click()
  check(`${vw}：再點一次收合`, (await page.locator('.vh-row').nth(1).locator('.vh-changes').count()) === 0)
  await page.fill('.vh-search', '想法庫')
  const hits = await page.locator('.vh-row').count()
  check(`${vw}：搜尋「想法庫」只留相關版本（${hits} 版）`, hits > 0 && hits < rows)
  await page.fill('.vh-search', '')
  await page.locator('.vh-seg button', { hasText: '修正' }).click()
  const patches = await page.locator('.vh-row .vh-badge').allInnerTexts()
  check(`${vw}：依類型篩選（修正 ${patches.length} 版）`, patches.length > 0 && patches.every((b) => b === '修正'))
  await page.locator('.vh-seg button', { hasText: '全部' }).click()
  await page.locator('.vh-all').click()
  check(`${vw}：全部展開`, (await page.locator('.vh-changes').count()) === rows)
  const hscroll = await page.evaluate(() => { const b = document.querySelector('.vh-body'); return b.scrollWidth - b.clientWidth })
  check(`${vw}：時間軸不橫向捲動`, hscroll <= 1, String(hscroll))
  await page.locator('.vh-all').click()
  await page.screenshot({ path: path.join(SHOTS, `version-history-${vw}.png`) })
  await page.keyboard.press('Escape')
  check(`${vw}：ESC 關閉版本歷程`, (await page.locator('.vh-dialog').count()) === 0)
  check(`${vw}：版本歷程沒有頁面錯誤`, errors.length === 0, errors.join(' | ').slice(0, 300))
  await ctx.close()
}

// 手機：不顯示儀表板、不橫向捲動
{
  const { ctx, page, errors } = await newPage({ width: 390, height: 844 })
  await page.goto(base + '/')
  await page.waitForTimeout(1500)
  check('手機寬度舊面板照舊顯示（戰情室、幸福指數、六維度）', (await page.locator('.ip-war').count()) === 1 && (await page.locator('.ip-hhi').count()) === 1 && (await page.locator('.ip-dims').count()) === 1)
  check('手機寬度不顯示桌面儀表板', (await page.locator('.bd-card:visible').count()) === 0)
  check('手機寬度頁面不橫向捲動', await page.evaluate(() => { const s = document.querySelector('.ip-scroll'); return !s || s.scrollWidth <= s.clientWidth + 1 }))
  check('手機寬度沒有頁面錯誤', errors.length === 0, errors.join(' | ').slice(0, 300))
  await page.screenshot({ path: path.join(SHOTS, 'board-mobile.png') })
  await ctx.close()
}

await browser.close()
server.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed; screenshots: ${SHOTS}`)
process.exit(failed.length ? 1 : 0)
