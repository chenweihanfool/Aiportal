// 全站「回到原頁」（3.27.0）真實瀏覽器驗證（手動執行；不在 CI 內，同 search-answer.e2e.mjs 的做法）。
//
// 做什麼：本機靜態伺服器提供 dist/public，Playwright 攔截 /api/*。驗證四件事：
//   a. 首頁捲到下方 → 點卷宗連結 → 左上「‹ 回到 首頁」→ 點它 → 回首頁且捲動位置差 < 50px
//   b. 全站搜尋輸入字 → 開知識題目（看整頁）→「‹ 回到 首頁」→ 搜尋框的字還在
//   c. 心得面板 #insight/<id> → 點題目 chip → 知識頁 →「‹ 回到 心得」→ 心得面板還開著同一則
//   d. 同 a，但改用瀏覽器上一頁（page.goBack）
// 資料全是虛構。
//
// 執行（需先 build）：
//   BASE_PATH=/ pnpm --filter @workspace/gis-portal run build
//   PLAYWRIGHT_MODULE_DIR=/path/to/node_modules CHROMIUM_PATH=/path/to/chrome node artifacts/gis-portal/e2e/back-nav.e2e.mjs
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

// ── 假資料 ──
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'topics-diagram.json'), 'utf8'))
const topicsFeed = () => ({ ...fixture, payload: { ...fixture.payload, computedAt: new Date().toISOString() } })
const INS_ID = 'I-01'
const insight = { id: INS_ID, date: '2026-11-20', time: '21:30', text: '虛構心得：事情要先講清楚再動手', provenance: 'quote', cluster: 'K01', thread: 'TH-a', relation: 'new', parent: null,
  links: { people: [], ideas: [], topics: [{ id: 'tflow', name: '送件補正流程' }] } }
const insightList = { total: 1, thisMonth: 1, clusters: [{ id: 'K01', name: '測量作業', count: 1 }], insights: [insight] }
const insightDetail = { ...insight, cluster: { id: 'K01', name: '測量作業' }, evidence: '（虛構日記原文）', source: '日記/2026-11-20.md', day: { headings: [] }, threadItems: [insight] }
const SEARCH = { '送件': [{ kind: 'topic', count: 1, items: [{ kind: 'topic', id: 'tflow', title: '送件補正流程', snippet: '示範流程', date: null }] }] }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, channel: process.env.CHROMIUM_PATH ? undefined : 'chrome', args: ['--no-sandbox'] })
async function open(url) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 420 } })
  await ctx.addInitScript((k) => localStorage.setItem('portal_unlocked', k), PWD)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 400)))
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url())
    const p = u.pathname
    const authed = route.request().headers()['x-admin-password'] === PWD
    const json = (o, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(o) })
    if (p === '/api/sites') return json([])
    if (p === '/api/dashboard') return json({ summaries: [], unlocked: authed })
    if (!authed) return json({ message: 'no' }, 403)
    if (p === '/api/feed/topics') return json(topicsFeed())
    if (p === '/api/insights') return json(insightList)
    if (p === `/api/insights/${INS_ID}`) return json(insightDetail)
    if (p === '/api/search') {
      const q = u.searchParams.get('q') ?? ''
      const groups = SEARCH[q] ?? []
      return json({ q, total: groups.reduce((n, g) => n + g.count, 0), tookMs: 1, groups, best: null, facets: { months: [] } })
    }
    if (p === '/api/search/preview') return json({ kind: 'topic', id: u.searchParams.get('id') ?? 'tflow', title: '送件補正流程', one: '示範用的一句話預覽', points: ['要點甲'], related: [], source: null })
    return json({ message: 'none' }, 404)
  })
  await page.goto(BASE + url)
  return { ctx, page, errors }
}
const scrollTop = (page) => page.evaluate(() => document.querySelector('.ip-scroll')?.scrollTop ?? -1)
// 用 DOM click 而不是 Playwright click：後者會先把元素捲進視窗，弄亂要比對的捲動位置
const clickLink = (page, selector) => page.evaluate((s) => document.querySelector(s)?.click(), selector)

