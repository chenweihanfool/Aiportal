// 方法頁步驟卡（3.13.0）真實瀏覽器驗證（手動執行；不在 CI 內，同 insight.e2e.mjs 的做法）。
//
// 做什麼：本機靜態伺服器提供 dist/public，Playwright 攔截所有 /api/*，用 fixtures/topics-diagram.json 的題目，
// 替方法頁 tflow 加上假的 steps／business，驗證：
// 有 steps 的方法頁出現步驟卡與 ⬇ 範本 chip、business 為 null 的頁不顯示 📄、沒有 steps 的方法頁（ttime）沒有步驟卡也沒有現場模式按鈕、
// 按「✕」會 POST unlink 更正並顯示「已記下」、375 寬沒有橫向捲動。
// 3.23.0 起進島是泳道圖索引畫面：預設選第一個有步驟卡的格子、一次只顯示被選中格子的那張步驟卡，點別的格子才換；判斷點格子用分岔卡。
// 全程不碰真實服務，資料全是虛構。
//
// 執行（需先 build）：
//   BASE_PATH=/ pnpm --filter @workspace/gis-portal run build
//   PLAYWRIGHT_MODULE_DIR=/path/to/node_modules CHROMIUM_PATH=/path/to/chrome node artifacts/gis-portal/e2e/knowledge-steps.e2e.mjs
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
const STEPS = [
  {
    id: 's1', title: '確認退費依據', claim: 'c010', node: 'a',
    docs: [{ templateId: 'tpl_ab12cd34ef', family: '鑑界退費', docType: '函', role: '公文', score: 0.9, others: 2, evidence: ['1150101測試段12再鑑界'] }],
    why: {
      rules: [{ text: '繳費後未辦理應退費', article: '第221條', claim: 'c010', src: 1 }],
      insights: [{ insightId: 'INS-2026-11-19-0a1b2c3d', quote: '先查繳費紀錄再回覆', date: '2026-11-19' }],
      pitfalls: [],
    },
    cases: [{ case: '示範案甲', date: '2026-05-12' }],
  },
  { id: 's2', title: '寄出通知', claim: 'c011', node: 'b', docs: [], why: { rules: [], insights: [], pitfalls: [{ text: '只寄申請書沒附收據', claim: 'c011', case: null }] }, cases: [] },
]
const topicsFor = (business) => ({
  ...fixture,
  payload: {
    ...fixture.payload,
    computedAt: new Date().toISOString(),
    topics: fixture.payload.topics.map((t) => (t.id === 'tflow' ? { ...t, business, steps: STEPS } : t)),
  },
})

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, channel: process.env.CHROMIUM_PATH ? undefined : 'chrome', args: ['--no-sandbox'] })
async function open(viewport, hash, business) {
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript((k) => localStorage.setItem('portal_unlocked', k), PWD)
  const page = await ctx.newPage()
  const errors = []
  const posts = []
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 600)))
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url())
    const p = u.pathname
    const authed = route.request().headers()['x-admin-password'] === PWD
    const json = (o, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(o) })
    if (p === '/api/sites') return json({ sites: [] })
    if (p === '/api/dashboard') return json({ summaries: [], unlocked: authed })
    if (!authed) return json({ message: 'no' }, 403)
    if (p === '/api/feed/topics') return json(topicsFor(business))
    if (p === '/api/knowledge/corrections' && route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON())
      return json({ id: 1, ...route.request().postDataJSON(), section: null, createdAt: new Date().toISOString() }, 201)
    }
    return json({ message: 'none' }, 404)
  })
  await page.goto(`${BASE}/#${hash}`)
  return { ctx, page, errors, posts }
}

