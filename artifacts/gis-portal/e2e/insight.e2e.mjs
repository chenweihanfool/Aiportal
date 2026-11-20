// 首頁心得（搜尋相關）真實瀏覽器驗證（手動執行；不在 CI 內，同 home.e2e.mjs 的做法）。
// 3.15.0 起首頁心得區改成島嶼＋時間軸（見 insight-islands.e2e.mjs），舊有機樹的檢查已移除；這支只留搜尋（心得群組排第一、脈絡迷你時間線、閱讀面板原文）與未解鎖／空／失敗狀態。
// 本機靜態伺服器提供 dist/public，Playwright 攔截所有 /api/*，全程不碰真實服務。
//
// 執行（需先 build）：
//   BASE_PATH=/ pnpm --filter @workspace/gis-portal run build
//   PLAYWRIGHT_MODULE_DIR=/path/to/node_modules CHROMIUM_PATH=/path/to/chrome node artifacts/gis-portal/e2e/insight.e2e.mjs
// 截圖輸出到 E2E_SHOTS_DIR（預設 ./insight-e2e-shots）。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const req = createRequire((process.env.PLAYWRIGHT_MODULE_DIR || '/opt/node22/lib/node_modules') + '/')
let pw
try { pw = req('playwright-core') } catch { pw = req('playwright') }
const { chromium } = pw

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/public')
const SHOTS = process.env.E2E_SHOTS_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'insight-e2e-shots')
fs.mkdirSync(SHOTS, { recursive: true })
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
const server = http.createServer((rq, res) => {
  const u = new URL(rq.url, 'http://x')
  let p = path.join(DIST, u.pathname === '/' ? 'index.html' : u.pathname)
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html')
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}`
const PWD = 'tok-test'
const results = []
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`) }

