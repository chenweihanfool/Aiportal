// 搜尋直達答案（3.14.0）真實瀏覽器驗證（手動執行；不在 CI 內，同 knowledge-steps.e2e.mjs 的做法）。
//
// 做什麼：本機靜態伺服器提供 dist/public，Playwright 攔截所有 /api/*（/api/search、/api/search/preview、/api/feed/topics、/api/templates/*），
// 驗證：搜到範本 → 閱讀面板有「⬇ 下載」、方法路線（目前這步高亮且標「你在這」）、法條、案件；點另一站 → 該站文件出現；
// 搜到有 steps 的題目 → 預覽後出現路線；找不到方法的範本 → 顯示「還沒連到方法頁」；375 寬無橫向捲動。
// 資料全是虛構（假家族名、假案件名、假段名），不碰真實服務。
//
// 執行（需先 build）：
//   BASE_PATH=/ pnpm --filter @workspace/gis-portal run build
//   PLAYWRIGHT_MODULE_DIR=/path/to/node_modules CHROMIUM_PATH=/path/to/chrome node artifacts/gis-portal/e2e/search-answer.e2e.mjs
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const req = createRequire((process.env.PLAYWRIGHT_MODULE_DIR || '/opt/node22/lib/node_modules') + '/')
let pw
try { pw = req('playwright-core') } catch { pw = req('playwright') }
const { chromium } = pw

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(HERE, '../dist/public')
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
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'topics-diagram.json'), 'utf8'))
const TPL_MAIN = 'tpl_ab12cd34ef'
const TPL_OTHER = 'tpl_1122334455'
const TPL_ORPHAN = 'tpl_ffeeddccbb'
const mkDoc = (templateId, family) => ({ templateId, family, docType: '函', role: '公文', score: 0.9, others: 0, evidence: ['1150101測試段12再鑑界'] })
const STEPS = [
  {
    id: 's1', title: '確認退費依據', claim: 'c010', node: 'a',
    docs: [mkDoc(TPL_MAIN, '鑑界退費')],
    why: {
      rules: [{ text: '繳費後未辦理應退費', article: '第221條', claim: 'c010', src: 1 }],
      insights: [{ insightId: 'INS-2026-11-19-0a1b2c3d', quote: '先查繳費紀錄再回覆', date: '2026-11-19' }],
      pitfalls: [{ text: '漏看收據日期', claim: 'c012', case: null }],
    },
    cases: [{ case: '示範案甲', date: '2026-05-12' }],
  },
  { id: 's2', title: '寄出通知', claim: 'c011', node: null, docs: [mkDoc(TPL_OTHER, '通知函示範')], why: { rules: [], insights: [], pitfalls: [] }, cases: [] },
  { id: 's3', title: '結案歸檔', claim: 'c013', node: null, docs: [], why: { rules: [], insights: [], pitfalls: [] }, cases: [] },
]
const topicsFeed = () => ({
  ...fixture,
  payload: {
    ...fixture.payload,
    computedAt: new Date().toISOString(),
    topics: fixture.payload.topics.map((t) => (t.id === 'tflow' ? { ...t, business: '鑑界', steps: STEPS } : t)),
  },
})
const tplHit = (templateId, family) => ({
  kind: 'template', id: templateId, title: family, snippet: '', date: null,
  meta: { templateId, family, category: '鑑界', docType: '函', olderVersions: 0, score: 0.9 },
})
const SEARCH = {
  '鑑界': [{ kind: 'template', count: 1, items: [tplHit(TPL_MAIN, '鑑界退費')] }],
  '孤兒': [{ kind: 'template', count: 1, items: [tplHit(TPL_ORPHAN, '孤兒範本示範')] }],
  '送件': [{ kind: 'topic', count: 1, items: [{ kind: 'topic', id: 'tflow', title: '送件補正流程', snippet: '示範流程', date: null }] }],
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, channel: process.env.CHROMIUM_PATH ? undefined : 'chrome', args: ['--no-sandbox'] })
async function open(viewport) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true })
  await ctx.addInitScript((k) => localStorage.setItem('portal_unlocked', k), PWD)
  const page = await ctx.newPage()
  const errors = []
  const downloads = []
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 600)))
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url())
    const p = u.pathname
    const authed = route.request().headers()['x-admin-password'] === PWD
    const json = (o, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(o) })
    if (p === '/api/sites') return json({ sites: [] })
    if (p === '/api/dashboard') return json({ summaries: [], unlocked: authed })
    if (!authed) return json({ message: 'no' }, 403)
    if (p === '/api/feed/topics') return json(topicsFeed())
    if (p === '/api/search') {
      const q = u.searchParams.get('q') ?? ''
      const groups = SEARCH[q] ?? []
      const total = groups.reduce((n, g) => n + g.count, 0)
      return json({ q, total, tookMs: 1, groups, best: null, facets: { months: [] } })
    }
    if (p === '/api/search/preview') {
      return json({ kind: 'topic', id: u.searchParams.get('id') ?? 'tflow', title: '送件補正流程', one: '示範用的一句話預覽', points: ['要點甲'], related: [], source: null })
    }
    if (p.startsWith('/api/templates/') && p.endsWith('/file')) {
      downloads.push(p)
      return route.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'content-disposition': 'attachment; filename="demo.docx"' }, body: 'demo' })
    }
    return json({ message: 'none' }, 404)
  })
  await page.goto(`${BASE}/`)
  return { ctx, page, errors, downloads }
}
async function search(page, q) {
  const input = page.getByRole('combobox').first()
  await input.click()
  await input.fill(q)
  await page.waitForSelector('[role="option"]', { timeout: 15000 })
}

