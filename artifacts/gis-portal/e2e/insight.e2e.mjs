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
async function open(viewport, { unlocked = true, hash = '', mode = 'ok' } = {}) {
  const ctx = await browser.newContext({ viewport })
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
      return json(insightsBody)
    }
    const m = /^\/api\/insights\/(.+)$/.exec(p)
    if (m) { const d = detailOf(decodeURIComponent(m[1])); return d ? json(d) : json({ message: 'none' }, 404) }
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
    check(`${T}：心得樹在 st-home 左側、STATUS 在右側`, await page.evaluate(() => {
      const t = document.querySelector('.st-home [data-testid="insight-tree"]'), a = document.querySelector('.st-aside')
      if (!t || !a) return false
      return t.getBoundingClientRect().right <= a.getBoundingClientRect().left + 1 && t.getBoundingClientRect().width > 400
    }))
    check(`${T}：標題「我的心得樹」與指標列`, /我的心得樹/.test(await page.locator('.it-title').innerText()) && /心得 20 則・本月 \+\d+・最常長在「測量作業」/.test(await page.locator('[data-testid="insight-stats"]').innerText()), await page.locator('[data-testid="insight-stats"]').innerText())
    check(`${T}：20 片葉、至少一片發光、至少一片枯萎`, (await page.locator('[data-testid="insight-leaf"]').count()) === 20 && (await page.locator('.it-leaf.it-glow').count()) >= 2 && (await page.locator('.it-leaf.it-dead').count()) >= 1)
    check(`${T}：葉子有 role=button、aria-label（日期＋一句話）、可 Tab`, await page.evaluate(() => {
      const l = document.querySelector('[data-testid="insight-leaf"]')
      return l.getAttribute('role') === 'button' && /^\d{4}-\d{2}-\d{2} 虛構心得/.test(l.getAttribute('aria-label') ?? '') && l.getAttribute('tabindex') === '0'
    }))
    check(`${T}：沒有任何 JS 錯誤`, errors.length === 0, errors.join(' | '))
    await page.screenshot({ path: path.join(SHOTS, 'home-desktop.png') })

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
    check(`${T}：點日期展開那天日報區塊`, (await page.locator('[data-testid="insight-day"]').count()) === 1)
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
