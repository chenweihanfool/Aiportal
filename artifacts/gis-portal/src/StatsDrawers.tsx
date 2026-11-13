import { useAsync } from './homeHooks'
import { fetchPushStats14, fetchSearchStats14 } from './statsApi'
import { KIND_LABEL, pctText } from './statusAside'

// STATUS 右欄兩個小抽屜的內容（2.88.0）：搜尋統計、推送統計，都是近 14 天，打開時才讀。

function Kv({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="st-kv" title={hint}>
      <span className="st-kv-k">{k}</span>
      <b className="st-kv-v">{v}</b>
    </div>
  )
}

export function SearchStatsPanel({ pw }: { pw: string }) {
  const s = useAsync(pw, fetchSearchStats14)
  const d = s.data?.value ?? null
  if (s.error && !s.data) return <p className="hm-note hm-note--bad" role="status">搜尋統計暫時無法取得。</p>
  if (s.loading) return <p className="hm-note">載入中…</p>
  if (!d) return <p className="hm-note">後端還沒提供搜尋統計。</p>
  return (
    <div data-testid="search-stats-panel">
      <p className="hm-note">近 {d.days || 14} 天。查無結果率高，代表你常找、系統卻找不到——查無結果最多的詞就是知識庫該補的地方。</p>
      <div className="st-kvs">
        <Kv k="搜尋次數" v={String(d.searches)} />
        <Kv k="查無結果" v={`${d.zero} 次・${d.searches > 0 ? pctText(d.zeroRate) : '—'}`} hint="沒有任何結果的搜尋佔全部的比例" />
        <Kv k="有點開結果" v={`${d.clicked} 次・${d.searches > 0 ? pctText(d.clickRate) : '—'}`} hint="搜尋後有點開任何一筆的比例" />
      </div>
      <h3 className="hm-h3">查無結果最多的詞</h3>
      {d.topZero.length === 0 ? <p className="hm-muted">這段時間沒有查無結果的詞。</p> : (
        <ol className="st-toplist">
          {d.topZero.map((t) => <li key={t.q}><span>{t.q}</span><b>{t.count} 次</b></li>)}
        </ol>
      )}
    </div>
  )
}

export function PushStatsPanel({ pw }: { pw: string }) {
  const s = useAsync(pw, fetchPushStats14)
  const d = s.data?.value ?? null
  if (s.error && !s.data) return <p className="hm-note hm-note--bad" role="status">推送統計暫時無法取得。</p>
  if (s.loading) return <p className="hm-note">載入中…</p>
  if (!d) return <p className="hm-note">後端還沒提供推送統計。</p>
  return (
    <div data-testid="push-stats-panel">
      <p className="hm-note">近 {d.days || 14} 天，「現在用得上」卡片的成效。點開率低、沒用率高的種類，就是該調整推送條件的地方。</p>
      <div className="st-kvs">
        <Kv k="顯示過的卡" v={String(d.shown)} />
        <Kv k="被點開" v={`${d.opened} 則・${d.shown > 0 ? pctText(d.openRate) : '—'}`} />
        <Kv k="有用" v={`${d.useful} 則`} />
        <Kv k="沒用" v={`${d.useless} 則・${d.shown > 0 ? pctText(d.uselessRate) : '—'}`} />
        <Kv k="有推送的天數" v={`${d.daysWithCards} 天`} />
      </div>
      <h3 className="hm-h3">各種類</h3>
      {d.byKind.length === 0 ? <p className="hm-muted">這段時間還沒有推送紀錄。</p> : (
        <table className="st-table">
          <thead><tr><th scope="col">種類</th><th scope="col">顯示</th><th scope="col">點開</th><th scope="col">沒用</th></tr></thead>
          <tbody>
            {d.byKind.map((k) => (
              <tr key={k.kind}><th scope="row">{KIND_LABEL[k.kind] ?? k.kind}</th><td>{k.shown}</td><td>{k.opened}</td><td>{k.useless}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
