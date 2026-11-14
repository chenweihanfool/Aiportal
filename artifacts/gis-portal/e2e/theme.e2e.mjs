// 主題（2.89.0：深／淺／跟系統）真實瀏覽器驗證（手動執行；不在 CI 內，同 home.e2e.mjs 的做法）。
//
// 做什麼：本機靜態伺服器提供 dist/public，Playwright 攔截所有 /api/*（只回最小假資料，沒給的端點回 404，各頁顯示自己的空／錯誤狀態），
// 驗證：深色（系統深色、沒設主題）、淺色（系統淺色＋hm-theme=system）、強制 dark 在系統淺色下仍為深色、強制 light 在系統深色下為淺色；
// 頂欄的三段切換（data-testid="theme-toggle"）會寫 localStorage hm-theme、設／移除 <html data-theme>；「舊版首頁」開關在頂欄同一排；
// 每頁（首頁、舊版首頁、知識、卷宗、時間軸、美食地圖、遊記、面向頁、架構）× 深／淺各截一張圖到 E2E_SHOTS_DIR，
// 並檢查：<html> 計算後的 --c-bg 正確、頁面沒有橫向捲動、沒有 pageerror、沒有「看不見的字」（文字色與有效底色的對比 < 1.5:1）。
//
// 執行：
//   BASE_PATH=/ PORT=5174 pnpm --filter @workspace/gis-portal run build
//   PLAYWRIGHT_MODULE_DIR=/path/to/node_modules CHROMIUM_PATH=/path/to/chrome node artifacts/gis-portal/e2e/theme.e2e.mjs
// 截圖輸出到 E2E_SHOTS_DIR（預設 /tmp/theme-e2e-shots）。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const req = createRequire((process.env.PLAYWRIGHT_MODULE_DIR || '/opt/node22/lib/node_modules') + '/')
let chromium
try { ({ chromium } = req('playwright')) } catch { ({ chromium } = req('playwright-core')) }

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/public')
const SHOTS = process.env.E2E_SHOTS_DIR || '/tmp/theme-e2e-shots'
fs.mkdirSync(SHOTS, { recursive: true })
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
const server = http.createServer((q, res) => {
  const u = new URL(q.url, 'http://x')
  let p = path.join(DIST, u.pathname === '/' ? 'index.html' : u.pathname)
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html')
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}`
const PWD = 'tok-test'
const results = []
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`) }

