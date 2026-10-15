// 戰情室的 L1~L5 知識萃取管線：互動式數據流向圖與歷史。
import { useEffect, useState } from 'react'
import { scheduleLine, shortSchedule } from './pipelineSchedule'
import { COLOR, FONT } from './theme'
import { formatMinutesAgo } from './format'
import { CollapsibleSubPanel, FormulaToggle, StatCell } from './panelUi'
import { apiFetchHermesPipeline, apiFetchHermesPipelineHistory, type HermesPipelineData, type HermesPipelineHealth, type HermesPipelineHistoryPoint, type HermesPipelineLayerData } from './portalApi'

// ─────────────────────────────────────────────
// L1~L5 知識萃取管線 — 互動式數據流向圖（2026-09-20 起）。節點座標/連線
// 是手排的固定版面（不是力導向佈局）——只有 8 個節點、拓撲永遠不變，犯不
// 著為這種規模上一套通用的圖佈局引擎。腳本路徑/排程/職責描述是 HERMES
// 在控制頻道回覆的靜態規格（2026-09-20），只有各層目前的健康狀態
// （health/lastRun/processed 等）是即時抓的；靜態規格改版時要手動更新這
// 份表，HERMES 那邊沒有 API 可以讓前端自己查規格。
// ─────────────────────────────────────────────
type PipelineNodeId = 'diary' | 'raw' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'store' | 'portal'

interface PipelineNodeMeta {
  id: PipelineNodeId
  label: string
  sub: string
  description: string
  script?: string
  schedule?: string
  monitored: boolean
}

const PIPELINE_NODES: Record<PipelineNodeId, PipelineNodeMeta> = {
  diary: {
    id: 'diary', label: '日記', sub: '人工輸入', monitored: false,
    description: '每天寫進日記檔案的內容（人類編輯區 + AI 處理區），是整條管線唯一的人工輸入來源。',
  },
  raw: {
    id: 'raw', label: 'RAW 原始檔', sub: 'RAW_INTAKE 資料夾', monitored: false,
    description: 'PDF、名片、掃描件等原始檔案，丟進 RAW_INTAKE 資料夾等待 L4 掃描辨識。',
  },
  L1: {
    id: 'L1', label: 'L1 快掃', sub: '10:30 / 16:30 / 20:30', monitored: true,
    script: 'l1-agent-wrapper.py', schedule: '每天 3 班：10:30 / 16:30 / 20:30',
    description: '讀日記增量（上次「已處理」marker 之後的內容），萃取候選事件（含概念／方法）；同一班也萃取社交互動寫進 social_interactions.jsonl。日記事件附帶的截圖等附件連結會一併帶進事件來源；另列出近 14 天新增、尚未被事件引用的附件供認領。',
  },
  L4: {
    id: 'L4', label: 'L4 原始檔', sub: '11:35 / 17:35', monitored: true,
    script: 'l4-agent-wrapper.py', schedule: '每天 2 班：11:35 / 17:35',
    description: '掃描 RAW_INTAKE 資料夾，OCR 辨識 PDF／名片／掃描件，萃取候選事件，格式跟 L1 輸出一致。',
  },
  L2: {
    id: 'L2', label: 'L2 正規化', sub: '12:00 / 21:15', monitored: true,
    script: 'l2-agent-wrapper.py', schedule: '每天 2 班：12:00（Pass 1 快建）／ 21:15（Pass 2 精修）',
    description: '先同步 Vikunja 任務評論進日記，再做人名消歧＋事件合併判斷，把 L1／L4 的候選事件整理成正規化格式。',
  },
  L3: {
    id: 'L3', label: 'L3 落地', sub: '00:10', monitored: true,
    script: 'l3-agent-wrapper.py', schedule: '每天 00:10（01:10 補跑班）',
    description: '唯一有權寫入 Events/People 正式檔的一層：落地成正式事件檔、同步建立/更新人物檔，並做關聯補鏈（人物骨架、雙向回填、Cases 時序、alias 併檔、人↔人關係）。',
  },
  store: {
    id: 'store', label: 'Events / People / Cases', sub: '正式檔・唯一真相來源', monitored: false,
    description: 'HERMES 知識庫的正式資料——事人物三實體 + 案件脈絡層（另有概念／方法）。Aiportal 的事人物關係網路圖與各項指標全部從這裡反推，不是另外存一份。vault 是唯一真相來源。',
  },
  portal: {
    id: 'portal', label: '入口網站', sub: '每 10 分鐘推送', monitored: false,
    description: 'pusher 腳本每 10 分鐘把 vault 衍生的資料（關係圖、事件與概念內容）和管線／主機狀態推進入口網站的資料庫（Postgres），前端只跟資料庫取資料；資料庫可由 vault 重建，不是第二份真相。',
    script: 'hermes-graph-pusher.py／pipeline-status-pusher.py／hermes-status-pusher.py', schedule: '每 10 分鐘',
  },
  L5: {
    id: 'L5', label: 'L5 圖譜編織', sub: '02:00', monitored: true,
    script: 'l5-agent-wrapper.py', schedule: '每天 02:00',
    description: '沿著 L3 建好的邊說故事：為人物／案件／物件樞紐在「## 圖譜敘事」增補新的一段（標題＋條列，永不改寫舊段）、更新樞紐觀察評價，並挑出跨維度的時效警報寫進 🧠 區塊。只寫樞紐檔，不碰 L3 維護的連結區塊。',
  },
}

