// 時間軸 → 關係宇宙 的跳轉：時間軸的事件晶片點擊後，把要聚焦的節點暫存在 sessionStorage，切到 #graph；
// RelationshipUniverse 載入完資料後讀取並清掉它，再呼叫 selectNode。用 sessionStorage 而不是 props，
// 是因為兩個畫面走 hash route、不同時掛載。所有讀寫都包 try/catch（隱私模式或被封鎖時降級為「只切頁、不聚焦」）。
export const GRAPH_FOCUS_KEY = 'kb.graph.focus'

export interface GraphFocus { kind: 'person' | 'event' | 'case' | 'object' | 'concept' | 'method'; id: string }

export function requestGraphFocus(focus: GraphFocus): void {
  try { sessionStorage.setItem(GRAPH_FOCUS_KEY, JSON.stringify(focus)) } catch { /* ignore */ }
}

export function consumeGraphFocus(): GraphFocus | null {
  try {
    const raw = sessionStorage.getItem(GRAPH_FOCUS_KEY)
    if (!raw) return null
    sessionStorage.removeItem(GRAPH_FOCUS_KEY)
    const v = JSON.parse(raw) as Partial<GraphFocus>
    if (v && typeof v.id === 'string' && (v.kind === 'person' || v.kind === 'event' || v.kind === 'case' || v.kind === 'object' || v.kind === 'concept' || v.kind === 'method')) {
      return { kind: v.kind, id: v.id }
    }
  } catch { /* ignore */ }
  return null
}

// 關係宇宙 → 時間軸 的返回：時間軸跳走前把「列表級別＋開著的對話框堆疊」存起來，
// 關係宇宙讀到後顯示「← 返回時間軸」；按下去再寫回，時間軸掛上時還原。同樣只用 sessionStorage、全部 try/catch。
export const TIMELINE_RETURN_KEY = 'kb.timeline.return'

export interface TimelineReturn { level: string; stack: { level: string; periodKey: string }[] }

export function saveTimelineReturn(r: TimelineReturn): void {
  try { sessionStorage.setItem(TIMELINE_RETURN_KEY, JSON.stringify(r)) } catch { /* ignore */ }
}

/** 只讀不清（React StrictMode 會重跑 state 初始化）；清除另外呼叫 clearTimelineReturn。 */
export function peekTimelineReturn(): TimelineReturn | null {
  try {
    const raw = sessionStorage.getItem(TIMELINE_RETURN_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<TimelineReturn>
    const ok = (x: unknown): x is { level: string; periodKey: string } =>
      !!x && typeof (x as { level?: unknown }).level === 'string' && typeof (x as { periodKey?: unknown }).periodKey === 'string'
    if (v && typeof v.level === 'string' && Array.isArray(v.stack) && v.stack.every(ok)) return { level: v.level, stack: v.stack }
  } catch { /* ignore */ }
  return null
}

export function clearTimelineReturn(): void {
  try { sessionStorage.removeItem(TIMELINE_RETURN_KEY) } catch { /* ignore */ }
}