try {
  // 1. 範本命中：下載鈕、路線、你在這、法條、案件
  let r = await open({ width: 1280, height: 900 })
  await search(r.page, '鑑界')
  await r.page.waitForSelector('[data-testid="om-ans-template"]', { timeout: 15000 })
  const dl = r.page.getByTestId('om-ans-download')
  check('範本命中：面板有「⬇ 下載」', /⬇ 下載/.test(await dl.innerText()))
  check('範本命中：沒有「載入預覽中…」', (await r.page.getByText('載入預覽中…').count()) === 0)
  await r.page.waitForSelector('[data-testid="om-ans-station"]', { timeout: 15000 })
  check('路線有 3 站', (await r.page.getByTestId('om-ans-station').count()) === 3)
  const cur = r.page.locator('[data-testid="om-ans-station"][data-current="true"]')
  check('目前這站高亮且標「你在這」', (await cur.count()) === 1 && /你在這/.test(await cur.innerText()) && /確認退費依據/.test(await cur.innerText()))
  check('顯示法條', /第221條/.test(await r.page.getByTestId('om-ans-why').innerText()))
  check('顯示用過的案件', /示範案甲/.test(await r.page.getByTestId('om-ans-case').first().innerText()))
  check('範本命中：清單卡片上既有的 ⬇ 仍在', (await r.page.locator('[role="option"]').first().getByText('⬇').count()) >= 1)
  await dl.click()
  await r.page.waitForTimeout(300)
  check('按「⬇ 下載」會打範本檔案端點', r.downloads.some((d) => d.includes(TPL_MAIN)), JSON.stringify(r.downloads))
  // 點另一站
  await r.page.getByTestId('om-ans-station').nth(1).click()
  check('點另一站：該站文件出現', /通知函示範/.test(await r.page.getByTestId('om-ans-doc').first().innerText()))
  check('點另一站：「你在這」移到該站', /寄出通知/.test(await r.page.locator('[data-testid="om-ans-station"][data-current="true"]').innerText()))
  check('沒有 pageerror', r.errors.length === 0, r.errors.join(' | '))
  await r.ctx.close()

  // 2. 題目命中：預覽後出現路線，全部不高亮
  r = await open({ width: 1280, height: 900 })
  await search(r.page, '送件')
  await r.page.waitForSelector('[data-testid="om-ans-topic"]', { timeout: 15000 })
  check('題目命中：預覽內容仍在', (await r.page.getByText('示範用的一句話預覽').count()) >= 1)
  check('題目命中：出現路線 3 站', (await r.page.getByTestId('om-ans-station').count()) === 3)
  check('題目命中：沒有任何一站高亮', (await r.page.locator('[data-testid="om-ans-station"][data-current="true"]').count()) === 0)
  await r.page.getByTestId('om-ans-station').first().click()
  check('題目命中：點站展開該步', (await r.page.getByTestId('om-ans-step').count()) === 1)
  await r.ctx.close()

  // 3. 找不到方法的範本
  r = await open({ width: 1280, height: 900 })
  await search(r.page, '孤兒')
  await r.page.waitForSelector('[data-testid="om-ans-template"]', { timeout: 15000 })
  await r.page.getByText('這份範本還沒連到方法頁').waitFor({ timeout: 15000 })
  check('找不到方法：顯示「還沒連到方法頁」且仍有下載鈕', (await r.page.getByTestId('om-ans-download').count()) === 1)
  await r.ctx.close()

  // 4. 375 寬：無橫向捲動
  r = await open({ width: 375, height: 812 })
  await search(r.page, '鑑界')
  await r.page.waitForSelector('[data-testid="om-ans-station"]', { timeout: 15000 })
  const sw = await r.page.evaluate(() => document.documentElement.scrollWidth)
  check('375 寬：document.documentElement.scrollWidth <= 375', sw <= 375, `scrollWidth=${sw}`)
  await r.ctx.close()
} catch (e) {
  check('e2e 執行過程沒有例外', false, String(e.stack || e).slice(0, 800))
} finally {
  await browser.close()
  server.close()
}
const failed = results.filter((x) => !x.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通過`)
process.exit(failed.length === 0 ? 0 : 1)
