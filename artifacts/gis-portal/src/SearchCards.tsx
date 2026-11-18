import { useState } from 'react'
import { Marked } from './OmniSearchReader'
import { kindLabel, type SearchHit } from './omniSearch'
import { pushedLabel } from './repoView'
import { languageColor, tickPosition, type CardModel } from './searchViz'
import { apiFetchTemplateFile, apiFetchTemplateVersions, saveBlob, type TemplateVersionItem } from './templateApi'

// 搜尋結果的視覺卡（2.92.0）：依類別畫不同的卡；資料不足（model 為 null 或 fallback）就退回原本的文字列。

function Ticks({ dates, first, last }: { dates: string[]; first: string; last: string }) {
  return (
    <svg className="os-card-ticks" viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <line className="os-card-base" x1="0" y1="6" x2="200" y2="6" vectorEffect="non-scaling-stroke" />
      {dates.map((d, i) => {
        const x = 1 + tickPosition(d, first, last) * 198
        return <line key={`${d}${i}`} className="os-card-tick" x1={x} y1="2" x2={x} y2="10" vectorEffect="non-scaling-stroke" />
      })}
    </svg>
  )
}

const md = (d: string): string => d.slice(5).replace('-', '/')

function Body({ hit, model, q, onSearch }: { hit: SearchHit; model: Exclude<CardModel, { fallback: true }>; q: string; onSearch: (name: string) => void }) {
  switch (model.type) {
    case 'entity':
      return (
        <div className="os-card-main">
          <div className="os-card-head">
            <span className="om-t os-card-title"><Marked text={hit.title} q={q} /></span>
            <span className="os-card-badge">{kindLabel(hit.kind)}・{model.events} 件事</span>
          </div>
          {model.first && model.last && (
            <>
              <div className="os-card-dates om-s">{model.first === model.last ? model.first : `${model.first} ～ ${model.last}`}</div>
              {model.ticks.length > 0 && <Ticks dates={model.ticks} first={model.first} last={model.last} />}
            </>
          )}
          {model.related.length > 0 && (
            <div className="os-card-rel">
              {model.related.map((n) => (
                <button key={n} type="button" className="os-card-chip" onClick={(e) => { e.stopPropagation(); onSearch(n) }}>{n}</button>
              ))}
            </div>
          )}
        </div>
      )
    case 'topic':
      return (
        <div className="os-card-main">
          <div className="os-card-head">
            <span className="om-t os-card-title"><Marked text={hit.title} q={q} /></span>
            <span className="os-card-badge">來源 {model.sources}</span>
          </div>
          {model.points.map((p, i) => <div key={i} className="om-s os-card-line">{p}</div>)}
        </div>
      )
    case 'dated':
      return (
        <>
          <span className="os-card-date" aria-label={model.ym ? `${model.ym}-${model.day}` : '日期不明'}>
            <b>{model.day ?? '—'}</b>
            <small>{model.ym ?? kindLabel(hit.kind)}</small>
          </span>
          <div className="os-card-main">
            <div className="om-t os-card-title"><Marked text={hit.title} q={q} /></div>
            {hit.snippet && <div className="om-s os-card-clamp"><Marked text={hit.snippet} q={q} /></div>}
          </div>
        </>
      )
    case 'trip':
      return (
        <div className="os-card-main">
          <div className="om-t os-card-title"><Marked text={hit.title} q={q} /></div>
          <div className="os-card-span" aria-label={`${model.start} 到 ${model.end}`}>
            <span className="os-card-dot" />
            <span className="os-card-line-h" />
            <span className="os-card-dot" />
          </div>
          <div className="os-card-spanlb om-s"><span>{md(model.start)}</span><span>{md(model.end)}</span></div>
        </div>
      )
    case 'repo':
      return (
        <div className="os-card-main">
          <div className="os-card-head">
            <span className="om-t os-card-title"><Marked text={hit.title} q={q} /></span>
            {model.private && <span className="os-card-lock" role="img" aria-label="私有">🔒</span>}
            {model.archived && <span className="os-card-badge">封存</span>}
            <span className="os-card-badge os-card-repo-meta">
              {model.language && (
                <>
                  <span className="os-card-lang" style={{ background: languageColor(model.language) }} aria-hidden="true" />
                  {model.language}・
                </>
              )}
              {model.pushed ? `${pushedLabel(model.pushed, new Date())}更新` : '—'}
            </span>
          </div>
          {model.summary && <div className="om-s os-card-clamp"><Marked text={model.summary} q={q} /></div>}
        </div>
      )
  }
}

