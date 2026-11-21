// 知識頁網址（3.21.0）：#knowledge＝島嶼全景；#knowledge/<id>＝進該題所在的島並展開完整閱讀區；
// #knowledge/<id>/s/<sid>＝停在這一題的某一站（閱讀區收起）。純函式，有測試。

export type KnowledgeRoute = { view: 'overview' } | { view: 'topic'; topicId: string; stationId: string | null }

function dec(s: string): string | null {
  try { return decodeURIComponent(s) } catch { return null }
}

/** 非 #knowledge 開頭回 null；decode 失敗或 id 空白回 overview */
export function parseKnowledgeHash(hash: string): KnowledgeRoute | null {
  if (hash === '#knowledge') return { view: 'overview' }
  if (!hash.startsWith('#knowledge/')) return null
  const rest = hash.slice('#knowledge/'.length)
  const parts = rest.split('/')
  const id = dec(parts[0] ?? '')
  if (id === null || id.trim() === '') return { view: 'overview' }
  if (parts.length >= 3 && parts[1] === 's') {
    const sid = dec(parts.slice(2).join('/'))
    if (sid === null) return { view: 'overview' }
    return { view: 'topic', topicId: id, stationId: sid === '' ? null : sid }
  }
  return { view: 'topic', topicId: id, stationId: null }
}

export function formatKnowledgeHash(route: KnowledgeRoute): string {
  if (route.view === 'overview') return '#knowledge'
  const base = `#knowledge/${encodeURIComponent(route.topicId)}`
  return route.stationId ? `${base}/s/${encodeURIComponent(route.stationId)}` : base
}
