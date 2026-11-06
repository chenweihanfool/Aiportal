import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetchHermesDoc, apiFetchHermesRaw, apiSearchHermesDocs } from './hermesDocApi'

function mockFetch(status: number, body: unknown = {}) {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', f)
  return f
}

afterEach(() => vi.unstubAllGlobals())

describe('apiFetchHermesDoc（source／topic）', () => {
  it('key 含 / 時 encode，並帶 x-admin-password', async () => {
    const f = mockFetch(200, { kind: 'source', key: 'AI/工作/x' })
    const doc = await apiFetchHermesDoc('pw', 'source', 'AI/工作/x')
    expect(doc?.key).toBe('AI/工作/x')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('api/hermes-doc/source/' + encodeURIComponent('AI/工作/x'))
    expect((init.headers as Record<string, string>)['x-admin-password']).toBe('pw')
  })
  it('404 回 null，其他失敗丟例外', async () => {
    mockFetch(404)
    expect(await apiFetchHermesDoc('pw', 'topic', 't')).toBeNull()
    mockFetch(500)
    await expect(apiFetchHermesDoc('pw', 'topic', 't')).rejects.toThrow()
  })
})

describe('apiSearchHermesDocs', () => {
  it('q 空白不打 API', async () => {
    const f = mockFetch(200, { results: [] })
    expect(await apiSearchHermesDocs('pw', '   ')).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })
  it('帶 q 並回 results；失敗丟例外', async () => {
    const f = mockFetch(200, { results: [{ key: 'k', title: 't', meta: {}, snippet: 's', hitAt: 0 }] })
    const r = await apiSearchHermesDocs('pw', ' 租約 ')
    expect(r).toHaveLength(1)
    expect((f.mock.calls[0] as unknown as [string])[0]).toContain('api/hermes-doc-search?q=' + encodeURIComponent('租約'))
    mockFetch(400)
    await expect(apiSearchHermesDocs('pw', 'x')).rejects.toThrow()
  })
})

describe('apiFetchHermesRaw', () => {
  it('200 回 blob；503／404／413 各有訊息', async () => {
    mockFetch(200, 'x')
    expect((await apiFetchHermesRaw('pw', '人類/a.pdf')).ok).toBe(true)
    mockFetch(503)
    expect(await apiFetchHermesRaw('pw', 'p')).toMatchObject({ ok: false, reason: 'not-mounted', message: '原檔資料夾尚未掛載。' })
    mockFetch(404)
    expect(await apiFetchHermesRaw('pw', 'p')).toMatchObject({ ok: false, reason: 'not-found' })
    mockFetch(413)
    expect(await apiFetchHermesRaw('pw', 'p')).toMatchObject({ ok: false, reason: 'too-large' })
  })
})
