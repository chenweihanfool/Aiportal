// 時間軸 → 關係宇宙 的跳轉：時間軸的事件晶片點擊後，把要聚焦的節點暫存在 sessionStorage，切到 #graph；
// RelationshipUniverse 載入完資料後讀取並清掉它，再呼叫 selectNode。用 sessionStorage 而不是 props，
// 是因為兩個畫面走 hash route、不同時掛載。所有讀寫都包 try/catch（隱私模式或被封鎖時降級為「只切頁、不聚焦」）。
export const GRAPH_FOCUS_KEY = 'kb.graph.focus'

export interface GraphFocus { kind: 'person' | 'event' | 'case' | 'object'; id: string }

export function requestGraphFocus(focus: GraphFocus): void {
  try { sessionStorage.setItem(GRAPH_FOCUS_KEY, JSON.stringify(focus)) } catch { /* ignore */ }
}

export function consumeGraphFocus(): GraphFocus | null {
  try {
    const raw = sessionStorage.getItem(GRAPH_FOCUS_KEY)
    if (!raw) return null
    sessionStorage.removeItem(GRAPH_FOCUS_KEY)
    const v = JSON.parse(raw) as Partial<GraphFocus>
    if (v && typeof v.id === 'string' && (v.kind === 'person' || v.kind === 'event' || v.kind === 'case' || v.kind === 'object')) {
      return { kind: v.kind, id: v.id }
    }
  } catch { /* ignore */ }
  return null
}