// ── 假資料（全部虛構）──
const tpDate = (offset = 0) => new Date(Date.now() + 8 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10)
// 3.7.0：假的每日幸福指數（只收換尺 2026-10-30 之後）；偶數日 82（高分）、奇數日 52（低分）
const SCALE_SINCE = '2026-10-30'
const scoreAt = (date) => (Number(date.slice(8, 10)) % 2 === 0 ? 82 : 52)
const HHI_HISTORY = Array.from({ length: 400 }, (_, i) => tpDate(-i)).filter((d) => d >= SCALE_SINCE).map((date) => ({ date, displayedScore: scoreAt(date) }))
const mk = (id, ago, cluster, thread, relation, parent = null) => ({ id, date: tpDate(-ago), time: '21:30', text: `虛構心得 ${id}：事情要先講清楚再動手`, provenance: 'quote', cluster, thread, relation, parent })
const HAND = [
  mk('I-01', 300, 'K01', 'TH-a', 'new'), mk('I-02', 250, 'K01', 'TH-a', 'reinforce', 'I-01'), mk('I-03', 200, 'K01', 'TH-a', 'reinforce', 'I-02'),
  mk('I-04', 150, 'K01', 'TH-a', 'reinforce', 'I-03'), mk('I-05', 100, 'K01', 'TH-a', 'refine', 'I-04'),
  mk('I-06', 280, 'K01', 'TH-x', 'new'), mk('I-07', 90, 'K01', 'TH-y', 'new'),
  mk('I-08', 260, 'K02', 'TH-b', 'new'), mk('I-09', 140, 'K02', 'TH-b', 'refine', 'I-08'), mk('I-10', 60, 'K02', 'TH-z', 'new'),
  mk('I-11', 40, 'K02', 'TH-w', 'new'), mk('I-12', 220, 'K03', 'TH-c', 'new'), mk('I-13', 120, 'K03', 'TH-c', 'overturn', 'I-12'),
  mk('I-14', 70, 'K03', 'TH-t', 'new'), mk('I-15', 180, 'K04', 'TH-r', 'new'), mk('I-16', 20, 'K04', 'TH-q', 'new'), mk('I-17', 5, 'K04', 'TH-p', 'new'),
  mk('I-18', 10, 'K01', 'TH-v', 'new'), mk('I-19', 130, 'K02', 'TH-u', 'new'), mk('I-20', 110, 'K03', 'TH-s', 'new'),
]
// 再補 48 則：7 群、12 條脈絡、時間跨 18 個月（約 540 天），含印證、修正、推翻，才看得出結構
const GEN = []
for (let i = 0; i < 48; i++) {
  const t = Math.floor(i / 4), j = i % 4, c = 1 + (t % 7), th = `TH-g${t}`
  const rel = j === 0 ? 'new' : j === 3 ? (t % 5 === 2 ? 'overturn' : 'refine') : 'reinforce'
  GEN.push(mk(`G-${String(i).padStart(2, '0')}`, 540 - i * 11 - j, `K0${c}`, th, rel, j === 0 ? null : `G-${String(i - 1).padStart(2, '0')}`))
}
const INSIGHTS = [...HAND, ...GEN].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id < y.id ? -1 : 1))
const NAMES = ['測量作業', '工作習慣', '人際', '健康與運動', '財務觀念', '學習方法', '家庭生活']
const CLUSTERS = NAMES.map((name, i) => ({ id: `K0${i + 1}`, name, count: INSIGHTS.filter((x) => x.cluster === `K0${i + 1}`).length }))
// 稀疏（正式站現況：2 則、同一天兩群）與 12 群 300 則
const SP = [mk('S-1', 0, 'K01', 'TH-s1', 'new'), mk('S-2', 0, 'K02', 'TH-s2', 'new'), mk('S-3', 12, 'K03', 'TH-s3', 'new')]
const BIG = Array.from({ length: 300 }, (_, i) => { const c = (i * 7) % 12, t = Math.floor(i / 12) % 9, j = i % 4; return mk(`B-${i}`, 540 - Math.floor((i * 538) / 300), `K${String(c + 1).padStart(2, '0')}`, `TH-b${c}-${t}`, j === 0 ? 'new' : j === 3 ? 'refine' : 'reinforce', null) })
for (const b of BIG) { const prev = BIG.filter((x) => x.thread === b.thread && x.date <= b.date && x.id !== b.id); b.parent = b.relation === 'new' || prev.length === 0 ? null : prev[prev.length - 1].id; if (b.parent === null) b.relation = 'new' }
// 近似正式站：9 群 13 則；「家庭溝通」只有 3 則、日期集中在 4 個月
const P13NAMES = ['測量作業', '工作習慣', '人際關係', '健康與運動', '財務觀念', '學習方法', '家庭溝通', '旅行與休息', '職涯規劃']
const P13 = [
  mk('P-01', 330, 'K01', 'TH-p1', 'new'), mk('P-02', 300, 'K01', 'TH-p1', 'reinforce', 'P-01'), mk('P-03', 260, 'K02', 'TH-p2', 'new'), mk('P-04', 220, 'K03', 'TH-p3', 'new'),
  mk('P-05', 180, 'K04', 'TH-p4', 'new'), mk('P-06', 150, 'K05', 'TH-p5', 'new'), mk('P-07', 130, 'K06', 'TH-p6', 'new'),
  mk('P-08', 190, 'K07', 'TH-p7', 'new'), mk('P-09', 100, 'K07', 'TH-p7', 'reinforce', 'P-08'), mk('P-10', 12, 'K07', 'TH-p8', 'new'),
  mk('P-11', 90, 'K08', 'TH-p9', 'new'), mk('P-12', 60, 'K09', 'TH-pa', 'new'), mk('P-13', 30, 'K01', 'TH-pb', 'new'),
].sort((x, y) => (x.date < y.date ? -1 : 1))
const bodyOf = (list, names) => ({ total: list.length, thisMonth: list.filter((x) => x.date.slice(0, 7) === tpDate(0).slice(0, 7)).length, clusters: names.map(([id, name]) => ({ id, name, count: list.filter((x) => x.cluster === id).length })).filter((c) => c.count > 0), insights: list })
const modeBody = (mode) => mode === 'roots' ? bodyOf(ROOTS, [['K01', '測量作業']]) : mode === 'dcrowd' ? bodyOf(DC, [['K01', '測量作業']]) : mode === 'prod13' ? bodyOf(P13, P13NAMES.map((n, i) => [`K0${i + 1}`, n])) : mode === 'sparse1' ? bodyOf(SP.slice(0, 1), [['K01', '測量作業']]) : mode === 'sparse2' ? bodyOf(SP.slice(0, 2), [['K01', '測量作業'], ['K02', '工作習慣']]) : mode === 'sparse3' ? bodyOf(SP, [['K01', '測量作業'], ['K02', '工作習慣'], ['K03', '人際']])
  : mode === 'big300' ? bodyOf(BIG, Array.from({ length: 12 }, (_, i) => [`K${String(i + 1).padStart(2, '0')}`, ['測量作業', '工作習慣', '人際關係經營', '健康與運動', '財務觀念', '學習方法', '家庭生活', '旅行與休息', '職涯規劃', '情緒覺察', '專案管理', '創作與興趣'][i]])) : insightsBody
