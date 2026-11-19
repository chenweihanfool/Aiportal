import { useState } from 'react'
import { dossierHref } from './dossier'
import type { Topic } from './knowledgeView'
import { answerFor, findTemplateUses } from './searchAnswer'
import { apiFetchTemplateFile, saveBlob } from './templateApi'

// 搜尋直達答案（3.14.0）：閱讀面板裡一次給齊「檔案下載＋方法路線（這一步高亮）＋為什麼＋用過的案件＋心得與相關題目」。
// 純邏輯在 searchAnswer.ts；樣式在 portal.css 的 om-ans-*（只用既有 --c-* token）。

/** 下載範本（沿用 KnowledgeSteps 的寫法）；錯誤文字依 templateId 保存，顯示在按鈕旁 */
function useTemplateDownload(pw: string | null) {
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set<string>())
  const [errs, setErrs] = useState<Readonly<Record<string, string>>>({})
  const download = (id: string, fallbackName: string) => {
    if (busy.has(id)) return
    if (!pw) { setErrs((p) => ({ ...p, [id]: '解鎖後才能下載範本' })); return }
    setBusy((p) => new Set(p).add(id))
    setErrs((p) => { const n = { ...p }; delete n[id]; return n })
    void apiFetchTemplateFile(pw, id)
      .then((r) => {
        if (r.ok) saveBlob(r.blob, r.filename ?? `${fallbackName}.docx`)
        else setErrs((p) => ({ ...p, [id]: r.message }))
      })
      .catch(() => setErrs((p) => ({ ...p, [id]: '下載失敗，稍後再試' })))
      .finally(() => setBusy((p) => { const n = new Set(p); n.delete(id); return n }))
  }
  return { download, busy, errs }
}
type Dl = ReturnType<typeof useTemplateDownload>

