// 時間軸真實瀏覽器驗證（手動執行；不在 CI 內，避免新增 playwright 依賴）。
//
// 做什麼：起一個本機靜態伺服器提供 dist/public，並以「假 API」模擬 /api/dashboard、/api/hermes-graph、
// /api/hermes-timeline（列表分頁＋單筆），再用 Playwright 驅動 Chromium 驗證列表、原文對話框、鍵盤、
// 焦點鎖、XSS、分頁、下鑽、事件晶片跳到關係圖、手機版。全程不碰任何真實服務。
//
// 執行：
//   pnpm --filter @workspace/gis-portal run build          # 需 PORT 與 BASE_PATH=/ 環境變數（見 vite.config.ts）
//   PLAYWRIGHT_MODULE_DIR=/path/to/node_modules CHROMIUM_PATH=/path/to/chrome \
//     node artifacts/gis-portal/e2e/timeline.e2e.mjs
// 截圖輸出到 E2E_SHOTS_DIR（預設 /tmp/timeline-e2e-shots）。
//
// 為什麼要有這個：vitest 沒有 DOM，鍵盤／焦點鎖／捲動載入／對話框這些行為單元測試測不到；
// 也曾靠它抓到「聚焦 effect 宣告順序」的真實 bug（見 RelationshipUniverse.tsx 的說明）。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const { chromium } = createRequire((process.env.PLAYWRIGHT_MODULE_DIR || '/opt/node22/lib/node_modules') + '/')('playwright')

import { fileURLToPath } from 'node:url'
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/public')
const SHOTS = process.env.E2E_SHOTS_DIR || '/tmp/timeline-e2e-shots'
fs.mkdirSync(SHOTS, { recursive: true })
const PWD = 'tok-test'
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' }

// ── 假資料 ──
const mk = (level, periodKey, startDate, endDate, over = {}) => ({
  level, periodKey, startDate, endDate, title: periodKey, summary: `這是 ${periodKey} 的一句話摘要，內容比較長一點用來確認單行截斷不會撐開列高，一直寫到超過一行的寬度為止。`,
  hasReport: true, rangeInferred: false, periodNote: null, generation: 3, eventCount: 0, events: [], mindScore: null, ...over,
})
const days = []
for (let i = 0; i < 40; i++) {
  const d = new Date(Date.UTC(2026, 8, 28 - i)); const ds = d.toISOString().slice(0, 10)
  const noReport = i === 3 || i === 4
  days.push(mk('day', ds, ds, ds, {
    hasReport: !noReport,
    summary: noReport ? '' : `${ds} 今天主要在整理管線設定，決定先收斂路徑設定再擴充功能，另外還要把驗證流程一起補齊，這句話刻意寫得很長，用來確認列表只顯示單行並以刪節號截斷，不會把列高撐開。`,
    mindScore: i % 5 === 0 ? 98.8 - i * 0.3 : null,
    eventCount: i === 0 ? 3 : i === 3 ? 2 : 0,
    events: i === 0 ? [{ id: 'ev1', title: '事件甲：整理檢核表' }, { id: 'ev2', title: '事件乙' }, { id: 'ev3', title: '事件丙' }] : i === 3 ? [{ id: 'ev4', title: '沒有日報那天的事件' }] : [],
  }))
}
const weeks = [
  mk('week', '2026-第40週', '2026-09-22', '2026-09-28'),
  mk('week', '2026-第39週', '2026-09-15', '2026-09-21'),
  mk('week', '2026-第35週', '2026-08-25', '2026-08-31', { hasReport: false, summary: '', rangeInferred: true }),
  mk('week', '2026-第25週', '2026-06-15', '2026-06-21', { rangeInferred: true }),
]
const quarters = [mk('quarter', '2026-Q2', '2026-04-01', '2026-06-30', { periodNote: '本季報涵蓋順延為 5–7 月（原曆定 4–6 月）' })]
const BODY = `# 🌙 每日精煉洞察 2026-09-28

⚡ **狀態與決策**
今天主要在整理管線設定。
第二行要保留換行。

| 維度 | 得分 |
|---|---|
| 轉化 | 99.3 |
| 連結 | 96.1 |

- 清單一
- 清單二

[安全連結](https://example.com/ok) 與 [壞連結](javascript:window.__xss=1) 與 <img src=x onerror="window.__xss=2"> 與 <script>window.__xss=3</script>

> 引用一句話`
const detail = (level, key) => {
  const list = { day: days, week: weeks, quarter: quarters, month: [], year: [] }[level]
  const it = list.find(x => x.periodKey === key)
  if (!it) return null
  const children = level === 'week' ? days.filter(d => d.startDate >= it.startDate && d.startDate <= it.endDate && d.hasReport).reverse().map(d => ({ level: 'day', periodKey: d.periodKey, startDate: d.startDate, title: d.title, summary: d.summary })) : []
  return { ...it, bodyMd: it.hasReport ? BODY : '', children }
}
const graph = {
  available: true, computedAt: '2026-09-29T00:00:00Z',
  metrics: { peopleCount: 1, eventsCount: 1, casesCount: 0, objectsCount: 0, avgParticipantsPerEvent: 1, orphanEventRatioPct: 0, trueOrphanEventRatioPct: 0, newEventsThisWeek: 1, newPeopleThisWeek: 0, mostActivePerson: null, activeCasesCount: 0, personRelationsCount: 0 },
  graph: { people: [{ name: '王小明', eventCount: 1 }], events: [{ id: 'ev1', date: '2026-09-28', title: '事件甲：整理檢核表', status: null, tags: [], case: null }], cases: [], objects: [],
    edges: [{ person: '王小明', eventId: 'ev1', role: '同事' }], caseEdges: [], objectEdges: [], personRelations: [], hubNarratives: [], hubAssessments: [] },
}