// 卷宗情境（全部虛構）：D-1 → D-2（印證）→ D-3（修正）同一脈絡；D-2 帶滿 8 人、6 想法、3 知識、8 條 headings
const DC = [mk('D-1', 30, 'K01', 'TH-d1', 'new'), mk('D-2', 20, 'K01', 'TH-d1', 'reinforce', 'D-1'), mk('D-3', 10, 'K01', 'TH-d1', 'refine', 'D-2')]
const DC_LINKS = {
  people: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `測試${'甲乙丙丁戊己庚辛'[i]}`, dossier: i % 2 === 0 ? `測試${'甲乙丙丁戊己庚辛'[i]}` : null, sameSegment: i === 5 })),
  ideas: Array.from({ length: 6 }, (_, i) => ({ id: `IDEA-000${i + 1}`, title: `虛構想法${'甲乙丙丁戊己'[i]}：把事情先講清楚再動手做一件比較長的事`, mentioned: i % 2 === 0 })),
  topics: [{ id: 'T-001', name: '虛構知識主題一' }, { id: 'T 二/三', name: '虛構知識主題二' }, { id: 'T-003', name: '虛構知識主題三的名稱比較長一點' }],
}
const DC_HEADINGS = Array.from({ length: 8 }, (_, i) => `虛構的第 ${i + 1} 件事：和測試甲討論某個虛構的主題`)
// 根系與反向連結情境（3.3.0；全部虛構）：R-1 有 1 人 1 想法、R-2 沒連結、R-3 擠（8 人 6 想法）、R-4 推翻 R-1 且連同一個想法與人
const RL = (people, ideas) => ({ people, ideas, topics: [] })
const R_P = { id: 'p0', name: '測試甲', dossier: '測試甲', sameSegment: true }
const R_I = { id: 'IDEA-0002', title: DC_LINKS.ideas[1].title, mentioned: true }
const ROOTS = [
  { ...mk('R-1', 30, 'K01', 'TH-r1', 'new'), links: RL([R_P], [R_I]) },
  mk('R-2', 20, 'K01', 'TH-r2', 'new'),
  { ...mk('R-3', 10, 'K01', 'TH-r3', 'new'), links: RL(DC_LINKS.people, DC_LINKS.ideas) },
  { ...mk('R-4', 5, 'K01', 'TH-r1', 'overturn', 'R-1'), links: RL([R_P], [R_I]) },
]
const ROOT_GRAPH = { available: true, computedAt: new Date().toISOString(), graph: { people: [{ name: '測試甲', eventCount: 1 }], events: [{ id: 'E1', date: '2026-10-01', title: '虛構事件', status: null, tags: [], case: null }], cases: [], objects: [], edges: [{ person: '測試甲', eventId: 'E1', role: 'x' }], caseEdges: [], objectEdges: [], personRelations: [], hubNarratives: [], hubAssessments: [] } }
const STATUSES = ['doing', 'new', 'done', 'shelved', 'evaluating', 'dropped']
const IDEAS_BODY = {
  available: true, generatedAt: null, receivedAt: null, weakest: null, top: [], weeks: [], mind: null, mindShadow: [],
  ideas: DC_LINKS.ideas.map((x, i) => ({ id: x.id, title: x.title, category: null, dimension: null, source: null, why: null, value: 3, effort: 2, status: STATUSES[i], bornAt: '2026-10-01T00:00:00Z', lastMentioned: '2026-10-02', mentions: 1, backfill: false, days: ['2026-10-02'], history: [], score: 1, scoreWhy: [], weakBoost: false })),
}
const insightsBody = { total: INSIGHTS.length, thisMonth: 3, clusters: CLUSTERS, insights: INSIGHTS }
const detailOf = (id) => {
  const it = INSIGHTS.find((x) => x.id === id)
  if (!it) return null
  const cl = CLUSTERS.find((c) => c.id === it.cluster)
  return { ...it, cluster: { id: cl.id, name: cl.name }, evidence: `（虛構日記原文）今天回頭看，${it.text}。`, source: `日記/${it.date}.md`, threadItems: INSIGHTS.filter((x) => x.thread === it.thread) }
}
const searchBody = {
  q: '心得', total: 4, tookMs: 5, best: null, facets: { months: [] },
  groups: [
    { kind: 'case', count: 1, items: [{ kind: 'case', id: '某案', title: '某案', snippet: '案件摘要', date: null }] },
    { kind: 'insight', count: 3, items: ['I-02', 'I-03', 'I-04'].map((id) => { const it = INSIGHTS.find((x) => x.id === id); return { kind: 'insight', id, title: it.text, snippet: '', date: it.date, meta: { date: it.date, cluster: it.cluster, thread: it.thread, relation: it.relation } } }) },
  ],
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, channel: process.env.CHROMIUM_PATH ? undefined : 'chrome', args: ['--no-sandbox'] })
async function open(viewport, { unlocked = true, hash = '', mode = 'ok', colorScheme = 'dark', reducedMotion = 'no-preference' } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme, reducedMotion })
  if (unlocked) await ctx.addInitScript((k) => localStorage.setItem('portal_unlocked', k), PWD)
  await ctx.addInitScript(() => { try { localStorage.setItem('hm-layout', 'v3') } catch { /* 略過 */ } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 600)))
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url())
    const p = u.pathname
    const authed = route.request().headers()['x-admin-password'] === PWD
    const json = (o, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(o) })
    if (p === '/api/sites') return json({ sites: [] })
    if (p === '/api/dashboard') return json({ summaries: [], unlocked: authed })
    if (!authed) return json({ message: 'no' }, 403)
    if (p === '/api/insights') {
      if (mode === 'fail') return json({ message: 'boom' }, 500)
      if (mode === 'empty') return json({ total: 0, thisMonth: 0, clusters: [], insights: [] })
      return json(modeBody(mode))
    }
    const m = /^\/api\/insights\/(.+)$/.exec(p)
    if (m && mode === 'dcrowd') {
      const id = decodeURIComponent(m[1]); const it = DC.find((x) => x.id === id)
      if (!it) return json({ message: 'none' }, 404)
      return json({ ...it, cluster: { id: 'K01', name: '測量作業' }, evidence: '（虛構日記原文）', source: `日記/${it.date}.md`, links: id === 'D-2' ? DC_LINKS : { people: [], ideas: [], topics: [] }, day: { headings: id === 'D-2' ? DC_HEADINGS : [] }, threadItems: DC })
    }
    if (m && mode === 'sparse1') {
      const it = SP[0]
      return json({ ...it, cluster: { id: 'K01', name: '測量作業' }, evidence: '（虛構日記原文）', source: '', links: { people: [], ideas: [], topics: [] }, day: { headings: [] }, threadItems: [it] })
    }
    if (m && mode === 'roots') {
      const it = ROOTS.find((x) => x.id === decodeURIComponent(m[1]))
      return it ? json({ ...it, cluster: { id: 'K01', name: '測量作業' }, evidence: '（虛構日記原文）', source: '', day: { headings: [] }, threadItems: [it] }) : json({ message: 'none' }, 404)
    }
    if (p === '/api/hermes-graph' && mode === 'roots') return json(ROOT_GRAPH)
    if (m) { const d = detailOf(decodeURIComponent(m[1])); return d ? json(d) : json({ message: 'none' }, 404) }
    if (p === '/api/happiness/history') return json({ history: HHI_HISTORY })
    if (p === '/api/hermes-ideas') return json(IDEAS_BODY)
    if (p === '/api/search') return json(searchBody)
    if (p === '/api/timeline/day' || p.startsWith('/api/hermes-timeline')) return json({}, 404)
    return json({}, 404)
  })
  await page.goto(BASE + '/' + hash)
  await page.waitForSelector('.st-home', { timeout: 15000 })
  return { ctx, page, errors }
}
const noHScroll = (page) => page.evaluate(() => {
  const sc = document.querySelector('.ip-scroll')
  return document.documentElement.scrollWidth <= window.innerWidth + 1 && (!sc || sc.scrollWidth <= sc.clientWidth + 1)
})

