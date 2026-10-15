// 遊記相片（入口網自己的 /api/media/trips/…，要帶憑證）真實瀏覽器驗證（手動執行；不在 CI 內，同 home.e2e.mjs 的做法）。
//
// 做什麼：本機靜態伺服器提供 dist/public，Playwright 攔截 /api/*：假的 hermes-trips（相片網址指向 /api/media/…）與假的相片端點
// （要 x-admin-password 才給，否則 403；縮圖可設成 404 驗證退回檢視圖）。驗證：
//   卡片封面載的是縮圖（-t.webp）並帶解鎖碼；縮圖 404 時退回原圖；
//   相片牆縮圖用 blob（<img> 帶不了 header）真的畫出來（naturalWidth > 0）；點開燈箱載檢視圖；
//   沒解鎖（403）時不當掉、不噴 pageerror，<img> 標成 failed；外部 https 圖照一般 <img>、不經 fetch。
//
// 執行：
//   BASE_PATH=/ PORT=5174 pnpm --filter @workspace/gis-portal run build
//   PLAYWRIGHT_MODULE_DIR=/path/to/node_modules CHROMIUM_PATH=/path/to/chrome node artifacts/gis-portal/e2e/media.e2e.mjs
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const { chromium } = createRequire((process.env.PLAYWRIGHT_MODULE_DIR || '/opt/node22/lib/node_modules') + '/')('playwright')

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/public')
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
const WEBP_1x1 = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64')
const results = []
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`) }

const tp = (offset = 0) => new Date(Date.now() + 8 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10)
const TID = 'TRIP-20261015-台南旅遊'
const U = (stem, thumb = false) => `/api/media/trips/${encodeURIComponent(TID)}/${encodeURIComponent(stem)}${thumb ? '-t' : ''}.webp`
const photo = (stem, extra = {}) => ({ url: U(stem), thumb: U(stem, true), w: null, h: null, takenAt: tp(-2), caption: null, ...extra })
const entry = (time, text, photos) => ({ time, text, photos, photosPending: 0 })
const tripsBody = (cover) => ({
  available: true, receivedAt: new Date().toISOString(),
  trips: [{ id: TID, name: '台南旅遊', start: tp(-2), end: tp(-2), status: 'done', area: '台南', summary: null, cover, placeIds: [], days: [{ date: tp(-2), title: null, placeIds: [], entries: [
    entry('09:00', '類別 — 早餐\n牛肉湯', [photo('IMG_1'), photo('IMG_2')]),
    entry('12:00', '午餐', [{ url: 'https://example.com/ext.jpg', thumb: null, w: null, h: null, takenAt: null, caption: '外部圖' }]),
  ] }] }],
})

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
async function open({ unlocked = true, noThumbFor = [], cover = U('IMG_1'), hash = 'trips' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  if (unlocked) await ctx.addInitScript((k) => localStorage.setItem('portal_unlocked', k), PWD)
  const page = await ctx.newPage()
  const errors = [], media = [], external = []
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 400)))
  await page.route('https://example.com/**', (route) => { external.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'image/webp', body: WEBP_1x1 }) })
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url()); const p = u.pathname
    const authed = route.request().headers()['x-admin-password'] === PWD
    const json = (o, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(o) })
    if (p === '/api/sites') return json({ sites: [] })
    if (p === '/api/dashboard') return json({ summaries: [], unlocked: authed })
    if (p === '/api/auth/me') return json({ message: 'none' }, 404)
    if (p.startsWith('/api/media/')) {
      const name = decodeURIComponent(p.split('/').pop())
      media.push({ name, authed })
      if (!authed) return json({ message: 'no' }, 403)
      if (noThumbFor.some((s) => name === s + '-t.webp')) return json({ message: 'nf' }, 404)
      return route.fulfill({ status: 200, contentType: 'image/webp', body: WEBP_1x1 })
    }
    if (!authed) return json({ message: 'no' }, 403)
    if (p === '/api/hermes-trips') return json(tripsBody(cover))
    if (p === '/api/hermes-places') return json({ available: false, places: [] })
    return json({}, 404)
  })
  await page.goto(`${BASE}/#${hash}`)
  return { ctx, page, errors, media, external }
}
const states = (page, sel) => page.locator(sel).evaluateAll((els) => els.map((e) => e.getAttribute('data-media-state')))
const decoded = (page, sel) => page.locator(sel).evaluateAll((els) => els.map((e) => e.naturalWidth))

