// HERMES 戰情室抽屜的內容：知識庫體檢、關係網路、管線、硬碟、排程、活動、容器、趨勢。
import { useEffect, useState } from 'react'
import { type DiskHistoryPoint, HermesDiskPanel } from './HermesDiskPanel'
import { type HermesGraphData, apiFetchHermesGraph } from './hermesGraphApi'
import { type KbCell, kbHealthCells } from './kbHealth'
import { COLOR, FONT } from './theme'
import { HermesPipelinePanel } from './PipelineFlow'
import { formatGb, formatMinutesAgo, pctTone } from './format'
import { CollapsibleSubPanel, StatCell, SubLabel, SubPanel, TrendLineChart } from './panelUi'
import { apiFetchDashboard, apiFetchHermesActivity, apiFetchHermesPipeline, apiFetchHermesStatus, apiFetchHermesStatusHistory, type HermesActivityEntry, type HermesContainerInfo, type HermesDiskInfo, type HermesPipelineData, type HermesScheduledTaskInfo, type HermesStatusData, type HermesStatusHistoryPoint } from './portalApi'

// ─────────────────────────────────────────────
// HERMES 戰情室 — operational monitoring, collected by
// services/hermes-status/collect.ps1 and POSTed to /api/admin/hermes-status
// + /api/admin/hermes-activity. Not a happiness dimension.
// ─────────────────────────────────────────────