const DARK_BG = '#080b0e'
const LIGHT_BG = '#f4f7f8'
const iso = (agoMs = 0) => new Date(Date.now() - agoMs).toISOString()
const site = (id, name, subsystemId) => ({ id, name, subtitle: '', links: [{ label: name, url: 'https://example.com' }], worldXZ: [0, 0], isPrivate: true, subsystemId })
const sites = [site('s1', '人生進度管理系統', 'pf-cwh'), site('s2', '健身追蹤', 'fitnessforge'), site('s3', '任務追蹤系統', 'vikunja'), site('s4', '旅遊生活', 'travel')]
const hhi = {
  subsystemId: 'hhi', name: '幸福指數', isPrivate: true, status: 'ok', errorMessage: null, fetchedAt: iso(60e3),
  data: { displayedScore: 71, baseScore: 74.5, weakestScore: 55, finalScore: 72, weakestComponent: '旅遊生活', isSnapshotFinal: true, usingStaleData: false,
    lifeFreedomScore: 68, fitnessHabitScore: 81, calmScore: 74, mindScore: 79, socialScore: 77, travelScore: 55,
    mindCombined: { score: 72, ideas: 68, report: { date: new Date().toISOString().slice(0, 10), total: 80, parts: [{ label: '推進', value: 3, note: '' }] } },
    weights: { lifeFreedomWeight: 0.27, fitnessWeight: 0.18, calmWeight: 0.15, mindWeight: 0.15, socialWeight: 0.13, travelWeight: 0.12 } },
}
const history = { history: Array.from({ length: 120 }, (_, i) => { const d = new Date(Date.now() - (119 - i) * 86400e3).toISOString().slice(0, 10); return { date: d, score: 55 + ((i * 7) % 35), components: { lifeFreedom: 60 + (i % 20), fitness: 70, calm: 65, mind: 75, social: 70, travel: 50 } } }) }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
async function open({ scheme = 'dark', theme = null, viewport = { width: 1440, height: 900 }, hash = '' } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme })
  await ctx.addInitScript(([k, t]) => { localStorage.setItem('portal_unlocked', k); localStorage.setItem('hm-layout', 'v3'); if (t) localStorage.setItem('hm-theme', t) }, [PWD, theme])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 400)))
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname
    const authed = route.request().headers()['x-admin-password'] === PWD
    const json = (o, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(o) })
    if (p === '/api/sites') return json({ sites: authed ? sites : [] })
    if (p === '/api/dashboard') return json({ summaries: [hhi], unlocked: authed })
    if (p === '/api/auth/me') return json({ message: 'none' }, 404)
    if (p === '/api/happiness/history') return json(history)
    return json({ message: 'none' }, 404)
  })
  await page.goto(BASE + '/' + hash)
  if (hash === '' || hash === '#legacy') await page.waitForSelector('header.tb', { timeout: 15000 })
  else await page.waitForSelector('#root > *', { timeout: 15000 })
  await page.waitForTimeout(900)
  return { ctx, page, errors }
}
const token = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const attr = (page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'))

// 文字對有效底色的對比：沿祖先找第一個不透明度 > 0.5 的背景（找不到用 body／白），回傳對比 < limit 的可見文字元素
async function lowContrast(page, limit) {
  return page.evaluate((lim) => {
    const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a } }
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
    const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
    const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c } return { r: 255, g: 255, b: 255, a: 1 } }
    const out = []
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim()) continue
      const el = n.parentElement
      if (!el || el.closest('canvas, svg, script, style, .maplibregl-map')) continue
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      if (cs.visibility === 'hidden' || cs.display === 'none' || r.width < 2 || r.height < 2 || +cs.opacity === 0) continue
      const fg = parse(cs.color); if (!fg) continue
      const cr = ratio(fg, bgOf(el))
      if (cr < lim) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 24)} "${n.textContent.trim().slice(0, 16)}" ${cr.toFixed(2)}`)
    }
    return out.slice(0, 8)
  }, limit)
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('.ip-scroll, .kn-root')].every((e) => e.scrollWidth <= e.clientWidth + 1))

// ═══ 1. 四種組合的 token 與 data-theme ═══
{
  const cases = [
    ['系統深色、沒設主題（預設跟系統）→ 深色、沒有 data-theme', { scheme: 'dark' }, DARK_BG, null],
    ['系統淺色、hm-theme=system → 淺色、沒有 data-theme', { scheme: 'light', theme: 'system' }, LIGHT_BG, null],
    ['系統淺色、沒設主題 → 淺色', { scheme: 'light' }, LIGHT_BG, null],
    ['系統淺色、強制 dark → 仍為深色（data-theme=dark）', { scheme: 'light', theme: 'dark' }, DARK_BG, 'dark'],
    ['系統深色、強制 light → 淺色（data-theme=light）', { scheme: 'dark', theme: 'light' }, LIGHT_BG, 'light'],
  ]
  for (const [name, opt, bg, dt] of cases) {
    const { ctx, page, errors } = await open(opt)
    check(`${name}（--c-bg=${await token(page, '--c-bg')}）`, (await token(page, '--c-bg')) === bg && (await attr(page)) === dt)
    check(`  └ 沒有 pageerror`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
}

// ═══ 2. 頂欄：版面開關與三段切換在同一排 ═══
{
  const { ctx, page } = await open({ scheme: 'dark' })
  const geo = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom } }
    return { head: r('header.tb'), layout: r('header.tb [data-testid="hm-layout-toggle"]'), theme: r('header.tb [data-testid="theme-toggle"]'), bar: document.querySelectorAll('.st-layoutbar').length }
  })
  check('頂欄內有「舊版首頁」開關與主題切換，且沒有 .st-layoutbar 細列', !!geo.layout && !!geo.theme && geo.bar === 0, JSON.stringify(geo))
  check('兩個開關都在頂欄的範圍內（同一排）', geo.layout.top >= geo.head.top - 1 && geo.layout.bottom <= geo.head.bottom + 1 && geo.theme.top >= geo.head.top - 1 && geo.theme.bottom <= geo.head.bottom + 1)
  const btns = await page.locator('[data-testid="theme-toggle"] button').allInnerTexts()
  check('三段：深／淺／跟系統，預設「跟系統」為按下', btns.join('/') === '深/淺/跟系統' && (await page.locator('[data-testid="theme-toggle"] [data-mode="system"]').getAttribute('aria-pressed')) === 'true', btns.join('/'))
  check('「舊版首頁」開關保留 title（含 2027-01-31）與 aria-pressed', /2027-01-31/.test((await page.locator('[data-testid="hm-layout-toggle"]').getAttribute('title')) ?? '') && (await page.locator('[data-testid="hm-layout-toggle"]').getAttribute('aria-pressed')) === 'false')
  await page.locator('[data-testid="theme-toggle"] [data-mode="light"]').click()
  check('按「淺」→ data-theme=light、--c-bg 淺色、localStorage hm-theme=light', (await attr(page)) === 'light' && (await token(page, '--c-bg')) === LIGHT_BG && (await page.evaluate(() => localStorage.getItem('hm-theme'))) === 'light')
  await page.reload(); await page.waitForSelector('header.tb')
  check('重新整理後仍是淺色、「淺」為按下', (await attr(page)) === 'light' && (await page.locator('[data-testid="theme-toggle"] [data-mode="light"]').getAttribute('aria-pressed')) === 'true')
  await page.locator('[data-testid="theme-toggle"] [data-mode="dark"]').click()
  check('按「深」→ data-theme=dark、深色', (await attr(page)) === 'dark' && (await token(page, '--c-bg')) === DARK_BG)
  await page.locator('[data-testid="theme-toggle"] [data-mode="system"]').click()
  check('按「跟系統」→ 移除 data-theme、hm-theme=system', (await attr(page)) === null && (await page.evaluate(() => localStorage.getItem('hm-theme'))) === 'system')
  // 手機：開關仍可點、頂欄不撐出橫向捲動
  await page.setViewportSize({ width: 390, height: 800 }); await page.waitForTimeout(300)
  const box = await page.locator('[data-testid="hm-layout-toggle"]').boundingBox()
  check('手機 390：舊版首頁開關仍在畫面內、可點', !!box && box.width >= 24 && box.x >= 0 && box.x + box.width <= 390)
  await page.locator('[data-testid="hm-layout-toggle"]').click(); await page.waitForTimeout(400)
  check('手機：點開關切到舊版首頁（aria-pressed=true）', (await page.locator('[data-testid="hm-layout-toggle"]').getAttribute('aria-pressed')) === 'true')
  check('手機：沒有橫向捲動', await noHScroll(page))
  await ctx.close()
}

// ═══ 3. 每頁 × 深／淺：截圖、橫向捲動、看不見的字 ═══
const PAGES = [
  ['home', ''], ['legacy', '#legacy'], ['knowledge', '#knowledge'], ['dossier', '#dossier'],
  ['timeline', '#graph/timeline'], ['food', '#food'], ['trips', '#trips'], ['dim', '#dim/lifeFreedom'], ['architecture', '#architecture'],
]
for (const [scheme, tag] of [['dark', 'dark'], ['light', 'light']]) {
  for (const [name, hash] of PAGES) {
    const { ctx, page, errors } = await open({ scheme, theme: scheme, hash })
    await page.waitForTimeout(500)
    const file = path.join(SHOTS, `${name}-${tag}.png`)
    await page.screenshot({ path: file })
    const T = `${name}（${tag}）`
    check(`${T}：沒有橫向捲動`, await noHScroll(page))
    check(`${T}：沒有 pageerror`, errors.length === 0, errors.join(' | '))
    const bad = await lowContrast(page, 1.5)
    check(`${T}：沒有看不見的字（對比 < 1.5:1）`, bad.length === 0, bad.join(' ; '))
    const soft = await lowContrast(page, 3)
    if (soft.length) console.log(`  info ${T}：對比 < 3:1 的文字 ${soft.length}+ 個，例：${soft.slice(0, 3).join(' ; ')}`)
    await ctx.close()
  }
}
// 首頁完整截圖（桌機 1440×900，深／淺）
for (const tag of ['dark', 'light']) {
  const { ctx, page } = await open({ scheme: tag, theme: tag })
  await page.screenshot({ path: path.join(SHOTS, `home-full-${tag}.png`), fullPage: false })
  await ctx.close()
}

await browser.close(); server.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS`)
if (failed.length) { console.log('FAILED:\n' + failed.map((f) => ' - ' + f.name).join('\n')); process.exit(1) }