try {
  // ── 5. 搜尋：心得群組排第一、脈絡迷你時間線 ──
  {
    const T = '搜尋'
    const { ctx, page } = await open({ width: 1440, height: 900 })
    await page.locator('input[role="combobox"]').fill('心得')
    await page.waitForSelector('[data-testid="insight-hit"]', { timeout: 10000 })
    const order = await page.evaluate(() => [...document.querySelectorAll('#om-listbox [role="group"]')].map((g) => g.getAttribute('aria-label')))
    check(`${T}：心得群組排第一（在案件之前）`, order[0] === '心得' && order.includes('案件'), order.join('、'))
    check(`${T}：結果卡附脈絡迷你時間線（TH-a 在結果中 3 點，本則加外圈）`, await page.evaluate(() => { const m = document.querySelector('[data-testid="insight-hit"] [data-testid="insight-thread-mini"]'); return !!m && m.querySelectorAll('.it-mini-dot').length === 3 && m.querySelectorAll('.it-mini-self').length === 1 }))
    check(`${T}：預設選中第一筆心得、閱讀面板顯示原文`, await (async () => { await page.waitForSelector('[data-testid="insight-reader"]', { timeout: 5000 }).catch(() => {}); return /虛構日記原文/.test(await page.locator('[data-testid="insight-reader"]').innerText().catch(() => '')) })())
    await page.screenshot({ path: path.join(SHOTS, 'search.png') })
    await ctx.close()
  }


  // ── 8. 狀態：未解鎖／空／失敗 ──
  {
    let r = await open({ width: 1280, height: 800 }, { unlocked: false })
    check('未解鎖：顯示既有的「解鎖後顯示」提示、沒有島', /解鎖後顯示/.test(await r.page.locator('[data-testid="insight-islands"]').innerText()) && (await r.page.locator('[data-testid="ii-island"]').count()) === 0)
    await r.ctx.close()
    r = await open({ width: 1280, height: 800 }, { mode: 'empty' })
    await r.page.waitForSelector('[data-testid="ii-empty"]')
    check('0 則：顯示「心得累積中：HERMES 每晚會從日記抽出你的體會，長成一座座島」', /心得累積中：HERMES 每晚會從日記抽出你的體會，長成一座座島/.test(await r.page.locator('[data-testid="insight-islands"]').innerText()))
    await r.ctx.close()
    r = await open({ width: 1280, height: 800 }, { mode: 'fail' })
    await r.page.waitForSelector('.ii-frame .hm-retry', { timeout: 10000 })
    check('API 失敗：顯示可重試', /心得暫時讀不到/.test(await r.page.locator('[data-testid="insight-islands"]').innerText()) && (await r.page.locator('.ii-frame .hm-retry').count()) === 1)
    await r.ctx.close()
  }
} catch (e) {
  check('e2e 執行過程沒有例外', false, String(e.stack || e).slice(0, 800))
} finally {
  await browser.close()
  server.close()
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通過`)
process.exit(failed.length === 0 ? 0 : 1)