/** 範本卡（3.9.0）：檔名、類別／文件類型／主旨、版本日期與 ⬇；有舊版時可展開各版下載。 */
function TemplateBody({ hit, q, pw, onNotice }: {
  hit: SearchHit; q: string; pw: string | null; onNotice: (msg: string) => void
}) {
  const meta = hit.meta && 'templateId' in hit.meta ? hit.meta : null
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<TemplateVersionItem[] | null>(null)
  const [busy, setBusy] = useState(false)

  const download = async (id: string, fallbackName: string) => {
    if (!pw) { onNotice('解鎖後才能下載範本'); return }
    const r = await apiFetchTemplateFile(pw, id)
    if (r.ok) saveBlob(r.blob, r.filename ?? fallbackName)
    else onNotice(r.message)
  }

  const toggleVersions = async () => {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (versions !== null || !meta) return
    if (!pw) { onNotice('解鎖後才能看其他版本'); return }
    setBusy(true)
    try {
      setVersions((await apiFetchTemplateVersions(pw, meta.templateId)) ?? [])
    } catch {
      onNotice('其他版本暫時讀不到')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="os-card-main">
      <div className="os-card-head">
        <span className="om-t os-card-title"><Marked text={hit.title} q={q} /></span>
        <span className="os-card-badge">{hit.date ? `版本 ${hit.date}` : '版本不明'}</span>
        {meta && (
          <button type="button" className="os-card-chip" aria-label="下載範本"
            onClick={(e) => { e.stopPropagation(); void download(meta.templateId, hit.title) }}>⬇</button>
        )}
      </div>
      {hit.snippet && <div className="om-s os-card-clamp"><Marked text={hit.snippet} q={q} /></div>}
      {meta && meta.olderVersions > 0 && (
        <button type="button" className="os-card-chip" aria-expanded={open}
          onClick={(e) => { e.stopPropagation(); void toggleVersions() }}>
          其他版本（{meta.olderVersions}）
        </button>
      )}
      {open && (
        <div className="os-card-rel">
          {busy && <span className="os-card-dates om-s">載入版本中…</span>}
          {versions !== null && versions.length === 0 && <span className="os-card-dates om-s">沒有其他版本</span>}
          {versions?.map((v) => (
            <div key={v.id} className="os-card-line">
              <span className="om-s">{v.name}{v.version ? `（${v.version}）` : ''}</span>
              <button type="button" className="os-card-chip" aria-label={`下載 ${v.name}`}
                onClick={(e) => { e.stopPropagation(); void download(v.id, v.name) }}>⬇</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 一筆結果（role=option）。model 為 null＝資料還沒到，與 fallback 一樣畫原本的文字列。 */
export function HitCard({ hit, i, on, q, model, onPick, onSearch, pw = null, onNotice }: {
  hit: SearchHit; i: number; on: boolean; q: string; model: CardModel | null
  onPick: (i: number) => void; onSearch: (name: string) => void
  pw?: string | null; onNotice?: (msg: string) => void
}) {
  const plain = model === null || 'fallback' in model
  const notice = onNotice ?? (() => {})
  return (
    <div id={`om-opt-${i}`} role="option" aria-selected={on} className={`om-hit os-card${plain ? ' os-card-plain' : ''}${on ? ' om-on' : ''}`}
      style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }} onClick={() => onPick(i)}>
      {hit.kind === 'template' ? <TemplateBody hit={hit} q={q} pw={pw} onNotice={notice} />
        : plain ? (
          <>
            <span className="om-kd">{kindLabel(hit.kind)}</span>
            <span>
              <div className="om-t"><Marked text={hit.title} q={q} /></div>
              {hit.snippet && <div className="om-s"><Marked text={hit.snippet} q={q} /></div>}
            </span>
          </>
        ) : <Body hit={hit} model={model} q={q} onSearch={onSearch} />}
    </div>
  )
}
