import { useMemo, useState } from 'react'
import { apiFetchHermesPipeline, type HermesPipelineLayerData } from './portalApi'
import { BANDS, NODES, RETIRED, ROLE_LABEL, neighbors, nodeById, nodesInBand, relationTo, type ArchNode } from './architectureData'
import { formatMinutesAgo } from './format'
import { useAsync } from './homeHooks'
import { scheduleLine, shortSchedule } from './pipelineSchedule'

// 知識庫架構頁（#architecture，2026-10-22）：分層畫出「來源 → 萃取管線 → 權威儲存 → 衍生索引 → 入口網」，
// L1～L5 的班表與健康狀態是即時的（/api/hermes-pipeline），其餘是結構說明。點節點高亮上下游、看職責與腳本。
// 拓撲資料在 architectureData.ts（有測試）；樣式在 portal.css 的 ar-*。

const LAMP: Record<string, string> = { ok: '#5fbf7a', crit: '#e2584f', unknown: '#5b6270' }

function LayerStatus({ layer, unlocked, loading, failed }: { layer: HermesPipelineLayerData | null; unlocked: boolean; loading: boolean; failed: boolean }) {
  if (!unlocked) return <span className="ar-live ar-live--off">🔒 解鎖後顯示狀態</span>
  if (loading) return <span className="ar-live ar-live--off">狀態載入中</span>
  if (failed && !layer) return <span className="ar-live ar-live--bad">狀態暫時無法取得</span>
  if (!layer) return null
  return (
    <span className="ar-live">
      <i className="ar-lamp" style={{ background: LAMP[layer.health] ?? LAMP['unknown'] }} aria-hidden />
      {layer.health === 'ok' ? '正常' : layer.health === 'crit' ? '異常' : '未知'}
      {layer.lastRun ? `・上次 ${formatMinutesAgo(layer.lastRun)}` : ''}
    </span>
  )
}

export function ArchitectureView({ unlockedPassword, onBack, onRequestUnlock }: { unlockedPassword: string | null; onBack: () => void; onRequestUnlock: () => void }) {
  const [selected, setSelected] = useState<string | null>('L3')
  const pipeline = useAsync(unlockedPassword, apiFetchHermesPipeline)
  const unlocked = !!unlockedPassword
  const layers = pipeline.data?.layers ?? null
  const sel = selected ? nodeById(selected) ?? null : null
  const rel = useMemo(() => (selected ? neighbors(selected) : null), [selected])
  const selLayer = sel?.layer && layers ? layers[sel.layer] : null

  const card = (n: ArchNode) => {
    const layer = n.layer && layers ? layers[n.layer] : null
    const r = relationTo(selected, n.id)
    return (
      <li key={n.id}>
        <button type="button" className="ar-node" data-role={n.role} data-rel={r} aria-pressed={r === 'self'} onClick={() => setSelected(r === 'self' ? null : n.id)}>
          <span className="ar-node-top">
            <b>{n.title}</b>
            <span className="ar-badge" data-role={n.role}>{ROLE_LABEL[n.role]}</span>
          </span>
          <span className="ar-node-sub">{n.layer ? shortSchedule(layer?.schedule, n.sub) : n.sub}</span>
          {n.layer && unlocked && layer && <i className="ar-lamp ar-lamp--corner" style={{ background: LAMP[layer.health] ?? LAMP['unknown'] }} aria-label={`健康：${layer.health}`} />}
        </button>
      </li>
    )
  }

  return (
    <div className="ar-root">
      <header className="ar-head">
        <button type="button" className="ar-back" onClick={onBack}>← 返回儀表板</button>
        <h1>知識庫架構</h1>
        <span className="ar-legend" aria-label="圖例">
          {(['authority', 'pipeline', 'derived', 'experimental'] as const).map((k) => <span key={k} className="ar-badge" data-role={k}>{ROLE_LABEL[k]}</span>)}
        </span>
        {!unlocked && <button type="button" className="ar-unlock" onClick={onRequestUnlock}>🔒 解鎖看即時狀態</button>}
      </header>

      <div className="ar-layout">
        <div className="ar-bands">
          {BANDS.map((b, i) => (
            <section key={b.id} className="ar-band" aria-label={b.title}>
              <div className="ar-band-head"><b>{b.title}</b><span>{b.hint}</span></div>
              <ul className="ar-nodes">{nodesInBand(b.id).map(card)}</ul>
              {i < BANDS.length - 1 && <div className="ar-down" aria-hidden>↓</div>}
            </section>
          ))}
          <p className="ar-foot">節點總數 {NODES.length}。L1～L5 的班表與健康狀態取自 jobs.json 與心跳，其餘為結構說明；「非即時」的數字是當時回報的快照。</p>
          {RETIRED.map((r) => (
            <div key={r.name} className="ar-retired" data-testid="ar-retired">
              <b>已擱置並移除：{r.name}</b><span>（{r.date}）</span>
              <p>{r.why}</p>
              <p><b>重啟條件：</b>{r.restart}</p>
            </div>
          ))}
        </div>

        <aside className="ar-detail" aria-live="polite">
          {!sel ? (
            <p className="ar-muted">點任一節點，看它的職責、腳本，以及誰餵它、它餵誰。</p>
          ) : (
            <>
              <div className="ar-detail-top"><h2>{sel.title}</h2><span className="ar-badge" data-role={sel.role}>{ROLE_LABEL[sel.role]}</span></div>
              <p className="ar-sub">{sel.sub}</p>
              <p>{sel.what}</p>
              {sel.layer && (
                <p className="ar-line">
                  <LayerStatus layer={selLayer} unlocked={unlocked} loading={pipeline.loading} failed={pipeline.error} />
                  {unlocked && selLayer && scheduleLine(selLayer.schedule, undefined) && <span className="ar-muted">　班表：{scheduleLine(selLayer.schedule, undefined)}</span>}
                </p>
              )}
              {sel.note && <p className="ar-note">{sel.note}</p>}
              {sel.scripts && sel.scripts.length > 0 && (
                <div><div className="ar-label">腳本</div><ul className="ar-scripts">{sel.scripts.map((s) => <li key={s}><code>{s}</code></li>)}</ul></div>
              )}
              {rel && (
                <div className="ar-flow">
                  <div><div className="ar-label">上游（誰餵它）</div>{rel.up.length === 0 ? <span className="ar-muted">無</span> : rel.up.map((n) => <button key={n.id} type="button" className="ar-chip" onClick={() => setSelected(n.id)}>{n.title}</button>)}</div>
                  <div><div className="ar-label">下游（它餵誰）</div>{rel.down.length === 0 ? <span className="ar-muted">無（沒有任何下游）</span> : rel.down.map((n) => <button key={n.id} type="button" className="ar-chip" onClick={() => setSelected(n.id)}>{n.title}</button>)}</div>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
