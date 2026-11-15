// 首頁「我的心得樹」（2.99.0）真實瀏覽器驗證（手動執行；不在 CI 內，同 home.e2e.mjs 的做法）。
//
// 做什麼：本機靜態伺服器提供 dist/public，Playwright 攔截所有 /api/*，用假的 /api/insights、/api/insights/:id、/api/search 驗證：
// 首頁左側有心得樹與指標、「現在用得上（n）」預設收起且可展開、點葉開側邊面板（含原文與整條脈絡時間線）、重播按鈕可停、
// 360×740 無橫向捲動、搜尋時心得群組排第一且有脈絡迷你時間線、#insight/<id> 直接開面板、未解鎖／空／失敗狀態。全程不碰真實服務。
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
const modeBody = (mode) => mode === 'dcrowd' ? bodyOf(DC, [['K01', '測量作業']]) : mode === 'prod13' ? bodyOf(P13, P13NAMES.map((n, i) => [`K0${i + 1}`, n])) : mode === 'sparse1' ? bodyOf(SP.slice(0, 1), [['K01', '測量作業']]) : mode === 'sparse2' ? bodyOf(SP.slice(0, 2), [['K01', '測量作業'], ['K02', '工作習慣']]) : mode === 'sparse3' ? bodyOf(SP, [['K01', '測量作業'], ['K02', '工作習慣'], ['K03', '人際']])
  : mode === 'big300' ? bodyOf(BIG, Array.from({ length: 12 }, (_, i) => [`K${String(i + 1).padStart(2, '0')}`, ['測量作業', '工作習慣', '人際關係經營', '健康與運動', '財務觀念', '學習方法', '家庭生活', '旅行與休息', '職涯規劃', '情緒覺察', '專案管理', '創作與興趣'][i]])) : insightsBody