const PIPELINE_NODE_POS: Record<PipelineNodeId, { x: number; y: number; w: number; h: number }> = {
  diary: { x: 6, y: 48, w: 116, h: 56 },
  raw: { x: 6, y: 196, w: 116, h: 56 },
  L1: { x: 176, y: 48, w: 136, h: 56 },
  L4: { x: 176, y: 196, w: 136, h: 56 },
  L2: { x: 360, y: 122, w: 136, h: 56 },
  L3: { x: 544, y: 122, w: 136, h: 56 },
  store: { x: 728, y: 48, w: 146, h: 56 },
  L5: { x: 728, y: 196, w: 146, h: 56 },
  portal: { x: 912, y: 48, w: 116, h: 56 },
}
const PIPELINE_VIEW_W = 1044
const PIPELINE_VIEW_H = 270

function pipelineNodeCenter(id: PipelineNodeId) {
  const p = PIPELINE_NODE_POS[id]
  return { x: p.x + p.w / 2, y: p.y + p.h / 2 }
}

interface PipelineEdge { path: string; label?: string; labelAt?: { x: number; y: number }; feedback?: boolean }

// 座標手排，理由同上——連線起訖點是照節點實際外框邊界算的固定值，store↔L5
// 之間的讀取／寫回是兩條平行的垂直線（x 各偏移 8px），不是同一條線雙向畫，
// 避免箭頭疊在一起看不出方向。
const PIPELINE_EDGES: PipelineEdge[] = [
  { path: 'M122,76 L176,76' },
  { path: 'M122,224 L176,224' },
  { path: 'M312,76 L360,150', label: 'candidates', labelAt: { x: 322, y: 100 } },
  { path: 'M312,224 L360,150', label: 'candidates', labelAt: { x: 322, y: 204 } },
  { path: 'M496,150 L544,150', label: 'normalized', labelAt: { x: 500, y: 140 } },
  { path: 'M680,150 L728,84', label: '寫入', labelAt: { x: 674, y: 110 } },
  { path: 'M874,76 L912,76', label: '推送', labelAt: { x: 878, y: 68 } },
  { path: 'M793,104 L793,196', label: '讀取', labelAt: { x: 760, y: 152 } },
  { path: 'M809,196 L809,104', label: '寫回 🧠', labelAt: { x: 812, y: 152 }, feedback: true },
]

function pipelineHealthColor(health: HermesPipelineHealth | undefined): string {
  if (health === 'ok') return COLOR.ok
  if (health === 'crit') return COLOR.crit
  return COLOR.steelDim
}
function pipelineHealthLabel(health: HermesPipelineHealth | undefined): string {
  if (health === 'ok') return '正常'
  if (health === 'crit') return '異常 / 逾時未執行'
  return '尚無資料'
}

