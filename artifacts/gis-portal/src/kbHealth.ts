// 知識庫體檢：把新架構（Events/People/佇列/L3）的原始數字集中在戰情室最上面。
// 使用者 2026-10-15 選 C：「保留四項，另外在戰情室加幾個原始數字」。
// 資料全部來自既有的 /api/hermes-graph、/api/hermes-pipeline、/api/dashboard（mind-index），沒有新接口。
// 純函式：讀不到的欄位一律 null，畫面顯示「—」，不拿 0 充數。

export interface KbHealthInput {
  graph: { newEventsThisWeek?: unknown; newPeopleThisWeek?: unknown } | null
  pipeline: Record<string, { backlog?: unknown; lastRunTs?: unknown; health?: unknown; processed?: unknown; failed?: unknown }> | null
  mind: Record<string, unknown> | null
  now: number
}

export interface KbCell {
  key: 'newEvents' | 'backlog' | 'l3' | 'score'
  label: string
  value: string
  sub: string | null
  tone: 'ok' | 'warn' | 'crit' | 'dim' | null
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const LAYERS = ['L1', 'L2', 'L3', 'L4', 'L5'] as const
export const BACKLOG_WARN = 20

export function ageText(ts: number, now: number): string {
  const mins = Math.max(0, Math.round((now - ts) / 60000))
  if (mins < 60) return `${mins} 分鐘前`
  const h = Math.round(mins / 60)
  return h < 48 ? `${h} 小時前` : `${Math.round(h / 24)} 天前`
}

export function kbHealthCells({ graph, pipeline, mind, now }: KbHealthInput): KbCell[] {
  const cells: KbCell[] = []

  const ne = num(graph?.newEventsThisWeek)
  const np = num(graph?.newPeopleThisWeek)
  cells.push({ key: 'newEvents', label: '本週新事件', value: ne === null ? '—' : String(ne), sub: np === null ? null : `新人物 +${np}`, tone: ne === 0 ? 'warn' : null })

  const backlogs = LAYERS.map((k) => [k, num(pipeline?.[k]?.backlog)] as const)
  const known = backlogs.filter(([, b]) => b !== null) as Array<readonly [string, number]>
  const total = known.length === 0 ? null : known.reduce((a, [, b]) => a + b, 0)
  const parts = known.filter(([, b]) => b > 0).map(([k, b]) => `${k} ${b}`)
  cells.push({ key: 'backlog', label: '佇列積壓', value: total === null ? '—' : String(total), sub: total === null ? null : parts.length ? parts.join('・') : '各層都清空了', tone: total === null ? 'dim' : total >= BACKLOG_WARN ? 'warn' : null })

  const l3 = pipeline?.['L3']
  const ts = num(l3?.lastRunTs)
  const failed = num(l3?.failed)
  const processed = num(l3?.processed)
  cells.push({
    key: 'l3', label: 'L3 最近落地', value: ts === null ? '—' : ageText(ts, now),
    sub: processed === null && failed === null ? null : `處理 ${processed ?? '—'}・失敗 ${failed ?? '—'}`,
    tone: l3?.health === 'crit' ? 'crit' : ts === null ? 'dim' : now - ts > 36 * 3600e3 ? 'warn' : null,
  })

  const score = num(mind?.['score'])
  const part = (label: string, k: string) => { const v = num(mind?.[k]); return v === null ? null : `${label} ${Math.round(v)}` }
  const subParts = [part('轉化', 'conversion'), part('連結', 'linkHealth'), part('活化', 'vitality'), part('節奏', 'rhythm')].filter((x): x is string => x !== null)
  const stale = mind?.['stale'] === true
  cells.push({
    key: 'score', label: '知識庫健康分', value: score === null ? '—' : String(Math.round(score)),
    sub: subParts.length ? subParts.join('・') + (stale ? '（已過期）' : '') : null,
    tone: score === null ? 'dim' : stale ? 'warn' : score < 40 ? 'crit' : score < 60 ? 'warn' : null,
  })
  return cells
}