try {
  // 1. 有 steps、有 business：步驟卡、範本 chip、沒有現場模式按鈕
  let r = await open({ width: 1280, height: 900 }, 'knowledge/tflow', '鑑界')
  await r.page.waitForSelector('.kn-stepcard', { timeout: 15000 })
  check('進島是索引畫面：有常駐的泳道圖，沒有舊的橫軸與「完整頁面」按鈕', (await r.page.locator('[data-testid="kis-index"] .kn-dg-svg').count()) === 1 && (await r.page.locator('.kis-rail').count()) === 0 && (await r.page.getByText('完整頁面').count()) === 0)
  check('預設選第一個有步驟卡的格子，只顯示那一張步驟卡', (await r.page.locator('.kn-stepcard').count()) === 1 && /確認退費依據/.test(await r.page.locator('.kn-stepcard').first().innerText()))
  check('右側有「這一格的旁註」', (await r.page.locator('[data-testid="kis-side"]').count()) === 1)
  const chipText = await r.page.locator('.kn-sc-docbtn').first().innerText()
  check('範本 chip 有 ⬇ 與家族名', /鑑界退費/.test(chipText) && /⬇/.test(chipText))
  check('舊版數顯示「＋2 版」', /＋2 版/.test(await r.page.locator('.kn-sc-others').first().innerText()))
  check('沒有現場模式按鈕', (await r.page.getByText('現場模式').count()) === 0)
  check('步驟卡沒有勾選框', (await r.page.locator('.kn-stepcards input[type="checkbox"]').count()) === 0)
  // 按規定依據的「✕」：POST unlink 並顯示「已記下」
  await r.page.locator('.kn-stepcard').first().locator('.kn-sc-link').first().locator('.kn-sc-x').click()
  await r.page.waitForSelector('.kn-sc-ok', { timeout: 5000 })
  check('按 ✕ 送出 unlink 更正（含 claimId 與 text）', r.posts.length === 1 && r.posts[0].kind === 'unlink' && r.posts[0].claimId === 'c010' && r.posts[0].text === 'rule:c010', JSON.stringify(r.posts[0] ?? null))
  check('送出後顯示「已記下」', (await r.page.locator('.kn-sc-ok').count()) >= 1)
  // 點別的格子：換成那一格的步驟卡，網址同步成 /s/<格子>
  await r.page.locator('.kn-dg-node[aria-label^="收件登記"]').click()
  await r.page.waitForFunction(() => /寄出通知/.test(document.querySelector('.kn-stepcard')?.textContent ?? ''), null, { timeout: 5000 })
  check('點「收件登記」格子換成第二張步驟卡，網址同步', (await r.page.locator('.kn-stepcard').count()) === 1 && /\/s\/b$/.test(await r.page.evaluate(() => location.hash)), await r.page.evaluate(() => location.hash))
  check('沒有範本的步驟顯示灰字「還不知道」', /還不知道/.test(await r.page.locator('.kn-stepcard').first().locator('[aria-label="要用的文件"]').innerText()))
  // 判斷點格子：分岔卡
  await r.page.locator('.kn-dg-node[aria-label^="附件齊全"]').click()
  await r.page.waitForSelector('.kfk, .kn-dg-detail', { timeout: 5000 })
  check('點判斷點格子顯示分岔卡（沒有分支時退回格子說明）', (await r.page.locator('.kfk').count()) + (await r.page.locator('.kn-dg-detail').count()) >= 1)
  // 3.26.1：圖只看寬度、塞滿整欄；拿掉步驟列，上一格／下一格與「↑ 回到圖」在主畫面標題列
  check('沒有黏頂步驟列 .kis-strip', (await r.page.locator('.kis-strip').count()) === 0)
  const fit = await r.page.evaluate(() => {
    const svg = document.querySelector('[data-testid="kis-index"] svg.kn-dg-svg')
    const sc = document.querySelector('[data-testid="kis-index"] .kn-dg-scroll')
    return svg && sc ? { svgW: svg.getBoundingClientRect().width, boxW: sc.clientWidth } : null
  })
  check('1280 寬時圖塞滿整欄（svg 寬與索引橫捲框 clientWidth 差 ≤ 4px）', !!fit && Math.abs(fit.svgW - fit.boxW) <= 4, JSON.stringify(fit))
  check('主畫面標題列有上一格／下一格與「↑ 回到圖」', (await r.page.locator('.kis-ch').getByRole('button', { name: /上一格/ }).count()) === 1 && (await r.page.locator('.kis-ch').getByRole('button', { name: /下一格/ }).count()) === 1 && (await r.page.locator('.kis-ch').getByRole('button', { name: /回到圖/ }).count()) === 1)
  // 往下捲 800px，點「↑ 回到圖」後圖的頂端回到視窗內
  await r.page.evaluate(() => { const sc = document.querySelector('.kn-root'); if (sc) sc.scrollBy(0, 800) })
  await r.page.waitForTimeout(150)
  const idxAway = await r.page.evaluate(() => {
    const i = document.querySelector('[data-testid="kis-index"]')
    if (!i) return null
    const t = i.getBoundingClientRect().top
    return { top: Math.round(t), inView: t >= 0 && t < window.innerHeight }
  })
  await r.page.locator('.kis-ch').getByRole('button', { name: /回到圖/ }).click()
  let idxBack = false
  try {
    await r.page.waitForFunction(() => {
      const i = document.querySelector('[data-testid="kis-index"]')
      if (!i) return false
      const t = i.getBoundingClientRect().top
      return t >= 0 && t < window.innerHeight
    }, null, { timeout: 5000 })
    idxBack = true
  } catch { idxBack = false }
  check('往下捲後點「↑ 回到圖」，圖的頂端回到視窗內', idxBack, `捲前=${JSON.stringify(idxAway)}`)
  check('沒有 pageerror', r.errors.length === 0, r.errors.join(' | '))
  await r.ctx.close()

  // 2. business 為 null：整頁不顯示 📄 列
  r = await open({ width: 1280, height: 900 }, 'knowledge/tflow', null)
  await r.page.waitForSelector('.kn-stepcard', { timeout: 15000 })
  check('business 為 null：不顯示「要用的文件」', (await r.page.locator('.kn-stepcard [aria-label="要用的文件"]').count()) === 0)
  await r.ctx.close()

  // 3. 沒有 steps 的方法頁（ttime）：沒有步驟卡、沒有現場模式按鈕
  r = await open({ width: 1280, height: 900 }, 'knowledge/ttime', '鑑界')
  await r.page.waitForSelector('.kis-title', { timeout: 15000 })
  check('沒有 steps 的方法頁沒有步驟卡', (await r.page.locator('.kn-stepcard').count()) === 0)
  check('沒有 steps 的方法頁沒有現場模式按鈕', (await r.page.getByText('現場模式').count()) === 0)
  await r.ctx.close()

  // 4. 375 寬：無橫向捲動
  r = await open({ width: 375, height: 812 }, 'knowledge/tflow', '鑑界')
  await r.page.waitForSelector('.kn-stepcard', { timeout: 15000 })
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