function StepDetail({ topic, stepIndex, dl }: { topic: Topic; stepIndex: number; dl: Dl }) {
  const a = answerFor(topic, stepIndex)
  const s = a.step
  if (!s) return null
  const hasWhy = s.rules.length > 0 || s.pitfalls.length > 0
  return (
    <div className="om-ans-step" data-testid="om-ans-step">
      {s.docs.length > 0 && (
        <>
          <h3 className="om-lb">這一步的文件</h3>
          <ul className="om-ans-list">
            {s.docs.map((d) => (
              <li key={d.templateId}>
                <button type="button" className="om-ans-dl" data-testid="om-ans-doc" disabled={dl.busy.has(d.templateId)} onClick={() => dl.download(d.templateId, d.family)}
                  aria-label={`下載範本：${d.family}（${d.docType}）`}>
                  <span>⬇ {d.family}</span><span className="om-ans-sub">{d.docType}</span>
                </button>
                {dl.errs[d.templateId] && <span className="om-ans-err" role="status">{dl.errs[d.templateId]}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {hasWhy && (
        <>
          <h3 className="om-lb">為什麼</h3>
          <ul className="om-ans-list" data-testid="om-ans-why">
            {s.rules.map((r) => <li key={r.claim}><strong className="om-ans-article">{r.article}</strong> {r.text}</li>)}
            {s.pitfalls.map((p) => <li key={p.claim}>踩雷：{p.text}</li>)}
          </ul>
        </>
      )}
      {s.cases.length > 0 && (
        <>
          <h3 className="om-lb">用過的案件</h3>
          <ul className="om-ans-chips">
            {s.cases.map((c) => (
              <li key={c.case}><a className="om-ans-chip" data-testid="om-ans-case" href={dossierHref('case', c.case)}>{c.case}{c.date ? <span className="om-ans-sub">{c.date}</span> : null}</a></li>
            ))}
          </ul>
        </>
      )}
      {s.insights.length > 0 && (
        <>
          <h3 className="om-lb">你的心得</h3>
          <ul className="om-ans-list">
            {s.insights.map((i) => (
              <li key={i.insightId}><a href={`#insight/${encodeURIComponent(i.insightId)}`}>🍃 「{i.quote}」<span className="om-ans-sub">{i.date}</span></a></li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/** 一個方法的路線＋目前這步的細節＋相關題目＋看整頁。toggle：再點目前這步可收起（題目命中用） */
function RouteBlock({ topic, initialStep, toggle, dl }: { topic: Topic; initialStep: number; toggle: boolean; dl: Dl }) {
  const [step, setStep] = useState(initialStep)
  const a = answerFor(topic, step)
  return (
    <div className="om-ans-block" data-testid="om-ans-block">
      <h3 className="om-lb">方法路線・{topic.name}</h3>
      <ol className="om-ans-route" aria-label="方法路線">
        {a.route.map((st) => (
          <li key={st.index}>
            <button type="button" className="om-ans-station" data-testid="om-ans-station" data-current={st.current} aria-current={st.current ? 'step' : undefined}
              aria-pressed={st.current} onClick={() => setStep(toggle && st.current ? -1 : st.index)}>
              {st.current && <span className="om-ans-here">你在這</span>}
              <span className="om-ans-st-title">{st.index + 1}. {st.title}</span>
              <span className="om-ans-sub" aria-label={`${st.docCount} 份文件`}>📄 {st.docCount}</span>
            </button>
          </li>
        ))}
      </ol>
      <StepDetail topic={topic} stepIndex={a.stepIndex} dl={dl} />
      {a.related.length > 0 && (
        <>
          <h3 className="om-lb">相關題目</h3>
          <ul className="om-ans-chips">
            {a.related.map((r) => <li key={r.id}><a className="om-ans-chip" href={`#knowledge/${encodeURIComponent(r.id)}`}>{r.name}</a></li>)}
          </ul>
        </>
      )}
      <a className="om-ans-more" href={`#knowledge/${encodeURIComponent(topic.id)}`}>看整頁 →</a>
    </div>
  )
}

/** 範本命中：下載鈕＋用在哪個方法 */
export function TemplateAnswer({ pw, templateId, family, topics }: { pw: string | null; templateId: string; family: string | null; topics: readonly Topic[] | null | undefined }) {
  const dl = useTemplateDownload(pw)
  const [open, setOpen] = useState(0)
  const uses = findTemplateUses(topics, templateId, family)
  const name = family ?? '範本'
  return (
    <div className="om-ans" data-testid="om-ans-template">
      <div className="om-ans-top">
        <button type="button" className="om-cta om-ans-main" data-testid="om-ans-download" disabled={dl.busy.has(templateId)} onClick={() => dl.download(templateId, name)}>⬇ 下載</button>
        {dl.errs[templateId] && <span className="om-ans-err" role="status">{dl.errs[templateId]}</span>}
      </div>
      {topics == null ? <p className="om-one om-dim">方法資料載入中…</p>
        : uses.length === 0 ? <p className="om-one om-dim">這份範本還沒連到方法頁</p>
        : (
          <>
            <h3 className="om-lb">用在哪個方法</h3>
            {uses.map((u, i) => (
              open === i
                ? <RouteBlock key={u.topic.id} topic={u.topic} initialStep={u.stepIndex} toggle={false} dl={dl} />
                : (
                  <button key={u.topic.id} type="button" className="om-ans-fold" data-testid="om-ans-fold" onClick={() => setOpen(i)}>
                    {u.topic.name}・第 {u.stepIndex + 1} 步 {u.topic.steps?.[u.stepIndex]?.title ?? ''}
                  </button>
                )
            ))}
          </>
        )}
    </div>
  )
}

/** 題目命中且有 steps：在預覽之後接路線（全部不高亮，點站展開那一步） */
export function TopicAnswer({ pw, topic }: { pw: string | null; topic: Topic }) {
  const dl = useTemplateDownload(pw)
  if (!topic.steps || topic.steps.length === 0) return null
  return <div className="om-ans" data-testid="om-ans-topic"><RouteBlock key={topic.id} topic={topic} initialStep={-1} toggle dl={dl} /></div>
}