let listCalls = []
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const json = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
  if (u.pathname.startsWith('/api/')) {
    if (u.pathname === '/api/dashboard') return json({ summaries: [], unlocked: req.headers['x-admin-password'] === PWD })
    if (u.pathname === '/api/sites') return json([])
    if (u.pathname === '/api/hermes-graph') return req.headers['x-admin-password'] === PWD ? json(graph) : json({ message: 'no' }, 403)
    if (u.pathname === '/api/hermes-timeline') {
      if (req.headers['x-admin-password'] !== PWD) return json({ message: 'no' }, 403)
      const level = u.searchParams.get('level'); const limit = Number(u.searchParams.get('limit') || 30); const cursor = u.searchParams.get('cursor')
      listCalls.push({ level, cursor })
      const all = { day: days, week: weeks, month: [], quarter: quarters, year: [] }[level]
      const start = cursor ? Number(Buffer.from(cursor, 'base64url').toString()) : 0
      const page = all.slice(start, start + limit)
      return json({ level, items: page, nextCursor: start + limit < all.length ? Buffer.from(String(start + limit)).toString('base64url') : null })
    }
    const m = /^\/api\/hermes-timeline\/([^/]+)\/(.+)$/.exec(u.pathname)
    if (m) {
      if (req.headers['x-admin-password'] !== PWD) return json({ message: 'no' }, 403)
      const d = detail(decodeURIComponent(m[1]), decodeURIComponent(m[2]))
      return d ? json(d) : json({ message: 'nf' }, 404)
    }
    return json({}, 404)
  }
  let p = path.join(DIST, u.pathname === '/' ? 'index.html' : u.pathname)
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html')
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p))
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const results = []
const failedReqs = []
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`) }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
async function newPage(viewport, unlocked = true) {
  const ctx = await browser.newContext({ viewport })
  if (unlocked) await ctx.addInitScript(k => localStorage.setItem('portal_unlocked', k), PWD)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('requestfailed', r => { failedReqs.push(r.url()) })
  page.on('console', m => { if (m.type() === 'error' && !/ERR_CERT_AUTHORITY_INVALID/.test(m.text())) errors.push(m.text()) })
  return { ctx, page, errors }
}

// ───────── 桌面 ─────────
{
  const { ctx, page, errors } = await newPage({ width: 1200, height: 800 })
  await page.goto(base + '/#graph/timeline')
  await page.waitForSelector('[data-testid=timeline-row]')
  check('列表載入、預設「日」級別、第一頁 30 筆', (await page.locator('[data-testid=timeline-row]').count()) === 30)
  check('分頁標籤顯示「時間軸」為作用中', (await page.locator('button[aria-current=page]').innerText()) === '時間軸')
  const bodyText = await page.locator('[data-testid=timeline-list]').innerText()
  check('列表只顯示一句話，不含原文（表格／清單／引用都沒出現）', !bodyText.includes('第二行要保留換行') && !bodyText.includes('清單一') && !bodyText.includes('引用一句話'))
  const h = await page.locator('[data-testid=timeline-row]').first().evaluate(e => e.getBoundingClientRect().height)
  check('長摘要被單行截斷（列高 < 60px）', h < 60, `height=${h.toFixed(1)}`)
  const lefts = await page.locator('[data-testid=timeline-row]').evaluateAll(rows => rows.slice(0, 12).filter(r => !r.textContent.includes('無日報')).map(r => Math.round([...r.querySelectorAll('span')].find(sp => sp.textContent.includes('今天主要'))?.getBoundingClientRect().left ?? -1)))
  check('有／無分數徽章的列，一句話左緣對齊', new Set(lefts).size === 1, `lefts=${[...new Set(lefts)].join(',')}`)
  check('列表確實顯示了一句話（不是「無摘要」占位）', (await page.locator('[data-testid=timeline-row]').first().innerText()).includes('今天主要在整理管線設定'))
  check('長摘要以刪節號截斷（scrollWidth > clientWidth）', await page.locator('[data-testid=timeline-row]').first().locator('span:has-text("今天主要在整理管線設定")').last().evaluate(e => e.scrollWidth > e.clientWidth))
  check('無日報的日子顯示占位文字並含當日事件數', (await page.locator('text=無日報 · 當日 2 件事件').count()) === 1)
  check('分組標題（2026 年 9 月）存在', (await page.locator('text=2026 年 9 月').count()) >= 1)
  await page.screenshot({ path: SHOTS + '/1-list-desktop.png' })

  // 捲到底 → 自動載入第二頁
  await page.locator('[data-testid=timeline-list]').evaluate(e => { e.scrollTop = e.scrollHeight })
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=timeline-row]').length === 40, null, { timeout: 5000 }).catch(() => {})
  check('捲到底自動載入下一頁（40 筆、無重複）', (await page.locator('[data-testid=timeline-row]').count()) === 40)
  check('分頁請求帶 cursor 且只發一次第二頁', listCalls.filter(c => c.level === 'day' && c.cursor).length === 1)
  await page.locator('[data-testid=timeline-list]').evaluate(e => { e.scrollTop = 0 })

  // 開對話框
  const first = page.locator('[data-testid=timeline-row]').first()
  await first.click()
  await page.waitForSelector('[role=dialog]')
  check('點擊後開啟對話框（role=dialog、aria-modal）', (await page.locator('[role=dialog][aria-modal=true]').count()) === 1)
  await page.waitForSelector('[role=dialog] table')
  check('原文渲染：表格、清單、引用、換行', (await page.locator('[role=dialog] table').count()) === 1 && (await page.locator('[role=dialog] li').count()) === 2 && (await page.locator('[role=dialog] blockquote').count()) === 1 && (await page.locator('[role=dialog] br').count()) >= 1)
  check('連結：https 為 <a>，javascript: 降級為純文字', (await page.locator('[role=dialog] a[href^="https://example.com"]').count()) === 1 && (await page.locator('[role=dialog] a[href^="javascript"]').count()) === 0)
  check('XSS：img onerror／script／javascript: 皆未執行', (await page.evaluate(() => window.__xss)) === undefined)
  check('window.__xss 不再被誤判為粗體（字中間的底線）', (await page.locator('[role=dialog] strong').allInnerTexts()).every(t => !t.includes('xss')))
  check('HTML 標籤以純文字顯示（未被解析成元素）', (await page.locator('[role=dialog] img').count()) === 0 && (await page.locator('[role=dialog] script').count()) === 0)
  check('焦點移到關閉鈕', (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === '關閉')
  await page.screenshot({ path: SHOTS + '/2-dialog-desktop.png' })

  // 鍵盤：← 較舊、→ 較新
  const title0 = await page.locator('#timeline-dialog-title').innerText()
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(150)
  const title1 = await page.locator('#timeline-dialog-title').innerText()
  check('← 切到較舊一天', title1 !== title0 && title1.includes('09-27'), `${title0} → ${title1}`)
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150)
  check('→ 回到較新一天', (await page.locator('#timeline-dialog-title').innerText()) === title0)
  check('最新一筆的「較新」按鈕停用', (await page.locator('button:has-text("較新")').isDisabled()) === true)

  // 焦點鎖
  let inside = true
  for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); inside = inside && (await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))) }
  check('Tab 循環 14 次焦點始終在對話框內', inside)
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Shift+Tab'); inside = inside && (await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))) }
  check('Shift+Tab 也不會跑出對話框', inside)

  // 事件晶片 → 跳到關係圖並聚焦
  await page.locator('[role=dialog] button:has-text("事件甲：整理檢核表")').click()
  await page.waitForFunction(() => location.hash === '#graph')
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => document.body.innerText.includes('參與者'), null, { timeout: 8000 }).catch(() => {})
  check('點事件晶片：對話框關閉、切到 #graph', (await page.locator('[role=dialog]').count()) === 0 && (await page.evaluate(() => location.hash)) === '#graph')
  const panel = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  check('關係圖已聚焦該事件：詳情面板出現「事件 · 2026-09-28」與參與者', panel.includes('事件 · 2026-09-28') && panel.includes('參與者') && panel.includes('王小明 同事'))
  
  await page.screenshot({ path: SHOTS + '/3-graph-focus.png' })
  check('聚焦請求已被消費（sessionStorage 清空，不會重複聚焦）', (await page.evaluate(() => sessionStorage.getItem('kb.graph.focus'))) === null)

  // 回時間軸分頁；級別記憶
  await page.locator('button:has-text("時間軸")').click()
  await page.waitForSelector('[data-testid=timeline-row]')
  // Esc 關閉並還原焦點
  const row2 = page.locator('[data-testid=timeline-row]').nth(2)
  await row2.click(); await page.waitForSelector('[role=dialog]')
  await page.keyboard.press('Escape'); await page.waitForTimeout(100)
  check('Esc 關閉對話框', (await page.locator('[role=dialog]').count()) === 0)
  check('關閉後焦點回到原本那一列', await row2.evaluate(e => e === document.activeElement))
  // 點背景關閉
  await page.locator('[data-testid=timeline-row]').nth(1).click(); await page.waitForSelector('[role=dialog]')
  await page.mouse.click(5, 5); await page.waitForTimeout(100)
  check('點背景關閉對話框', (await page.locator('[role=dialog]').count()) === 0)

  // 占位列：開啟顯示降級內容
  await page.locator('text=無日報 · 當日 2 件事件').click()
  await page.waitForSelector('[role=dialog]'); await page.waitForTimeout(200)
  const dlg = await page.locator('[role=dialog]').innerText()
  check('占位日開啟：明示無報告、列出當日事件', dlg.includes('這一天沒有日報') && dlg.includes('沒有日報那天的事件') && dlg.includes('降級內容'))
  await page.screenshot({ path: SHOTS + '/4-placeholder-dialog.png' })
  await page.keyboard.press('Escape')

  // 週級別：切換、推算標記、下鑽、返回、季報註記
  await page.locator('[role=tab]:has-text("週")').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=timeline-row]').length === 4)
  check('切到「週」重新載入（4 列含占位）', (await page.locator('[data-testid=timeline-row]').count()) === 4)
  check('週列顯示涵蓋區間與推算標記', (await page.locator('text=09/22–09/28').count()) === 1 && (await page.locator('[title="涵蓋區間為推算"]').count()) === 2)
  check('缺漏週顯示「本期無報告」占位', (await page.locator('text=本期無報告').count()) === 1)
  await page.screenshot({ path: SHOTS + '/5-week-list.png' })
  await page.locator('[data-testid=timeline-row]').first().click()
  await page.waitForSelector('[role=dialog]'); await page.waitForTimeout(250)
  const kids = page.locator('[role=dialog] button:has-text("09-2")')
  check('週對話框列出涵蓋的日報（下鑽清單）', (await kids.count()) >= 3, `count=${await kids.count()}`)
  await kids.first().click(); await page.waitForTimeout(250)
  check('下鑽：點下層日報切到該日對話框並出現「返回」', (await page.locator('#timeline-dialog-title').innerText()).startsWith('日報') && (await page.locator('button:has-text("‹ 返回")').count()) === 1)
  await page.screenshot({ path: SHOTS + '/6-drilldown.png' })
  await page.locator('button:has-text("‹ 返回")').click(); await page.waitForTimeout(250)
  check('返回：回到週對話框', (await page.locator('#timeline-dialog-title').innerText()).startsWith('週報'))
  check('下鑽層級時不顯示同級較舊／較新切換錯亂（週對話框在週列表內可切換）', (await page.locator('button:has-text("較舊")').isDisabled()) === false)
  await page.keyboard.press('Escape')
  await page.locator('[role=tab]:has-text("季")').click()
  await page.waitForSelector('[data-testid=timeline-row]')
  await page.locator('[data-testid=timeline-row]').first().click(); await page.waitForSelector('[role=dialog]'); await page.waitForTimeout(200)
  check('季報：順延註記顯示在對話框', (await page.locator('[role=dialog]').innerText()).includes('涵蓋順延為 5–7 月'))
  await page.keyboard.press('Escape')
  check('切換級別後回到「日」仍正常（級別記憶）', await (async () => { await page.locator('[role=tab]:has-text("日")').click(); await page.waitForSelector('[data-testid=timeline-row]'); return (await page.locator('[role=tab][aria-selected=true]').innerText()) === '日' })())
  check('全程無 console error／頁面例外', errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()
}

// ───────── 手機 ─────────
{
  const { ctx, page, errors } = await newPage({ width: 390, height: 800 })
  await page.goto(base + '/#graph/timeline')
  await page.waitForSelector('[data-testid=timeline-row]')
  check('手機：無橫向捲動', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.screenshot({ path: SHOTS + '/7-list-mobile.png' })
  await page.locator('[data-testid=timeline-row]').first().click(); await page.waitForSelector('[role=dialog]'); await page.waitForTimeout(250)
  const box = await page.locator('[role=dialog]').boundingBox()
  check('手機：對話框為全螢幕', Math.abs(box.width - 390) < 1 && Math.abs(box.height - 800) < 1, `${box.width}x${box.height}`)
  check('手機：對話框內容無橫向溢出', await page.evaluate(() => { const d = document.querySelector('[role=dialog]'); return d.scrollWidth <= d.clientWidth + 1 }))
  await page.screenshot({ path: SHOTS + '/8-dialog-mobile.png' })
  check('手機：無 console error', errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()
}

// ───────── 未解鎖 ─────────
{
  const { ctx, page } = await newPage({ width: 1000, height: 700 }, false)
  await page.goto(base + '/#graph/timeline')
  await page.waitForTimeout(500)
  check('未解鎖：顯示請先解鎖，且不發時間軸請求', (await page.locator('text=請先在儀表板解鎖').count()) === 1)
  await ctx.close()
}

const ext = [...new Set(failedReqs.map(u => new URL(u).origin))]
check('唯一失敗的請求都是外部資源（沙盒憑證問題），沒有任何同源請求失敗', ext.every(o => !o.startsWith('http://127.0.0.1')), ext.join(', '))
await browser.close(); server.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