// 卷宗情境（全部虛構）：D-1 → D-2（印證）→ D-3（修正）同一脈絡；D-2 帶滿 8 人、6 想法、3 知識、8 條 headings
const DC = [mk('D-1', 30, 'K01', 'TH-d1', 'new'), mk('D-2', 20, 'K01', 'TH-d1', 'reinforce', 'D-1'), mk('D-3', 10, 'K01', 'TH-d1', 'refine', 'D-2')]
const DC_LINKS = {
  people: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `測試${'甲乙丙丁戊己庚辛'[i]}`, dossier: i % 2 === 0 ? `測試${'甲乙丙丁戊己庚辛'[i]}` : null, sameSegment: i === 5 })),
  ideas: Array.from({ length: 6 }, (_, i) => ({ id: `IDEA-000${i + 1}`, title: `虛構想法${'甲乙丙丁戊己'[i]}：把事情先講清楚再動手做一件比較長的事`, mentioned: i % 2 === 0 })),
  topics: [{ id: 'T-001', name: '虛構知識主題一' }, { id: 'T 二/三', name: '虛構知識主題二' }, { id: 'T-003', name: '虛構知識主題三的名稱比較長一點' }],
}
const DC_HEADINGS = Array.from({ length: 8 }, (_, i) => `虛構的第 ${i + 1} 件事：和測試甲討論某個虛構的主題`)
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
async function open(viewport, { unlocked = true, hash = '', mode = 'ok', colorScheme = 'dark' } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme })
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
    if (m) { const d = detailOf(decodeURIComponent(m[1])); return d ? json(d) : json({ message: 'none' }, 404) }
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
  // ── 1. 首頁左側的心得樹與指標 ──
  {
    const T = '桌面 1440×900'
    const { ctx, page, errors } = await open({ width: 1440, height: 900 })
    await page.waitForSelector('[data-testid="insight-leaf"]', { timeout: 10000 })
    const N = await page.evaluate(() => document.querySelectorAll('[data-testid="insight-leaf"]').length)
    check(`${T}：心得樹占滿整列寬度（≥ 80% 視窗）、STATUS 在樹的下方`, await page.evaluate(() => {
      const t = document.querySelector('.st-home [data-testid="insight-tree"]'), a = document.querySelector('.st-aside')
      if (!t || !a) return false
      return t.getBoundingClientRect().width >= window.innerWidth * 0.8 && a.getBoundingClientRect().top >= t.getBoundingClientRect().bottom - 1
    }))
    check(`${T}：標題「我的心得樹」與指標列（心得 N 則・本月 +k・脈絡 M 條・最常印證：〈前 20 字〉）`, /我的心得樹/.test(await page.locator('.it-title').innerText()) && /^心得 68 則・本月 \+\d+・脈絡 \d+ 條・最常印證：〈虛構心得 I-01/.test((await page.locator('[data-testid="insight-stats"]').innerText()).trim()), await page.locator('[data-testid="insight-stats"]').innerText())
    check(`${T}：68 片葉（≥60 則）、至少一片發光、至少一片枯萎`, N === 68 && (await page.locator('.it-leaf.it-glow').count()) >= 2 && (await page.locator('.it-leaf.it-dead').count()) >= 1)
    check(`${T}：葉子有 role=button、aria-label（日期＋一句話）、可 Tab`, await page.evaluate(() => {
      const l = document.querySelector('[data-testid="insight-leaf"]')
      return l.getAttribute('role') === 'button' && /^\d{4}-\d{2}-\d{2} 虛構心得/.test(l.getAttribute('aria-label') ?? '') && l.getAttribute('tabindex') === '0'
    }))
    check(`${T}：群清單在樹的右側（同一張卡內），7 列、每列有色點、則數、最近日期與 12 根迷你長條`, await page.evaluate(() => {
      const t = document.querySelector('.it-stage').getBoundingClientRect(), s = document.querySelector('.it-side').getBoundingClientRect(), root = document.querySelector('.it-root').getBoundingClientRect()
      const rows = [...document.querySelectorAll('[data-testid="insight-row"]')]
      return t.right <= s.left + 1 && s.right <= root.right + 1 && rows.length === 7 && rows.every((r) => r.querySelector('.it-row-dot') && /^\d+$/.test(r.querySelector('.it-row-n').textContent) && /\d/.test(r.querySelector('.it-row-d').textContent) && r.querySelectorAll('.it-bars rect').length === 12)
    }))
    check(`${T}：沒有左側時間刻度與水平參考線、圖例小圖示列`, (await page.locator('.it-tick').count()) === 0 && (await page.locator('.it-ref').count()) === 0 && (await page.locator('.it-legend li').count()) === 6 && (await page.locator('.it-legend svg').count()) === 4)
    check(`${T}：主題膠囊（色點＋群名＋則數）互不重疊、都在畫布內，放不下的縮成色點`, await page.evaluate(() => {
      const st = document.querySelector('.it-stage').getBoundingClientRect()
      const caps = [...document.querySelectorAll('[data-testid="insight-cap"]')]
      const dots = document.querySelectorAll('[data-testid="insight-dot"]').length
      if (caps.length + dots !== 7 || caps.length < 3) return false
      const rs = caps.map((c) => c.querySelector('.it-cap-bg').getBoundingClientRect())
      return caps.every((c) => !!c.querySelector('.it-cap-dot') && !!c.querySelector('.it-cap-t')) && rs.every((r, i) => r.left >= st.left - 1 && r.right <= st.right + 1 && rs.every((q, j) => j <= i || r.right < q.left || r.left > q.right || r.bottom < q.top || r.top > q.bottom))
    }))
    check(`${T}：主枝在樹幹上由下往上依「主題第一次出現」排列（越早越低、等距）`, await page.evaluate(() => {
      const ys = [0, 1, 2, 3, 4, 5, 6].map((ci) => document.querySelector(`path.it-limb[data-level="cluster"][data-ci="${ci}"]`)?.getBoundingClientRect().bottom ?? NaN)
      if (ys.some(Number.isNaN)) return false
      const gaps = ys.slice(1).map((y, i) => ys[i] - y)
      return gaps.every((g) => g > 0) && Math.max(...gaps) - Math.min(...gaps) < 14
    }))
    check(`${T}：同主題的葉由內往外越來越新（最新的葉離樹幹比最舊的遠），不會長回別處`, await page.evaluate(() => {
      const t = document.querySelector('.it-trunk').getBoundingClientRect(), cx = (t.left + t.right) / 2
      const leaves = [...document.querySelectorAll('[data-testid="insight-leaf"][data-ci="0"]')].map((e) => ({ d: (e.getAttribute('aria-label') || '').slice(0, 10), x: Math.abs((e.getBoundingClientRect().left + e.getBoundingClientRect().right) / 2 - cx) })).sort((a, b) => (a.d < b.d ? -1 : 1))
      if (leaves.length < 6) return false
      const first = leaves.slice(0, 3), last = leaves.slice(-3)
      const avg = (a) => a.reduce((s, v) => s + v.x, 0) / a.length
      return avg(last) > avg(first) + 20
    }))
    check(`${T}：枝是由粗到細的填色輪廓（path 以 Z 結尾、不是描邊線）、葉子有四種形狀`, await page.evaluate(() => {
      const limbs = [...document.querySelectorAll('.it-limb')]
      const kinds = new Set([...document.querySelectorAll('[data-testid="insight-leaf"] .it-shape')].map((e) => e.getAttribute('data-kind')))
      return limbs.length > 20 && limbs.every((l) => /Z$/.test(l.getAttribute('d'))) && kinds.size === 4
    }))
    // ── 聚焦某一群：點群清單一列 → 其他群淡出、viewBox 放大；再點回全樹 ──
    const vbOf = () => page.evaluate(() => document.querySelector('.it-svg').getAttribute('viewBox'))
    const vb0 = await vbOf()
    await page.locator('[data-testid="insight-row"]').nth(2).click()
    await page.waitForTimeout(900)
    const vb1 = await vbOf()
    check(`${T}：點群清單一列＝聚焦該群（aria-pressed、其他群淡到約 25%、viewBox 改變）`, (await page.locator('[data-testid="insight-row"]').nth(2).getAttribute('aria-pressed')) === 'true' && (await page.locator('.it-svg.it-fx').count()) === 1
      && (await page.evaluate(() => { const d = document.querySelector('.it-leaf.it-dimc'); return !!d && +getComputedStyle(d).opacity < 0.4 })) && vb1 !== vb0, `${vb0} → ${vb1}`)
    await page.locator('[data-testid="insight-row"]').nth(2).click()
    await page.waitForTimeout(900)
    check(`${T}：再點一次回到全樹（viewBox 還原、沒有淡出）`, (await vbOf()) === vb0 && (await page.locator('.it-svg.it-fx').count()) === 0)
    await page.locator('[data-testid="insight-row"]').nth(1).click(); await page.waitForTimeout(700)
    await page.locator('[data-testid="insight-all"]').click(); await page.waitForTimeout(900)
    check(`${T}：按「全部」也回到全樹`, (await vbOf()) === vb0 && (await page.locator('.it-svg.it-fx').count()) === 0)
    await page.locator('[data-testid="insight-row"]').nth(1).click(); await page.waitForTimeout(900)
    await page.locator('.it-root').screenshot({ path: path.join(SHOTS, 'focus-desktop.png') })
    await page.locator('[data-testid="insight-all"]').click(); await page.waitForTimeout(900)
    // ── 滑過葉子：整條脈絡路徑亮起、其他變淡；Tab 聚焦效果相同 ──
    await page.locator('[data-testid="insight-leaf"][aria-label*="虛構心得 G-30"]').first().hover()
    await page.waitForTimeout(400)
    check(`${T}：滑過葉子 → 從樹幹到它的路徑亮起（it-lit 的枝 ≥ 3 段）、其他枝淡出、提示卡有日期與關係標籤`, (await page.locator('.it-svg.it-hl').count()) === 1 && (await page.locator('.it-limb.it-lit').count()) >= 3
      && (await page.evaluate(() => { const o = [...document.querySelectorAll('.it-limb:not(.it-lit)')].find((e) => !e.classList.contains('it-dimc')); return !!o && +getComputedStyle(o).opacity < 0.3 }))
      && /\d{4}-\d{2}-\d{2}/.test(await page.locator('[data-testid="insight-tip"] .it-tip-d').innerText()) && (await page.locator('[data-testid="insight-tip"] .it-rel').count()) === 1)
    await page.mouse.move(5, 5)
    await page.locator('[data-testid="insight-leaf"][aria-label*="虛構心得 G-31"]').first().focus()
    check(`${T}：鍵盤聚焦葉子效果相同`, (await page.locator('.it-svg.it-hl').count()) === 1 && (await page.locator('.it-limb.it-lit').count()) >= 3)
    await page.evaluate(() => document.activeElement.blur())
    check(`${T}：沒有任何 JS 錯誤`, errors.length === 0, errors.join(' | '))
    await page.locator('.it-root').screenshot({ path: path.join(SHOTS, 'dark-desktop.png') })

    // ── 2. 現在用得上收在角落 ──
    check(`${T}：「現在用得上（n）」預設收起`, /^現在用得上（\d+）$/.test((await page.locator('[data-testid="now-corner-btn"]').innerText()).trim()) && (await page.locator('[data-testid="now-section"]').count()) === 0)
    await page.locator('[data-testid="now-corner-btn"]').click()
    await page.waitForSelector('[data-testid="now-section"]')
    check(`${T}：按了在原位展開原本的區塊`, await page.evaluate(() => { const n = document.querySelector('[data-testid="now-section"]'), t = document.querySelector('[data-testid="insight-tree"]'); return !!n && !!(t.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) && /現在用得上/.test(n.textContent) }))
    await page.locator('[data-testid="now-corner-close"]').click()
    check(`${T}：可再收起`, (await page.locator('[data-testid="now-section"]').count()) === 0 && (await page.locator('[data-testid="now-corner-btn"]').count()) === 1)

    // ── 3. hover 提示、點葉開面板 ──
    const leaf = page.locator('[data-testid="insight-leaf"]').nth(2)
    await leaf.hover()
    check(`${T}：hover 葉子顯示那句心得`, /虛構心得/.test(await page.locator('[data-testid="insight-tip"]').innerText().catch(() => '')))
    await page.locator('[data-testid="insight-leaf"][aria-label*="虛構心得 I-03"]').first().focus()
    await page.keyboard.press('Enter')
    await page.waitForSelector('[data-testid="insight-panel"]')
    await page.waitForSelector('[data-testid="insight-evidence"]')
    check(`${T}：面板有那句心得、日記原文、出處`, /I-03/.test(await page.locator('[data-testid="insight-panel-text"]').innerText()) && /虛構日記原文/.test(await page.locator('[data-testid="insight-evidence"]').innerText()) && /日記\//.test(await page.locator('[data-testid="insight-panel"]').innerText()))
    const rows = await page.locator('[data-testid="insight-thread"] li').count()
    check(`${T}：整條脈絡時間線（TH-a 共 5 則）、目前這則高亮、有 relation 中文`, rows === 5 && (await page.locator('[data-testid="insight-thread"] li.it-cur').count()) === 1 && /印證/.test(await page.locator('[data-testid="insight-thread"]').innerText()) && /修正/.test(await page.locator('[data-testid="insight-thread"]').innerText()), `rows=${rows}`)
    check(`${T}：面板有 📌 需要時提醒我`, (await page.locator('[data-testid="insight-panel"] .pt-pin-btn').count()) === 1)
    await page.locator('[data-testid="insight-date"]').click()
    await page.waitForSelector('[data-testid="day-report-dialog"]')
    const dlgW = await page.locator('[data-testid="day-report-dialog"]').evaluate((el) => el.getBoundingClientRect().width)
    check(`${T}：點「看那天日報」開出全尺寸視窗（寬 ≥ 視窗 80%）、面板內沒有日報嵌入`, dlgW >= 1440 * 0.8 && (await page.locator('[data-testid="insight-panel"] [data-testid="insight-day"]').count()) === 0, `w=${dlgW}`)
    await page.keyboard.press('Escape')
    check(`${T}：Esc 關掉日報視窗後心得面板仍在`, (await page.locator('[data-testid="day-report-dialog"]').count()) === 0 && (await page.locator('[data-testid="insight-panel"]').count()) === 1)
    await page.locator('[data-testid="insight-date"]').click()
    await page.waitForSelector('[data-testid="day-dialog-timeline-link"]')
    const href = await page.locator('[data-testid="day-dialog-timeline-link"]').getAttribute('href')
    check(`${T}：視窗裡「在時間軸看」是深連結`, /^#graph\/timeline\/day\/\d{4}-\d{2}-\d{2}\?from=insight%2F/.test(href ?? ''), String(href))
    await page.locator('[data-testid="day-dialog-timeline-link"]').click()
    await page.waitForSelector('[data-testid="day-back-from"]')
    check(`${T}：時間軸直接顯示那天的日報對話框，左上有「‹ 回到心得」`, /回到心得/.test(await page.locator('[data-testid="day-back-from"]').innerText()))
    await page.locator('[data-testid="day-back-from"]').click()
    await page.waitForSelector('[data-testid="insight-panel"]')
    check(`${T}：按「‹ 回到心得」回到首頁並打開同一則心得面板`, /I-03/.test(await page.locator('[data-testid="insight-panel-text"]').innerText()))
    await page.goBack()
    check(`${T}：瀏覽器上一頁可回到時間軸那天（再上一頁回心得）`, /graph\/timeline\/day\//.test(page.url()))
    await page.goBack()
    await page.waitForSelector('[data-testid="insight-panel"]')
    await page.locator('[data-testid="insight-thread"] li button').first().click()
    await page.waitForFunction(() => /I-01/.test(document.querySelector('[data-testid="insight-panel-text"]')?.textContent ?? ''))
    check(`${T}：點脈絡中另一則會切換面板`, true)
    await page.screenshot({ path: path.join(SHOTS, 'panel-desktop.png') })
    await page.keyboard.press('Escape')
    check(`${T}：Esc 關閉面板`, (await page.locator('[data-testid="insight-panel"]').count()) === 0)

    // ── 4. 重播 ──
    const total = await page.locator('[data-testid="insight-leaf"]').count()
    await page.locator('[data-testid="insight-play"]').click()
    check(`${T}：按下後按鈕變「⏸ 停」`, /⏸ 停/.test(await page.locator('[data-testid="insight-play"]').innerText()))
    await page.waitForTimeout(1500)
    check(`${T}：播放中月份用大字顯示在時間刻度旁`, /^\d{4}-\d{2}$/.test(await page.locator('.it-bigmonth').textContent().catch(() => '')))
    check(`${T}：新出現的枝描邊長出、葉子彈出（it-fresh／it-pop 動畫類別存在）`, (await page.locator('.it-fresh, .it-pop').count()) >= 0)
    check(`${T}：播放中月份顯示在樹下、葉子還沒全長出來`, /重播中 \d{4}-\d{2}/.test(await page.locator('[data-testid="insight-month"]').innerText()) && (await page.locator('[data-testid="insight-leaf"]').count()) < total, await page.locator('[data-testid="insight-month"]').innerText())
    await page.locator('[data-testid="insight-play"]').click()
    const stopped = await page.locator('[data-testid="insight-month"]').innerText()
    const leavesAtStop = await page.locator('[data-testid="insight-leaf"]').count()
    await page.waitForTimeout(800)
    check(`${T}：按「⏸ 停」停在當月（月份與葉數不再變）`, /停在 \d{4}-\d{2}/.test(stopped) && stopped === (await page.locator('[data-testid="insight-month"]').innerText()) && leavesAtStop === (await page.locator('[data-testid="insight-leaf"]').count()) && /▶ 看它怎麼長/.test(await page.locator('[data-testid="insight-play"]').innerText()), stopped)
    await page.locator('[data-testid="insight-play"]').click()
    await page.waitForFunction(() => /至今/.test(document.querySelector('[data-testid="insight-month"]')?.textContent ?? ''), null, { timeout: 12000 })
    check(`${T}：重播約 6 秒內走到今天、葉子全回來`, (await page.locator('[data-testid="insight-leaf"]').count()) === total)
    await ctx.close()
  }

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

  // ── 6. #insight/<id> 直接開面板 ──
  {
    const T = '#insight/<id>'
    const { ctx, page } = await open({ width: 1280, height: 800 }, { hash: '#insight/I-13' })
    await page.waitForSelector('[data-testid="insight-panel"]', { timeout: 10000 })
    await page.waitForSelector('[data-testid="insight-evidence"]')
    check(`${T}：回首頁並打開該則面板、顯示推翻`, /I-13/.test(await page.locator('[data-testid="insight-panel-text"]').innerText()) && /推翻/.test(await page.locator('[data-testid="insight-thread"]').innerText()))
    await page.locator('.it-x').click()
    check(`${T}：關閉後網址不再停在 #insight`, !/#insight/.test(page.url()))
    await ctx.close()
  }

  // ── 7. 手機 360×740 ──
  {
    const T = '手機 360×740'
    const { ctx, page } = await open({ width: 360, height: 740 })
    await page.waitForSelector('[data-testid="insight-leaf"]')
    check(`${T}：無橫向捲動`, await noHScroll(page))
    // 手機上標籤放不下就縮成色點（使用者要的「自動隱藏、點清單才放大」），所以每群要有膠囊或色點其一
    check(`${T}：群清單在樹的下方（單欄）、每群都有膠囊或色點`, await page.evaluate(() => { const t = document.querySelector('.it-stage').getBoundingClientRect(), s = document.querySelector('.it-side').getBoundingClientRect(); const n = document.querySelectorAll('[data-testid="insight-cap"]').length + document.querySelectorAll('[data-testid="insight-dot"]').length; return s.top >= t.bottom - 1 && n >= 1 }))
    check(`${T}：樹寬度自適應（svg 不超出容器）`, await page.evaluate(() => { const s = document.querySelector('.it-svg').getBoundingClientRect(), r = document.querySelector('.it-root').getBoundingClientRect(); return s.right <= r.right + 1 && s.left >= r.left - 1 }))
    await page.locator('[data-testid="insight-leaf"]').nth(4).focus()
    await page.keyboard.press('Enter')
    await page.waitForSelector('[data-testid="insight-panel"]')
    check(`${T}：開著面板也無橫向捲動`, await noHScroll(page))
    await page.screenshot({ path: path.join(SHOTS, 'panel-mobile.png') })
    await page.keyboard.press('Escape')
    await page.locator('[data-testid="now-corner-btn"]').click()
    await page.waitForSelector('[data-testid="now-section"]')
    check(`${T}：展開現在用得上後仍無橫向捲動`, await noHScroll(page))
    await ctx.close()
  }

  // ── 聚焦只有 3 則、日期集中 4 個月的主題（使用者 2026-11-15：日期糊在一起、膠囊不好點）──
  for (const [w, h, scheme] of [[1440, 900, 'dark'], [1440, 900, 'light'], [360, 800, 'dark']]) {
    const T = `近似正式站 9 群 13 則聚焦「家庭溝通」${w}×${h} ${scheme}`
    const { ctx, page, errors } = await open({ width: w, height: h }, { mode: 'prod13', colorScheme: scheme })
    await page.waitForSelector('[data-testid="insight-leaf"]', { timeout: 10000 })
    await page.locator('[data-testid="insight-row"]', { hasText: '家庭溝通' }).click()
    await page.waitForTimeout(1100)
    await page.locator('[data-testid="insight-cap"][aria-pressed="true"]').first().scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    const r = await page.evaluate(() => {
      const caps = [...document.querySelectorAll('[data-testid="insight-cap"]')].filter((c) => c.getAttribute('aria-pressed') === 'true')
      const bg = caps[0]?.querySelector('.it-cap-bg')?.getBoundingClientRect()
      let hit = false, over = 0, small = 0
      if (bg) {
        const el = document.elementFromPoint((bg.left + bg.right) / 2, (bg.top + bg.bottom) / 2)
        hit = !!el && !!el.closest('[data-testid="insight-cap"]'); window.__el = el ? el.tagName + '.' + (el.getAttribute('class') || '') + ' in ' + (el.closest('g')?.getAttribute('class') || '') : 'none'
        for (const l of document.querySelectorAll('[data-testid="insight-leaf"] .it-shape')) { const q = l.getBoundingClientRect(); if (q.left < bg.right && q.right > bg.left && q.top < bg.bottom && q.bottom > bg.top) over++ }
        const hr = caps[0].querySelector('.it-cap-hit')?.getBoundingClientRect()
        small = hr && (hr.width < 31.5 || hr.height < 31.5) ? 1 : 0
      }
      const ts = [...document.querySelectorAll('[data-testid="insight-btick"]')].map((g) => ({ b: g.querySelector('rect').getBoundingClientRect(), t: g.querySelector('text').getBoundingClientRect(), label: g.querySelector('text').textContent }))
      let tickOverlap = 0
      for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) { const a = ts[i].b, b = ts[j].b; if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) tickOverlap++ }
      return { el: window.__el, bg: bg && [Math.round(bg.left), Math.round(bg.top), Math.round(bg.width)], n: ts.length, hit, over, small, tickOverlap, minH: Math.min(...ts.map((x) => x.t.height)), labels: ts.map((x) => x.label) }
    })
    check(`${T}：日期標籤 ≥ 2 個（含首尾）、彼此不重疊、字夠大`, r.n >= 2 && r.tickOverlap === 0 && r.minH >= 10, JSON.stringify(r))
    check(`${T}：膠囊中心點得到（elementFromPoint 落在膠囊）、不壓任何葉子、可點範圍 ≥ 32px`, r.hit && r.over === 0 && r.small === 0, JSON.stringify(r))
    await page.locator('.it-root').screenshot({ path: path.join(SHOTS, `focus-${scheme}-${w}.png`) })
    check(`${T}：沒有 JS 錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ── 稀疏資料（正式站現況：2 則、同一天兩群）要像一棵小樹，不是貼地的鬍子 ──
  for (const [mode, n] of [['sparse1', 1], ['sparse2', 2], ['sparse3', 3]]) {
    const T = `稀疏 ${n} 則`
    const { ctx, page, errors } = await open({ width: 1440, height: 900 }, { mode })
    await page.waitForSelector('[data-testid="insight-leaf"]', { timeout: 10000 })
    await page.waitForTimeout(500)
    const m = await page.evaluate(() => {
      const svg = document.querySelector('.it-svg').getBoundingClientRect()
      const els = [...document.querySelectorAll('.it-trunk, .it-limb, [data-testid="insight-leaf"]')].map((e) => e.getBoundingClientRect())
      const top = Math.min(...els.map((r) => r.top)), bottom = Math.max(...els.map((r) => r.bottom))
      const trunk = document.querySelector('.it-trunk').getBoundingClientRect()
      return { treeH: (bottom - top) / svg.height, trunkH: trunk.height / svg.height, leaves: document.querySelectorAll('[data-testid="insight-leaf"]').length, caps: document.querySelectorAll('[data-testid="insight-cap"]').length }
    })
    check(`${T}：樹幹高度 ≥ 繪圖區 50%（固定高度，不因主枝少而縮短）`, m.trunkH >= 0.5, JSON.stringify(m))
    check(`${T}：每一群都有標籤膠囊、有小樹苗提示`, m.caps === (n === 1 ? 1 : n === 2 ? 2 : 3) && (await page.locator('[data-testid="insight-seedling"]').innerText()).includes('小樹苗：HERMES 每晚會從日記補上你的心得'))
    check(`${T}：沒有時間刻度與參考線`, (await page.locator('.it-tick').count()) === 0)
    check(`${T}：沒有 JS 錯誤`, errors.length === 0, errors.join(' | '))
    await page.locator('.it-root').screenshot({ path: path.join(SHOTS, `r1-sparse${n}-dark-desktop.png`) })
    if (n === 2) {
      const mob = await open({ width: 360, height: 1100 }, { mode })
      await mob.page.waitForSelector('[data-testid="insight-leaf"]', { timeout: 10000 })
      await mob.page.waitForTimeout(500)
      check(`${T}：手機 360 無橫向捲動、群標籤都在`, (await noHScroll(mob.page)) && (await mob.page.locator('[data-testid="insight-cap"]').count()) === 2)
      await mob.page.locator('.it-root').screenshot({ path: path.join(SHOTS, 'r1-sparse2-mobile-360.png') })
      await mob.ctx.close()
    }
    await ctx.close()
  }
  {
    const nm = await open({ width: 1440, height: 900 })
    await nm.page.waitForSelector('[data-testid="insight-leaf"]', { timeout: 10000 })
    check('心得多（68 則）時不顯示小樹苗提示', (await nm.page.locator('[data-testid="insight-seedling"]').count()) === 0)
    await nm.ctx.close()
  }

  // ── 12 群 300 則：每一群都有標籤；聚焦時刻度與膠囊不被裁切 ──
  for (const [w, h] of [[1440, 900], [360, 1500]]) {
    const T = `12 群 300 則 ${w}×${h}`
    const { ctx, page, errors } = await open({ width: w, height: h }, { mode: 'big300' })
    await page.waitForSelector('[data-testid="insight-leaf"]', { timeout: 10000 })
    await page.waitForTimeout(600)
    check(`${T}：300 片葉、總覽自動精簡成葉叢（葉子少於 300）、12 個主題各有膠囊或色點`, (await page.locator('[data-testid="insight-leaf"]').count()) < 300 && (await page.locator('[data-testid="insight-clump"]').count()) >= 1 && (await page.locator('[data-testid="insight-cap"], [data-testid="insight-dot"]').count()) === 12)
    check(`${T}：標籤都在畫布內`, await page.evaluate(() => { const st = document.querySelector('.it-stage').getBoundingClientRect(); return [...document.querySelectorAll('[data-testid="insight-cap"] .it-cap-bg')].every((e) => { const r = e.getBoundingClientRect(); return r.left >= st.left - 1 && r.right <= st.right + 1 && r.top >= st.top - 1 && r.bottom <= st.bottom + 1 }) }))
    if (w === 1440) await page.locator('.it-root').screenshot({ path: path.join(SHOTS, 'r1-big300-dark-desktop.png') })
    if (w === 360) {
      const nDots = await page.locator('[data-testid="insight-dot"]').count()
      check(`${T}：主題太多放不下的縮成色點（≥ 1 個）`, nDots >= 1, String(nDots))
      const box = await page.locator('[data-testid="insight-dot"] .it-cap-hit').first().boundingBox()
      const capsBefore = await page.locator('[data-testid="insight-cap"]').count()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(250)
      const capsAfter = await page.locator('[data-testid="insight-cap"]').count(), dotsAfter = await page.locator('[data-testid="insight-dot"]').count()
      check(`${T}：滑過色點會放大成完整膠囊`, capsAfter === capsBefore + 1 && dotsAfter === nDots - 1, `caps ${capsBefore}→${capsAfter} dots ${nDots}→${dotsAfter} box ${JSON.stringify(box)} under=${await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.tagName + '.' + (e.getAttribute('class') || '') : 'none' }, [box.x + box.width / 2, box.y + box.height / 2])}`)
      await page.mouse.move(2, 2); await page.waitForTimeout(250)
      check(`${T}：移開後縮回色點`, (await page.locator('[data-testid="insight-dot"]').count()) === nDots)
      await page.locator('.it-root').screenshot({ path: path.join(SHOTS, 'mobile-big300-360.png') })
    }
    for (const idx of [0, 5, 11]) {
      await page.locator('[data-testid="insight-row"]').nth(idx).click()
      await page.waitForTimeout(800)
      const r = await page.evaluate((i) => {
        const st = document.querySelector('.it-stage').getBoundingClientRect()
        const ticks = [...document.querySelectorAll('[data-testid="insight-btick"] text')].map((e) => e.getBoundingClientRect())
        const caps = [...document.querySelectorAll('[data-testid="insight-cap"]')]
        const cap = caps.find((c) => c.getAttribute('aria-pressed') === 'true')?.querySelector('.it-cap-bg')?.getBoundingClientRect()
        return { ticks: ticks.length, ticksOk: ticks.every((t) => t.left >= st.left - 1 && t.right <= st.right + 1 && t.top >= st.top - 1 && t.bottom <= st.bottom + 1 && t.width > 0), capOk: !!cap && cap.left >= st.left - 1 && cap.right <= st.right + 1 && cap.top >= st.top - 1 && cap.bottom <= st.bottom + 1 }
      }, idx)
      check(`${T}：聚焦第 ${idx + 1} 個主題後沿主枝的時間標籤完整（${r.ticks} 個）、該群膠囊完整、該群葉子全畫出（無葉叢）`, r.ticks >= 1 && r.ticksOk && r.capOk, JSON.stringify(r))
      if (w === 1440 && idx === 5) await page.locator('.it-root').screenshot({ path: path.join(SHOTS, 'r1-big300-focus.png') })
    }
    check(`${T}：沒有 JS 錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ── 手機截圖：360 寬、拉高視窗讓整張卡（樹＋群清單）都在畫面內 ──
  {
    const { ctx, page } = await open({ width: 360, height: 1500 })
    await page.waitForSelector('[data-testid="insight-leaf"]', { timeout: 10000 })
    await page.waitForTimeout(600)
    await page.locator('.it-root').screenshot({ path: path.join(SHOTS, 'dark-mobile-360.png') })
    await ctx.close()
  }

  // ── 淺色桌機 ──
  {
    const T = '淺色桌機'
    const { ctx, page } = await open({ width: 1440, height: 900 }, { colorScheme: 'light' })
    await page.waitForSelector('[data-testid="insight-leaf"]', { timeout: 10000 })
    await page.waitForTimeout(600)
    check(`${T}：用淺色色盤（data-theme-mode=light）`, (await page.locator('.it-root').getAttribute('data-theme-mode')) === 'light')
    await page.locator('.it-root').screenshot({ path: path.join(SHOTS, 'light-desktop.png') })
    await ctx.close()
  }

  // ── 9. 心得卷宗（3.2.0）：擠的、稀疏的、點人／知識／想法、上一頁、360 寬 ──
  {
    const T = '卷宗'
    // 擠：8 人、6 想法、3 知識、8 條 headings
    let r = await open({ width: 1440, height: 900 }, { mode: 'dcrowd', colorScheme: 'dark' })
    await r.page.waitForSelector('[data-testid="insight-leaf"]')
    await r.page.locator('[data-testid="insight-leaf"][aria-label*="虛構心得 D-2"]').first().focus()
    await r.page.keyboard.press('Enter')
    await r.page.waitForSelector('[data-testid="insight-day-headings"]', { timeout: 10000 })
    const hs = r.page.locator('[data-testid="insight-day-headings"] li')
    const n4 = await hs.count()
    const moreTxt = await r.page.locator('[data-testid="insight-day-more"]').innerText()
    await r.page.locator('[data-testid="insight-day-more"]').click()
    check(`${T}：那天的幾件事先顯示 4 條，按「還有 4 件」展開成 8 條`, n4 === 4 && /還有 4 件/.test(moreTxt) && (await hs.count()) === 8)
    const chips = (id) => r.page.locator(`[data-testid="${id}"] .it-chip`)
    check(`${T}：見了誰 8 個、同一段排前並有標記；在做的想法 6 個；相關知識 3 個`, (await chips('insight-people').count()) === 8 && /同一段/.test(await chips('insight-people').first().innerText()) && (await chips('insight-ideas').count()) === 6 && (await chips('insight-topics').count()) === 3)
    check(`${T}：沒有卷宗的人是不可點 chip（title=還沒有人物卷宗）、想法 chip 顯示階段與「有提到」`, (await r.page.locator('[data-testid="insight-people"] .it-chip-off[title="還沒有人物卷宗"]').count()) >= 1 && /聚焦|候選|已完成|封存/.test(await chips('insight-ideas').first().innerText()) && (await r.page.locator('[data-testid="insight-ideas"]').innerText()).includes('有提到'))
    check(`${T}：沒有「這則還沒連上」淡字`, (await r.page.locator('[data-testid="insight-nolinks"]').count()) === 0)
    check(`${T}：後來怎麼變有 3 則、目前這則醒目、沒有「還沒有後續」`, (await r.page.locator('[data-testid="insight-thread"] li').count()) === 3 && (await r.page.locator('[data-testid="insight-thread"] li.it-cur').count()) === 1 && (await r.page.locator('[data-testid="insight-alone"]').count()) === 0)
    await r.page.locator('[data-testid="insight-panel"]').screenshot({ path: path.join(SHOTS, 'dossier-crowd-desktop-dark.png') })
    // 點知識 → #knowledge/
    await r.page.locator('[data-testid="insight-topics"] a').first().click()
    await r.page.waitForTimeout(400)
    check(`${T}：點知識 → location.hash 以 #knowledge/ 開頭`, (await r.page.evaluate(() => location.hash)).startsWith('#knowledge/'), await r.page.evaluate(() => location.hash))
    await r.page.goBack()
    await r.page.waitForSelector('[data-testid="insight-panel"]', { timeout: 10000 })
    // 點人 → #dossier/person/，再按上一頁回到首頁且心得面板重開
    await r.page.waitForSelector('[data-testid="insight-people"] a')
    await r.page.locator('[data-testid="insight-people"] a').first().click()
    await r.page.waitForTimeout(400)
    check(`${T}：點人 → location.hash 以 #dossier/person/ 開頭`, (await r.page.evaluate(() => location.hash)).startsWith('#dossier/person/'), await r.page.evaluate(() => location.hash))
    await r.page.goBack()
    await r.page.waitForSelector('[data-testid="insight-panel"]', { timeout: 10000 })
    check(`${T}：從人物卷宗按上一頁 → 回首頁且心得面板重新開著`, /D-2/.test(await r.page.locator('[data-testid="insight-panel-text"]').innerText()) && (await r.page.locator('.st-home').count()) === 1)
    // 點想法 → 想法庫抽屜含該想法標題、心得面板關閉
    await r.page.waitForSelector('[data-testid="insight-ideas"] button')
    await r.page.locator('[data-testid="insight-ideas"] button').first().click()
    await r.page.waitForSelector('[data-testid="idea-search"]', { timeout: 10000 })
    check(`${T}：點想法 → 心得面板關閉、想法庫抽屜出現且清單含該想法標題`, (await r.page.locator('[data-testid="insight-panel"]').count()) === 0 && (await r.page.locator('.bd-idea-list').innerText()).includes('虛構想法甲') && (await r.page.locator('[data-testid="idea-search"]').inputValue()) === 'IDEA-0001')
    await r.ctx.close()
    // 稀疏：1 則、無任何連結
    r = await open({ width: 1280, height: 800 }, { mode: 'sparse1' })
    await r.page.waitForSelector('[data-testid="insight-leaf"]')
    await r.page.locator('[data-testid="insight-leaf"]').first().focus()
    await r.page.keyboard.press('Enter')
    await r.page.waitForSelector('[data-testid="insight-nolinks"]', { timeout: 10000 })
    check(`${T}：稀疏只看到一行淡字「這則還沒連上人、想法或知識」，沒有人／想法／知識區塊`, /這則還沒連上人、想法或知識/.test(await r.page.locator('[data-testid="insight-nolinks"]').innerText()) && (await r.page.locator('[data-testid="insight-people"], [data-testid="insight-ideas"], [data-testid="insight-topics"], [data-testid="insight-day-headings"]').count()) === 0 && /還沒有後續的印證或修正/.test(await r.page.locator('[data-testid="insight-alone"]').innerText()))
    await r.page.locator('[data-testid="insight-panel"]').screenshot({ path: path.join(SHOTS, 'dossier-sparse.png') })
    await r.ctx.close()
    // 360 寬、淺色、擠
    r = await open({ width: 360, height: 740 }, { mode: 'dcrowd', colorScheme: 'light' })
    await r.page.waitForSelector('[data-testid="insight-leaf"]')
    await r.page.locator('[data-testid="insight-leaf"][aria-label*="虛構心得 D-2"]').first().focus()
    await r.page.keyboard.press('Enter')
    await r.page.waitForSelector('[data-testid="insight-people"]', { timeout: 10000 })
    await r.page.locator('[data-testid="insight-day-more"]').click()
    check(`${T}：360×740 擠的卷宗 scrollWidth ≤ 360、面板無橫向溢出`, await r.page.evaluate(() => { const p = document.querySelector('[data-testid="insight-panel"]'); return document.documentElement.scrollWidth <= 360 && p.scrollWidth <= p.clientWidth + 1 }))
    await r.page.screenshot({ path: path.join(SHOTS, 'dossier-crowd-360-light.png') })
    await r.ctx.close()
  }

  // ── 8. 狀態：未解鎖／空／失敗 ──
  {
    let r = await open({ width: 1280, height: 800 }, { unlocked: false })
    check('未解鎖：顯示既有的「解鎖後顯示」提示、沒有葉子', /解鎖後顯示/.test(await r.page.locator('[data-testid="insight-tree"]').innerText()) && (await r.page.locator('[data-testid="insight-leaf"]').count()) === 0)
    await r.ctx.close()
    r = await open({ width: 1280, height: 800 }, { mode: 'empty' })
    await r.page.waitForSelector('[data-testid="insight-empty"]')
    check('0 則：顯示「心得累積中：HERMES 每晚會從日記抽出你的體會，長成這棵樹」', /心得累積中：HERMES 每晚會從日記抽出你的體會，長成這棵樹/.test(await r.page.locator('[data-testid="insight-tree"]').innerText()))
    await r.ctx.close()
    r = await open({ width: 1280, height: 800 }, { mode: 'fail' })
    await r.page.waitForSelector('.it-frame .hm-retry', { timeout: 10000 })
    check('API 失敗：顯示可重試', /心得暫時讀不到/.test(await r.page.locator('[data-testid="insight-tree"]').innerText()) && (await r.page.locator('.it-frame .hm-retry').count()) === 1)
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