function PipelineDetailCard({ meta, layer }: { meta: PipelineNodeMeta; layer: HermesPipelineLayerData | null }) {
  return (
    <div style={{ background: COLOR.panelDeep, border: `1px solid ${COLOR.line}`, borderRadius: '5px', padding: '0.9rem 1rem', marginTop: '0.8rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.4rem' }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: COLOR.ink }}>{meta.label}</span>
        {layer && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontFamily: FONT.mono, fontSize: '0.62rem', color: pipelineHealthColor(layer.health) }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: pipelineHealthColor(layer.health) }} />
            {pipelineHealthLabel(layer.health)}
          </span>
        )}
      </div>
      <div style={{ fontSize: '0.74rem', color: COLOR.steel, lineHeight: 1.6, marginBottom: meta.monitored ? '0.7rem' : 0 }}>{meta.description}</div>
      {meta.script && (
        <div style={{ fontFamily: FONT.mono, fontSize: '0.64rem', color: COLOR.steelDim, marginBottom: '2px' }}>
          腳本：<span style={{ color: COLOR.steel }}>{meta.script}</span>　排程：<span style={{ color: COLOR.steel }}>{scheduleLine(layer?.schedule, meta.schedule)}</span>
        </div>
      )}
      {meta.monitored && (
        layer === null ? (
          <div style={{ fontSize: '0.68rem', color: COLOR.steelDim, marginTop: '0.5rem' }}>尚無 heartbeat 資料</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(76px, 1fr))', gap: '1px', background: COLOR.line, border: `1px solid ${COLOR.line}`, borderRadius: '5px', overflow: 'hidden', marginTop: '0.6rem' }}>
              <StatCell label="最近執行" value={layer.lastRunTs !== null ? formatMinutesAgo(new Date(layer.lastRunTs).toISOString()) : (layer.lastRun ?? '—')} />
              <StatCell label="已處理" value={layer.processed !== null ? String(layer.processed) : '—'} />
              <StatCell label="已入庫" value={layer.committed !== null ? String(layer.committed) : '—'} />
              <StatCell label="失敗" value={layer.failed !== null ? String(layer.failed) : '—'} valueColor={layer.failed ? COLOR.crit : undefined} />
              <StatCell label="待處理" value={layer.backlog !== null ? String(layer.backlog) : '—'} />
            </div>
            {layer.errorSummary && (
              <div style={{ fontSize: '0.68rem', color: COLOR.crit, marginTop: '0.6rem', lineHeight: 1.5 }}>⚠ {layer.errorSummary}</div>
            )}
          </>
        )
      )}
    </div>
  )
}

function HermesPipelineFlowDiagram({ data }: { data: HermesPipelineData | null }) {
  const [selected, setSelected] = useState<PipelineNodeId>('L1')
  const layers = data?.available ? data.layers : null

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${PIPELINE_VIEW_W} ${PIPELINE_VIEW_H}`}
          width="100%" height={PIPELINE_VIEW_H}
          style={{ display: 'block', minWidth: '640px' }}
        >
          <defs>
            <marker id="pipeline-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={COLOR.steelDim} />
            </marker>
            <marker id="pipeline-arrow-amber" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={COLOR.amberDim} />
            </marker>
          </defs>

          {PIPELINE_EDGES.map((e, i) => (
            <g key={i}>
              <path
                d={e.path} fill="none" stroke={e.feedback ? COLOR.amberDim : COLOR.steelDim} strokeWidth={1.3}
                strokeDasharray={e.feedback ? '4 3' : undefined}
                markerEnd={`url(#${e.feedback ? 'pipeline-arrow-amber' : 'pipeline-arrow'})`}
              />
              {e.label && e.labelAt && (
                <text x={e.labelAt.x} y={e.labelAt.y} fontFamily={FONT.mono} fontSize={8.5} fill={e.feedback ? COLOR.amberDim : COLOR.steelDim}>{e.label}</text>
              )}
            </g>
          ))}

          {(Object.keys(PIPELINE_NODE_POS) as PipelineNodeId[]).map(id => {
            const pos = PIPELINE_NODE_POS[id]
            const meta = PIPELINE_NODES[id]
            const layer = layers ? layers[id as 'L1' | 'L2' | 'L3' | 'L4' | 'L5'] : null
            const isSelected = selected === id
            return (
              <g key={id} onClick={() => setSelected(id)} style={{ cursor: 'pointer' }}>
                <rect
                  x={pos.x} y={pos.y} width={pos.w} height={pos.h} rx={6}
                  fill={isSelected ? 'rgba(245,166,35,0.08)' : COLOR.panelRaised}
                  stroke={isSelected ? COLOR.amberDim : COLOR.line} strokeWidth={isSelected ? 1.6 : 1}
                />
                <text x={pos.x + 10} y={pos.y + 23} fontFamily={FONT.body} fontSize={12} fontWeight={600} fill={COLOR.ink}>{meta.label}</text>
                <text x={pos.x + 10} y={pos.y + 39} fontFamily={FONT.mono} fontSize={9} fill={COLOR.steelDim}>{meta.monitored ? shortSchedule(layer?.schedule, meta.sub) : meta.sub}</text>
                {meta.monitored && (
                  <circle cx={pos.x + pos.w - 11} cy={pos.y + 11} r={4.5} fill={pipelineHealthColor(layer?.health)} />
                )}
              </g>
            )
          })}
        </svg>
      </div>

      <div style={{ display: 'flex', gap: '14px', fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim, marginTop: '0.5rem', flexWrap: 'wrap' }}>
        <span><span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: COLOR.ok, marginRight: '4px' }} />正常</span>
        <span><span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: COLOR.crit, marginRight: '4px' }} />異常／逾時未執行</span>
        <span><span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: COLOR.steelDim, marginRight: '4px' }} />尚無資料</span>
        <span style={{ flex: 1 }} />
        <span>點節點看詳情</span>
      </div>

      <PipelineDetailCard
        meta={PIPELINE_NODES[selected]}
        layer={layers && PIPELINE_NODES[selected].monitored ? layers[selected as 'L1' | 'L2' | 'L3' | 'L4' | 'L5'] : null}
      />
    </div>
  )
}