function HermesEventGraphPanel({ unlockedPassword }: { unlockedPassword: string | null }) {
  const [data, setData] = useState<HermesGraphData | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!unlockedPassword) return
    let cancelled = false
    apiFetchHermesGraph(unlockedPassword)
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [unlockedPassword])

  return (
    <SubPanel title="事人物關係網路" sub="HERMES 事人物三實體架構（Events/People/Cases/Objects）· 不計入幸福指數">
      {error ? (
        <div style={{ fontSize: '0.72rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>暫時無法取得資料</div>
      ) : data === null ? (
        <div style={{ fontSize: '0.72rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>載入中…</div>
      ) : !data.available || !data.graph || !data.metrics ? (
        <div style={{ fontSize: '0.72rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>資料準備中，collect.ps1 還沒掃過 Events/</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '1px', background: COLOR.line, border: `1px solid ${COLOR.line}`, borderRadius: '5px', overflow: 'hidden', marginBottom: '0.9rem' }}>
            <StatCell label="人物數量" value={String(data.metrics.peopleCount)} />
            <StatCell label="事件數量" value={String(data.metrics.eventsCount)} />
            <StatCell label="案件數量" value={String(data.metrics.casesCount)} sub={`${data.metrics.activeCasesCount} 進行中`} />
            <StatCell label="物件數量" value={String(data.metrics.objectsCount)} />
            <StatCell label="平均關聯人數" value={data.metrics.avgParticipantsPerEvent.toFixed(1)} sub="每事件" />
            <StatCell label="真孤兒事件率" value={`${data.metrics.trueOrphanEventRatioPct}%`} valueColor={data.metrics.trueOrphanEventRatioPct >= 50 ? COLOR.warn : undefined} sub={`無人物且無案件（孤兒 ${data.metrics.orphanEventRatioPct}%）`} />
          </div>
          {data.metrics.mostActivePerson && (
            <div style={{ fontSize: '0.76rem', color: COLOR.steel, marginBottom: '0.9rem' }}>
              這陣子最活躍：<span style={{ color: COLOR.amber, fontWeight: 600 }}>{data.metrics.mostActivePerson.name}</span>
              <span style={{ color: COLOR.steelDim }}>（{data.metrics.mostActivePerson.eventCount} 個事件）</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => { window.location.hash = 'graph' }}
            style={{
              width: '100%', padding: '0.7rem', borderRadius: '5px', cursor: 'pointer', fontFamily: FONT.mono, fontSize: '0.74rem', letterSpacing: '0.06em',
              background: 'rgba(245,166,35,0.08)', border: `1px solid ${COLOR.amberDim}`, color: COLOR.amber,
            }}
          >展開完整關係宇宙 →</button>
          <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginTop: '0.6rem', textAlign: 'right' }}>
            {data.computedAt ? formatMinutesAgo(data.computedAt) : ''}
          </div>
        </>
      )}
    </SubPanel>
  )
}

const TASK_RUNNING_RESULT = 267009 // 0x41301 SCHED_S_TASK_RUNNING
const TASK_NOT_YET_RUN_RESULT = 267011 // 0x41303 SCHED_S_TASK_HAS_NOT_RUN

// 抽出來給收合面板標題的紅點判斷共用，跟 HermesTaskRow 內部畫每一列圖示用
// 的同一套判斷邏輯，不要兩處各寫一次、以後改一邊忘記改另一邊。
function isTaskFailed(t: HermesScheduledTaskInfo): boolean {
  const isRunning = t.lastTaskResult === TASK_RUNNING_RESULT
  const isPending = t.lastTaskResult === TASK_NOT_YET_RUN_RESULT
  return t.lastTaskResult !== null && !isRunning && !isPending && t.lastTaskResult !== 0
}

// 同理，容器「異常」的判斷也抽出來給紅點跟容器健康統計格共用。只需要
// status/health 兩個欄位，用 Pick 而不是整個 HermesContainerInfo，呼叫端
// 不用為了型別硬塞不相干的欄位（例如 HermesContainerRow 沒有 project）。
function isContainerFailed(c: Pick<HermesContainerInfo, 'status' | 'health'>): boolean {
  return !/up/i.test(c.status) || c.health === 'unhealthy'
}

function HermesTaskRow({ name, lastRunTime, lastTaskResult, schedule }: HermesScheduledTaskInfo) {
  const isRunning = lastTaskResult === TASK_RUNNING_RESULT
  const isPending = lastTaskResult === TASK_NOT_YET_RUN_RESULT
  const isFailed = isTaskFailed({ name, lastRunTime, lastTaskResult, schedule })
  const dotClass = isRunning ? 'dot-run' : isFailed ? 'dot-warn' : 'dot-ok'
  const statusSuffix = isRunning ? ' · 執行中' : isPending ? ' · 尚未觸發過' : isFailed ? ` · 失敗 (${lastTaskResult})` : ''
  return (
    <div className="list-item" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0.5rem 0.1rem', fontFamily: FONT.mono, fontSize: '0.72rem', borderTop: `1px solid ${COLOR.line}` }}>
      <span className={`dot ${dotClass}`} />
      <span style={{ color: COLOR.ink, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
        {schedule && <span style={{ color: COLOR.steelDim, fontSize: '0.62rem', marginLeft: '8px' }}>{schedule}</span>}
      </span>
      <span style={{ color: COLOR.steelDim, fontSize: '0.64rem', flexShrink: 0 }}>
        {lastRunTime ? formatMinutesAgo(lastRunTime) : '尚未執行'}{statusSuffix}
      </span>
    </div>
  )
}

function HermesActivityRow({ occurredAt, source, message }: HermesActivityEntry) {
  return (
    <div className="list-item" style={{ display: 'flex', alignItems: 'baseline', gap: '10px', padding: '0.5rem 0.1rem', fontFamily: FONT.mono, fontSize: '0.72rem', borderTop: `1px solid ${COLOR.line}` }}>
      <span style={{ color: COLOR.ink, flex: 1, minWidth: 0 }}>
        <span style={{ color: COLOR.amber, fontWeight: 600 }}>{source}</span> {message}
      </span>
      <span style={{ color: COLOR.steelDim, fontSize: '0.64rem', flexShrink: 0 }}>{formatMinutesAgo(occurredAt)}</span>
    </div>
  )
}

function HermesContainerRow({ name, status, health }: HermesContainerInfo) {
  const dotClass = isContainerFailed({ status, health }) ? 'dot-warn' : 'dot-ok'
  return (
    <div className="list-item" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0.5rem 0.1rem', fontFamily: FONT.mono, fontSize: '0.72rem', borderTop: `1px solid ${COLOR.line}` }}>
      <span className={`dot ${dotClass}`} />
      <span style={{ color: COLOR.ink, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <span style={{ color: COLOR.steelDim, fontSize: '0.64rem', flexShrink: 0 }}>{status}{health ? ` · ${health}` : ''}</span>
    </div>
  )
}

// 近期趨勢：CPU/記憶體/容器健康比例的每日快照折線圖，複用既有的
// TrendLineChart（跟幸福指數 30 天趨勢同一顆元件）。懶載入——這個
// CollapsibleSubPanel 預設收起，子元件要展開才會掛載、才會發這支請求，跟
// 幸福指數卡片「詳細數據展開才 fetch history」同一個節流考量。
function HermesTrendPanel({ unlockedPassword }: { unlockedPassword: string | null }) {
  const [history, setHistory] = useState<HermesStatusHistoryPoint[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!unlockedPassword) return
    let cancelled = false
    apiFetchHermesStatusHistory(unlockedPassword)
      .then(d => { if (!cancelled) setHistory(d) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [unlockedPassword])

  if (error) return <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>暫時無法取得資料</div>
  if (history === null) return <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>載入中…</div>
  if (history.length < 2) return <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>還沒有足夠的歷史資料（每天累積一筆，過幾天回來看就有線了）</div>

  const cpuPoints = history.filter((h): h is HermesStatusHistoryPoint & { cpuPercent: number } => h.cpuPercent !== null).map(h => ({ date: h.date, value: Math.round(h.cpuPercent) }))
  const memPoints = history.filter((h): h is HermesStatusHistoryPoint & { memPercent: number } => h.memPercent !== null).map(h => ({ date: h.date, value: Math.round(h.memPercent) }))
  const healthPoints = history
    .filter((h): h is HermesStatusHistoryPoint & { containersHealthy: number; containersTotal: number } => h.containersTotal !== null && h.containersTotal > 0 && h.containersHealthy !== null)
    .map(h => ({ date: h.date, value: Math.round((h.containersHealthy / h.containersTotal) * 100) }))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem 1.4rem' }}>
      <div>
        <SubLabel>CPU 負載</SubLabel>
        <TrendLineChart points={cpuPoints} color={COLOR.amber} height={64} />
      </div>
      <div>
        <SubLabel>記憶體</SubLabel>
        <TrendLineChart points={memPoints} color={COLOR.amber} height={64} />
      </div>
      <div>
        <SubLabel>容器健康比例（%）</SubLabel>
        <TrendLineChart points={healthPoints} color={COLOR.ok} height={64} />
      </div>
    </div>
  )
}

// 知識庫體檢（使用者 2026-10-15 選 C）：新事件、佇列積壓、L3 最近落地、健康分（四項）——全部來自既有接口，純邏輯在 kbHealth.ts
function KbHealthPanel({ unlockedPassword }: { unlockedPassword: string | null }) {
  const [graph, setGraph] = useState<HermesGraphData | null>(null)
  const [pipeline, setPipeline] = useState<HermesPipelineData | null>(null)
  const [mind, setMind] = useState<Record<string, unknown> | null>(null)
  const [failed, setFailed] = useState({ graph: false, pipeline: false, mind: false })
  const [loaded, setLoaded] = useState({ graph: false, pipeline: false, mind: false })

  useEffect(() => {
    if (!unlockedPassword) return
    let cancelled = false
    const done = (k: 'graph' | 'pipeline' | 'mind', bad: boolean) => {
      if (cancelled) return
      setLoaded(v => ({ ...v, [k]: true }))
      if (bad) setFailed(v => ({ ...v, [k]: true }))
    }
    apiFetchHermesGraph(unlockedPassword).then(d => { if (!cancelled) setGraph(d); done('graph', false) }).catch(() => done('graph', true))
    apiFetchHermesPipeline(unlockedPassword).then(d => { if (!cancelled) setPipeline(d); done('pipeline', false) }).catch(() => done('pipeline', true))
    apiFetchDashboard(unlockedPassword)
      .then(d => { if (!cancelled) setMind(d.summaries.find(x => x.subsystemId === 'mind-index')?.data ?? null); done('mind', false) })
      .catch(() => done('mind', true))
    return () => { cancelled = true }
  }, [unlockedPassword])

  const allLoaded = loaded.graph && loaded.pipeline && loaded.mind
  const allFailed = failed.graph && failed.pipeline && failed.mind
  const cells: KbCell[] = kbHealthCells({
    graph: graph?.available ? (graph.metrics ?? null) : null,
    pipeline: pipeline?.available ? pipeline.layers : null,
    mind,
    now: Date.now(),
  })
  const toneColor = (t: KbCell['tone']) => (t === 'crit' ? COLOR.crit : t === 'warn' ? COLOR.warn : t === 'dim' ? COLOR.steelDim : undefined)
  return (
    <SubPanel title="知識庫體檢" sub="新架構的原始數字 · 健康分（四項）每天 04:00 計算，量的是佇列吞吐、Events／People 的連結與活動量">
      {!allLoaded ? (
        <div style={{ fontSize: '0.72rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>載入中…</div>
      ) : allFailed ? (
        <div style={{ fontSize: '0.72rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>暫時無法取得資料</div>
      ) : (
        <div data-testid="kb-health" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1px', background: COLOR.line, border: `1px solid ${COLOR.line}`, borderRadius: '5px', overflow: 'hidden' }}>
          {cells.map(c => <StatCell key={c.key} label={c.label} value={c.value} sub={c.sub ?? undefined} valueColor={toneColor(c.tone)} />)}
        </div>
      )}
    </SubPanel>
  )
}

export function HermesWarRoomSection({
  unlocked,
  unlockedPassword,
  onRequestUnlock,
}: {
  unlocked: boolean
  unlockedPassword: string | null
  onRequestUnlock: () => void
}) {
  const [status, setStatus] = useState<HermesStatusData | null>(null)
  const [statusError, setStatusError] = useState(false)
  const [activity, setActivity] = useState<HermesActivityEntry[] | null>(null)
  const [activityError, setActivityError] = useState(false)
  const [diskHistory, setDiskHistory] = useState<DiskHistoryPoint[] | null>(null)

  useEffect(() => {
    if (!unlocked || !unlockedPassword) return
    let cancelled = false
    apiFetchHermesStatusHistory(unlockedPassword, 30)
      .then(d => { if (!cancelled) setDiskHistory(d.map(h => ({ date: h.date, diskUsedGb: h.diskUsedGb ?? null, diskFreeGb: h.diskFreeGb ?? null, diskTotalGb: h.diskTotalGb ?? null, storage: h.storage ?? null }))) })
      .catch(() => { /* 歷史讀不到只是少了曲線與分項比較，不擋住其他面板 */ })
    apiFetchHermesStatus(unlockedPassword)
      .then(d => { if (!cancelled) setStatus(d) })
      .catch(() => { if (!cancelled) setStatusError(true) })
    apiFetchHermesActivity(unlockedPassword)
      .then(d => { if (!cancelled) setActivity(d) })
      .catch(() => { if (!cancelled) setActivityError(true) })
    return () => { cancelled = true }
  }, [unlocked, unlockedPassword])

  if (!unlocked) {
    return (
      <div onClick={onRequestUnlock} style={{ cursor: 'pointer', padding: '1rem 0.2rem' }}>
        <div style={{ fontFamily: FONT.mono, fontSize: '0.7rem', color: COLOR.warn }}>🔒 解鎖後顯示</div>
      </div>
    )
  }

  const availableStatus: HermesStatusData | null = !statusError && status && status.available ? status : null

  return (
    <div>
      <div style={{ marginBottom: '0.9rem' }}>
        <KbHealthPanel unlockedPassword={unlockedPassword} />
      </div>

      <HermesEventGraphPanel unlockedPassword={unlockedPassword} />

      <div style={{ marginTop: '0.9rem' }}>
        <HermesPipelinePanel unlockedPassword={unlockedPassword} />
      </div>

      <div style={{ marginTop: '0.9rem' }}>
      {availableStatus === null ? (
        <div style={{ fontSize: '0.72rem', color: COLOR.steelDim, padding: '1rem 0.2rem' }}>
          {statusError ? 'HERMES 戰情室：暫時無法取得資料' : 'HERMES 戰情室：尚無資料，collect.ps1 還沒在主機上跑過'}
        </div>
      ) : (
        <div style={{ opacity: availableStatus.stale ? 0.55 : 1, filter: availableStatus.stale ? 'saturate(0.5)' : undefined }}>
          {(() => {
            const worstDisk = availableStatus.disks.reduce<HermesDiskInfo | null>(
              (worst, d) => (!worst || d.percentUsed > worst.percentUsed ? d : worst), null,
            )
            const containersOk = availableStatus.containers.filter(c => !isContainerFailed(c)).length
            return (
              <div className="ip-stat-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: COLOR.line, border: `1px solid ${COLOR.line}`, borderRadius: '5px', overflow: 'hidden', marginBottom: '0.9rem' }}>
                <StatCell label="CPU 負載" value={availableStatus.cpuPercent !== null ? `${Math.round(availableStatus.cpuPercent)}%` : '—'} valueColor={pctTone(availableStatus.cpuPercent)} />
                <StatCell label="記憶體" value={availableStatus.memPercent !== null ? `${Math.round(availableStatus.memPercent)}%` : '—'} valueColor={pctTone(availableStatus.memPercent)} />
                <StatCell
                  label={worstDisk ? `磁碟 ${worstDisk.drive}` : '磁碟'}
                  value={worstDisk ? `${Math.round(worstDisk.percentUsed)}%` : '—'}
                  sub={worstDisk ? `剩餘 ${formatGb(worstDisk.freeGb)}${availableStatus.diskForecast?.daysUntilFull != null ? ` · 約 ${availableStatus.diskForecast.daysUntilFull} 天後滿` : ''}` : undefined}
                  valueColor={worstDisk ? pctTone(worstDisk.percentUsed) : undefined}
                />
                <StatCell
                  label="容器健康"
                  value={availableStatus.containers.length === 0 ? '—' : `${containersOk} / ${availableStatus.containers.length}`}
                  sub={availableStatus.containers.length === 0 ? '尚未取得（需主機端收集）' : containersOk < availableStatus.containers.length ? '有容器異常' : undefined}
                  valueColor={availableStatus.containers.length === 0 ? COLOR.steelDim : containersOk < availableStatus.containers.length ? COLOR.warn : COLOR.ok}
                />
              </div>
            )
          })()}

          <div style={{ marginBottom: '0.9rem' }}>
            <CollapsibleSubPanel
              title="硬碟容量" sub="VPS 容量有限，知識庫會持續成長 · 用量、分項、預估寫滿時間"
              hasAlert={availableStatus.diskAlert !== undefined && availableStatus.diskAlert !== 'ok'}
              defaultOpen
            >
              <HermesDiskPanel
                disk={availableStatus.disks.reduce<HermesDiskInfo | null>((w, d) => (!w || d.percentUsed > w.percentUsed ? d : w), null)}
                storage={availableStatus.storage ?? []}
                forecast={availableStatus.diskForecast ?? null}
                level={availableStatus.diskAlert ?? 'ok'}
                history={diskHistory}
              />
            </CollapsibleSubPanel>
          </div>

          <div className="ip-board-cols" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.9rem' }}>
            <CollapsibleSubPanel
              title="排程任務狀態" sub="HERMES cron · 最近執行"
              hasAlert={availableStatus.scheduledTasks.some(isTaskFailed)}
            >
              {availableStatus.scheduledTasks.length === 0
                ? <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>尚無排程任務資料</div>
                : availableStatus.scheduledTasks.map(t => <HermesTaskRow key={t.name} {...t} />)}
            </CollapsibleSubPanel>
            <CollapsibleSubPanel title="近期活動" sub="部署 / 容器重建 / 備份">
              {activityError
                ? <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>活動紀錄讀取失敗</div>
                : activity === null
                  ? <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>載入中…</div>
                  : activity.length === 0
                    ? <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>尚無活動紀錄</div>
                    : activity.map(a => <HermesActivityRow key={a.id} {...a} />)}
            </CollapsibleSubPanel>
          </div>

          <div style={{ marginTop: '0.9rem' }}>
            <CollapsibleSubPanel
              title="容器清單" sub="Docker · 目前執行狀態"
              hasAlert={availableStatus.containers.some(isContainerFailed)}
            >
              {availableStatus.containers.length === 0
                ? <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>尚無容器資料（宿主機的 host-stats 還沒回報，或回報已超過 30 分鐘）</div>
                : availableStatus.containers.map(c => <HermesContainerRow key={c.name} {...c} />)}
            </CollapsibleSubPanel>
          </div>

          <div style={{ marginTop: '0.9rem' }}>
            <CollapsibleSubPanel title="近期趨勢" sub="CPU / 記憶體 / 容器健康 · 每日快照">
              <HermesTrendPanel unlockedPassword={unlockedPassword} />
            </CollapsibleSubPanel>
          </div>

          <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim, marginTop: '0.7rem', textAlign: 'right' }}>
            {availableStatus.computedAt ? formatMinutesAgo(availableStatus.computedAt) : ''}
            {availableStatus.stale ? <span style={{ color: COLOR.warn, marginLeft: '8px' }}>· 資料已超過 30 分鐘未更新</span> : null}
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
