import { Marked } from './OmniSearchReader'
import { kindLabel, type SearchHit } from './omniSearch'
import { tickPosition, type CardModel } from './searchViz'

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
  }
}

/** 一筆結果（role=option）。model 為 null＝資料還沒到，與 fallback 一樣畫原本的文字列。 */
export function HitCard({ hit, i, on, q, model, onPick, onSearch }: {
  hit: SearchHit; i: number; on: boolean; q: string; model: CardModel | null
  onPick: (i: number) => void; onSearch: (name: string) => void
}) {
  const plain = model === null || 'fallback' in model
  return (
    <div id={`om-opt-${i}`} role="option" aria-selected={on} className={`om-hit os-card${plain ? ' os-card-plain' : ''}${on ? ' om-on' : ''}`}
      style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }} onClick={() => onPick(i)}>
      {plain ? (
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