// 近 N 天每層健康狀態的色條（不是折線圖——health 是類別值 ok/crit/
// unknown，不是連續數字，折線圖沒有意義）。懶載入：點「近 14 天歷史」才
// fetch，跟其他歷史面板同一個節流考量。
function PipelineHistoryStrip({ unlockedPassword }: { unlockedPassword: string | null }) {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<HermesPipelineHistoryPoint[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!open || !unlockedPassword || history !== null) return
    apiFetchHermesPipelineHistory(unlockedPassword)
      .then(setHistory)
      .catch(() => setError(true))
  }, [open, unlockedPassword, history])

  return (
    <div style={{ marginTop: '0.7rem' }}>
      <FormulaToggle expanded={open} onToggle={() => setOpen(x => !x)} labelCollapsed="近 14 天歷史 ▼" labelExpanded="收起 ▲" />
      {open && (
        error ? (
          <div style={{ fontSize: '0.68rem', color: COLOR.steelDim, marginTop: '0.5rem' }}>暫時無法取得資料</div>
        ) : history === null ? (
          <div style={{ fontSize: '0.68rem', color: COLOR.steelDim, marginTop: '0.5rem' }}>載入中…</div>
        ) : history.length === 0 ? (
          <div style={{ fontSize: '0.68rem', color: COLOR.steelDim, marginTop: '0.5rem' }}>還沒有歷史資料</div>
        ) : (
          <div style={{ marginTop: '0.6rem' }}>
            {(['L1', 'L2', 'L3', 'L4', 'L5'] as const).map(layer => (
              <div key={layer} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, width: '18px', flexShrink: 0 }}>{layer}</span>
                <div style={{ display: 'flex', gap: '2px' }}>
                  {history.map(h => {
                    const health = h[layer]
                    const color = health ? pipelineHealthColor(health) : COLOR.line
                    return (
                      <span
                        key={h.date}
                        title={`${h.date}：${health ? pipelineHealthLabel(health) : '尚無資料'}`}
                        style={{ width: '10px', height: '10px', borderRadius: '2px', background: color, display: 'inline-block' }}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: FONT.mono, fontSize: '0.58rem', color: COLOR.steelDim, marginTop: '4px' }}>
              <span>{history[0]?.date}</span>
              <span>{history[history.length - 1]?.date}</span>
            </div>
          </div>
        )
      )}
    </div>
  )
}

export function HermesPipelinePanel({ unlockedPassword }: { unlockedPassword: string | null }) {
  const [data, setData] = useState<HermesPipelineData | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!unlockedPassword) return
    let cancelled = false
    apiFetchHermesPipeline(unlockedPassword)
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [unlockedPassword])

  const hasAlert = !!data?.available && (['L1', 'L2', 'L3', 'L4', 'L5'] as const).some(id => data.layers[id].health === 'crit')

  return (
    <CollapsibleSubPanel title="知識萃取管線（L1~L5）" sub="日記 → 知識：數據流向與即時健康狀態" hasAlert={hasAlert}>
      {error ? (
        <div style={{ fontSize: '0.72rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>暫時無法取得資料</div>
      ) : data === null ? (
        <div style={{ fontSize: '0.72rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>載入中…</div>
      ) : (
        <>
          {!data.available && (
            <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, marginBottom: '0.6rem' }}>尚無 heartbeat 資料，collect.ps1 還沒讀到 HERMES 主機上的 heartbeat.json——下方是管線架構圖，節點暫時顯示「尚無資料」</div>
          )}
          <HermesPipelineFlowDiagram data={data} />
          <PipelineHistoryStrip unlockedPassword={unlockedPassword} />
          {data.computedAt && (
            <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginTop: '0.6rem', textAlign: 'right' }}>{formatMinutesAgo(data.computedAt)}</div>
          )}
        </>
      )}
    </CollapsibleSubPanel>
  )
}
