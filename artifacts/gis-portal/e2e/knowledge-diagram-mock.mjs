#!/usr/bin/env node
// 知識頁圖解（2.81.0）的瀏覽器實測用 mock 伺服器：零依賴（只用 node:http），回應前端知識頁需要的 API。
// 資料全是中性假字（見 fixtures/topics-diagram.json），沒有真實地號、人名、病歷。
//
// 啟動（在 artifacts/gis-portal 目錄）：
//   A) 先 `pnpm run build`，再 `node e2e/knowledge-diagram-mock.mjs`
//      → 同時把 dist/public 當網站、/api/* 當 mock，開 http://localhost:5199/
//   B) 要用 vite dev server（熱更新）：先 `PORT=5174 pnpm exec vite`，再
//      `VITE_ORIGIN=http://localhost:5174 node e2e/knowledge-diagram-mock.mjs`
//      → mock 把非 /api 的請求轉給 vite，仍然開 http://localhost:5199/（不轉 websocket，所以沒有熱更新推播，重新整理即可）
//   埠號用環境變數 MOCK_PORT 改（預設 5199）。
//
// 解鎖知識頁：本機不強制登入（/api/auth/me 回 404），但知識頁要「已解鎖」。在瀏覽器 console 執行
//   localStorage.setItem('portal_unlocked', 'demo'); location.hash = '#knowledge/tflow'; location.reload()
// （密碼值隨便，mock 不檢查 x-admin-password；/api/dashboard 回 unlocked:true 所以不會被踢掉。）
// 四個題目：tflow（流程泳道）、ttime（多軌時間軸）、tmap（觀察→框架→判斷）、told（沒有 diagram 的舊頁）。
//
// 提供的端點：
//   GET /api/feed/topics                  fixtures/topics-diagram.json（computedAt 換成現在，才不會顯示「資料已過期」）
//   GET /api/hermes-doc/source/<id>       來源原文（假內容；含一句會被引用的原文句）
//   GET /api/hermes-doc/topic/<id>        題目的引用索引 meta.quotes（照 body 裡 ⟦n⟧ 出現順序產生）
//   GET /api/hermes-doc-search?q=         空結果
//   GET /api/hermes-raw?path=             一份最小的 PDF（開原檔用）
//   GET /api/dashboard                    { summaries: [], unlocked: true }
//   其他 /api/*                           404 { message }（前端各自降級，不會崩潰）

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'topics-diagram.json'), 'utf8'))
const distDir = path.resolve(here, '..', 'dist', 'public')
const PORT = Number(process.env.MOCK_PORT ?? 5199)
const VITE_ORIGIN = process.env.VITE_ORIGIN ?? ''

const topics = fixture.payload.topics
const sourceIndex = new Map() // source id → { title, type, case, date, topics:[{id,name}] }
for (const t of topics) {
  for (const s of t.sources) {
    const e = sourceIndex.get(s.id) ?? { ...s, topics: [] }
    e.topics.push({ id: t.id, name: t.name })
    sourceIndex.set(s.id, e)
  }
}

const quoteLine = (title) => `本句是被引用的原文句：${title}的重點在這裡。`

function sourceDoc(id) {
  const s = sourceIndex.get(id)
  if (!s) return null
  const bodyMd = [
    `（示範原文）${s.title}`,
    '',
    '這是第一段，與引用無關，只是讓原文面板有一些內容可捲動。',
    ...Array.from({ length: 12 }, (_, i) => `填充段落 ${i + 1}：中性假字，沒有任何真實資料。`),
    '',
    quoteLine(s.title),
    '',
    '最後一段，同樣是假內容。',
  ].join('\n')
  return {
    kind: 'source', key: id, title: s.title, bodyMd, truncated: false, updatedAt: new Date().toISOString(),
    sourcePath: `示範/${s.title}.md`,
    meta: {
      type: s.type ?? 'note', case: s.case ?? null, date: s.date ?? null, originName: `${s.title}.pdf`,
      rawPath: `示範/${s.title}.pdf`, textFrom: 'original', evidence: null, topics: s.topics,
    },
  }
}

function topicDoc(id) {
  const t = topics.find((x) => x.id === id)
  if (!t) return null
  const quotes = []
  for (const m of (t.body ?? '').matchAll(/⟦(\d+)⟧/g)) {
    const ref = Number(m[1])
    const src = t.sources[ref - 1]
    quotes.push({ k: quotes.length, ref, text: src ? quoteLine(src.title) : null, fromOriginal: true, weak: false })
  }
  return { kind: 'topic', key: id, title: t.name, bodyMd: t.body ?? '', truncated: false, updatedAt: new Date().toISOString(), sourcePath: null, meta: { quotes } }
}

// 最小的單頁 PDF（"Mock source file"）
const PDF = Buffer.from(
  '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
  '4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 20 50 Td (Mock source file) Tj ET\nendstream endobj\n' +
  '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF\n',
)

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function api(req, res, url) {
  const p = url.pathname
  if (p === '/api/feed/topics') {
    return json(res, 200, { ...fixture, payload: { ...fixture.payload, computedAt: new Date().toISOString() } })
  }
  let m = /^\/api\/hermes-doc\/(source|topic)\/(.+)$/.exec(p)
  if (m) {
    const key = decodeURIComponent(m[2])
    const doc = m[1] === 'source' ? sourceDoc(key) : topicDoc(key)
    return doc ? json(res, 200, doc) : json(res, 404, { message: '內容尚未同步' })
  }
  if (p === '/api/hermes-doc-search') return json(res, 200, { results: [] })
  if (p === '/api/hermes-raw') {
    res.writeHead(200, { 'content-type': 'application/pdf' })
    return res.end(PDF)
  }
  if (p === '/api/dashboard') return json(res, 200, { summaries: [], unlocked: true })
  return json(res, 404, { message: `mock 沒有這個端點：${p}` })
}

function serveStatic(req, res, url) {
  if (VITE_ORIGIN) {
    const target = new URL(url.pathname + url.search, VITE_ORIGIN)
    const proxied = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers)
      r.pipe(res)
    })
    proxied.on('error', () => json(res, 502, { message: `連不到 vite（${VITE_ORIGIN}）` }))
    return req.pipe(proxied)
  }
  let file = path.join(distDir, decodeURIComponent(url.pathname))
  if (!file.startsWith(distDir)) return json(res, 403, { message: 'forbidden' })
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, 'index.html')
  if (!fs.existsSync(file)) return json(res, 404, { message: '找不到 dist/public，先跑 pnpm run build，或改用 VITE_ORIGIN' })
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}

http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname.startsWith('/api/')) return api(req, res, url)
  return serveStatic(req, res, url)
}).listen(PORT, () => {
  console.log(`知識圖解 mock 伺服器：http://localhost:${PORT}/（${VITE_ORIGIN ? `轉給 vite ${VITE_ORIGIN}` : `網站＝${distDir}`}）`)
})