/** 首頁捲到下方，回傳實際捲到的位置 */
async function scrollHome(page) {
  await page.waitForSelector('.ip-scroll')
  await page.waitForTimeout(800)
  await page.evaluate(() => { const e = document.querySelector('.ip-scroll'); e.scrollTop = Math.min(300, e.scrollHeight - e.clientHeight) })
  await page.waitForTimeout(200)
  return scrollTop(page)
}

try {
  // a. 首頁捲動 → 卷宗 → 回到 首頁
  let r = await open('/')
  const before = await scrollHome(r.page)
  check('a. 首頁真的捲動過（測試前提）', before > 50, `scrollTop=${before}`)
  await clickLink(r.page, 'a[href="#dossier"]')
  await r.page.waitForSelector('.dz-page')
  const back = r.page.getByTestId('back-origin')
  await back.waitFor({ timeout: 5000 })
  check('a. 卷宗頁左上出現「‹ 回到 首頁」', /回到\s*首頁/.test(await back.innerText()), await back.innerText())
  await back.click()
  await r.page.waitForSelector('.ip-scroll')
  await r.page.waitForTimeout(1500)
  const after = await scrollTop(r.page)
  check('a. 回首頁後捲動位置差 < 50px', Math.abs(after - before) < 50, `before=${before} after=${after}`)
  check('a. 沒有 pageerror', r.errors.length === 0, r.errors.join(' | '))

  // d. 同 a，改用瀏覽器上一頁
  await clickLink(r.page, 'a[href="#dossier"]')
  await r.page.waitForSelector('.dz-page')
  await r.page.goBack()
  await r.page.waitForSelector('.ip-scroll')
  await r.page.waitForTimeout(1500)
  const after2 = await scrollTop(r.page)
  check('d. 瀏覽器上一頁：捲動位置差 < 50px', Math.abs(after2 - before) < 50, `before=${before} after=${after2}`)
  await r.ctx.close()

  // b. 搜尋字還原
  r = await open('/')
  const input = r.page.getByRole('combobox').first()
  await input.click()
  await input.fill('送件')
  await r.page.waitForSelector('[role="option"]', { timeout: 15000 })
  await r.page.waitForSelector('a.om-ans-more', { timeout: 15000 })
  await clickLink(r.page, 'a.om-ans-more')
  await r.page.waitForSelector('.kn-root')
  const back2 = r.page.getByTestId('back-origin')
  await back2.waitFor({ timeout: 5000 })
  check('b. 知識頁出現「‹ 回到 首頁」', /回到\s*首頁/.test(await back2.innerText()))
  await back2.click()
  await r.page.getByRole('combobox').first().waitFor()
  await r.page.waitForTimeout(500)
  check('b. 回來後搜尋框的字還在', (await r.page.getByRole('combobox').first().inputValue()) === '送件')
  await r.ctx.close()

  // c. 心得面板 → 知識 → 回到 心得
  r = await open(`/#insight/${INS_ID}`)
  await r.page.waitForSelector('[data-testid="insight-panel"]', { timeout: 15000 })
  const txt = await r.page.getByTestId('insight-panel-text').innerText()
  await clickLink(r.page, 'a.it-chip')
  await r.page.waitForSelector('.kn-root')
  const back3 = r.page.getByTestId('back-origin')
  await back3.waitFor({ timeout: 5000 })
  check('c. 知識頁出現「‹ 回到 心得」', /回到\s*心得/.test(await back3.innerText()), await back3.innerText())
  await back3.click()
  await r.page.waitForSelector('[data-testid="insight-panel"]', { timeout: 15000 })
  check('c. 回來後心得面板還開著同一則', (await r.page.getByTestId('insight-panel-text').innerText()) === txt)
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