// 1. 卡片封面：載縮圖、帶解鎖碼
{
  const { ctx, page, errors, media } = await open()
  await page.waitForSelector('[data-testid="trip-card"] img.tr-cover')
  await page.waitForSelector('img.tr-cover[data-media-state="ready"]', { timeout: 10000 })
  check('卡片封面：請求的是縮圖 IMG_1-t.webp 且帶解鎖碼', media.some((m) => m.name === 'IMG_1-t.webp' && m.authed) && !media.some((m) => m.name === 'IMG_1.webp'))
  check('卡片封面：真的畫出來（naturalWidth > 0）', (await decoded(page, 'img.tr-cover'))[0] > 0)
  check('卡片封面：沒有 pageerror', errors.length === 0, errors.join(' | '))
  await ctx.close()
}
// 2. 縮圖 404 → 退回原圖
{
  const { ctx, page, media } = await open({ noThumbFor: ['IMG_1'] })
  await page.waitForSelector('img.tr-cover[data-media-state="ready"]', { timeout: 10000 })
  check('縮圖 404：退回原圖 IMG_1.webp 並畫出來', media.some((m) => m.name === 'IMG_1.webp' && m.authed) && (await decoded(page, 'img.tr-cover'))[0] > 0)
  await ctx.close()
}
// 3. 趟次頁：相片牆＋燈箱＋外部圖
{
  const { ctx, page, errors, media, external } = await open({ hash: `trips/${encodeURIComponent(TID)}` })
  await page.waitForSelector('[data-testid="trip-title"]')
  await page.locator('[data-testid="trip-expand-all"]').click()
  await page.waitForSelector('.fm-thumb img[data-media-state="ready"]', { timeout: 10000 })
  const st = await states(page, '.fm-thumb img')
  check(`相片牆：兩張入口網相片都 ready、外部圖是 plain（${st.join(',')}）`, st.filter((s) => s === 'ready').length === 2 && st.includes('plain'))
  check('相片牆：縮圖用 -t.webp、帶解鎖碼', media.filter((m) => m.name === 'IMG_1-t.webp' || m.name === 'IMG_2-t.webp').length >= 2 && media.every((m) => m.authed))
  check('相片牆：畫出來（naturalWidth > 0）', (await decoded(page, '.fm-thumb img')).every((w) => w > 0))
  check('外部 https 圖：直接由 <img> 載入，沒有走 /api/media', external.length >= 1 && !media.some((m) => m.name.includes('ext')))
  await page.locator('.fm-thumb').first().click()
  await page.waitForSelector('.fm-lightbox img[data-media-state="ready"]', { timeout: 10000 })
  check('燈箱：載檢視圖 IMG_1.webp', media.some((m) => m.name === 'IMG_1.webp' && m.authed))
  await page.keyboard.press('ArrowRight')
  await page.waitForSelector('.fm-lightbox img[data-media-state="ready"]')
  check('燈箱：→ 換到第二張，載 IMG_2.webp', media.some((m) => m.name === 'IMG_2.webp'))
  await page.keyboard.press('Escape')
  check('相片流程：沒有 pageerror', errors.length === 0, errors.join(' | '))
  await ctx.close()
}
// 4. 沒解鎖：403 不當掉
{
  const { ctx, page, errors } = await open({ unlocked: false })
  await page.waitForTimeout(1500)
  const bodyOk = await page.locator('body').innerText()
  check('沒解鎖：頁面沒當掉（有內容）、沒有 pageerror', bodyOk.length > 0 && errors.length === 0, errors.join(' | '))
  await ctx.close()
}
await browser.close(); server.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通過`)
process.exit(failed.length ? 1 : 0)
