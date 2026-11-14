// 卷宗索引（#dossier）：事件最多的前 20 個案件／人物。純呈現，資料由 DossierView 傳入。
import { DOSSIER_KIND_LABEL, dossierHref, type DossierIndexRow } from './dossier'

export function DossierIndex({ rows }: { rows: DossierIndexRow[] }) {
  if (rows.length === 0) return <p className="dz-note">圖譜裡還沒有可看的卷宗。</p>
  const max = Math.max(...rows.map(r => r.events), 1)
  return (
    <ul className="dz-bars" aria-label="卷宗索引">
      {rows.map(r => (
        <li key={`${r.kind}:${r.name}`}>
          <a className="dz-row dz-idx-row" href={dossierHref(r.kind, r.name)}>
            <span className="dz-row-name">{r.name}<small>{DOSSIER_KIND_LABEL[r.kind]}</small></span>
            <span className="dz-bar" aria-hidden><i style={{ width: `${Math.round((r.events / max) * 100)}%` }} /></span>
            <span className="dz-num">{r.events} 件{r.last ? ` · ${r.last.slice(2)}` : ''}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
