import { useState } from 'react'
import { postCorrection } from './knowledgeCorrections'
import { apiFetchTemplateFile, saveBlob } from './templateApi'
import { caseSourcePosition, showsDocs, unlinkText, type StepDoc, type TopicStep } from './knowledgeSteps'
import type { Topic } from './knowledgeView'

// 方法頁步驟卡（3.13.0）：每一步要用的公文範本（⬇ 直接下載）、為什麼（規定依據／你的心得／踩過的坑）、用過的案件。
// 每條連結旁的小 ✕ 送出 unlink 更正：成功後這條立刻變灰劃線並顯示「已記下」，重新整理後由下一輪 feed 決定。
// 樣式在 portal.css 的 kn-sc-*（深淺主題都用既有變數）。

type LinkStatus = 'pending' | 'ok' | 'error'

function UnlinkButton({ busy, onUnlink }: { busy: boolean; onUnlink: () => void }) {
  return (
    <button type="button" className="kn-sc-x" aria-label="這則不相關" title="這則不相關" disabled={busy} onClick={onUnlink}>✕</button>
  )
}

function Status({ status }: { status: LinkStatus | undefined }) {
  if (status === 'ok') return <span className="kn-sc-ok">已記下</span>
  if (status === 'error') return <span className="kn-sc-err" role="status">沒送出，再試一次</span>
  return null
}

function DocChip({ doc, onDownload, onUnlink, status, error }: {
  doc: StepDoc; onDownload: (id: string) => void; onUnlink: () => void; status: LinkStatus | undefined; error: string | null
}) {
  const done = status === 'ok'
  return (
    <li className="kn-sc-docwrap" data-unlinked={done}>
      <span className="kn-sc-doc">
        <button type="button" className="kn-sc-docbtn" data-unlinked={done} disabled={done} onClick={() => onDownload(doc.templateId)} aria-label={`下載範本：${doc.family}（${doc.docType}）`}>
          <span className="kn-sc-doc-fam">{doc.family}</span>
          <span className="kn-sc-doc-type">{doc.docType}・{doc.role}</span>
          <span className="kn-sc-doc-dl" aria-hidden="true">⬇</span>
        </button>
        {doc.others > 0 && <span className="kn-sc-others" title={`另有 ${doc.others} 個舊版，搜尋範本可看全部`}>＋{doc.others} 版</span>}
        <UnlinkButton busy={done || status === 'pending'} onUnlink={onUnlink} />
        <Status status={status} />
      </span>
      {error && <span className="kn-sc-err" role="status">{error}</span>}
    </li>
  )
}

export function KnowledgeSteps({ t, steps, pw, onView, highlightStep, onGoDiagram, startNo = 1 }: {
  t: Topic
  steps: TopicStep[]
  pw: string
  onView: (n: number) => void
  highlightStep: string | null
  onGoDiagram: (nodeId: string) => void
  /** 第一張卡的編號（單步呈現時用，預設 1） */
  startNo?: number
}) {
  const [unlinked, setUnlinked] = useState<Readonly<Record<string, LinkStatus>>>({})
  const [downloading, setDownloading] = useState<ReadonlySet<string>>(new Set<string>())
  const [downloadErr, setDownloadErr] = useState<Readonly<Record<string, string>>>({})
  const hasDiagram = !!t.diagram
  const docsRow = showsDocs(t.business)

  const keyOf = (stepId: string, text: string) => `${stepId}|${text}`
  const linkStatus = (stepId: string, text: string) => unlinked[keyOf(stepId, text)]

  const unlink = (stepId: string, claimId: string, text: string) => {
    const key = keyOf(stepId, text)
    setUnlinked((prev) => ({ ...prev, [key]: 'pending' }))
    void postCorrection(pw, { topicId: t.id, kind: 'unlink', claimId, text })
      .then(() => setUnlinked((prev) => ({ ...prev, [key]: 'ok' })))
      .catch(() => setUnlinked((prev) => ({ ...prev, [key]: 'error' })))
  }

  const download = (doc: StepDoc) => {
    if (downloading.has(doc.templateId)) return
    setDownloading((prev) => new Set(prev).add(doc.templateId))
    setDownloadErr((prev) => { const n = { ...prev }; delete n[doc.templateId]; return n })
    void apiFetchTemplateFile(pw, doc.templateId).then((r) => {
      if (r.ok) saveBlob(r.blob, r.filename ?? `${doc.family}.docx`)
      else setDownloadErr((prev) => ({ ...prev, [doc.templateId]: r.message }))
    }).finally(() => setDownloading((prev) => { const n = new Set(prev); n.delete(doc.templateId); return n }))
  }

  return (
    <ol className="kn-stepcards" aria-label="步驟卡">
      {steps.map((step, i) => (
        <li key={step.id} id={`kn-step-card-${step.id}`} className="kn-stepcard" data-hl={highlightStep === step.id}>
          <header className="kn-sc-head">
            <span className="kn-sc-no" aria-hidden="true">{startNo + i}</span>
            <h4 className="kn-sc-title">{step.title}</h4>
            {step.node && hasDiagram && (
              <button type="button" className="kn-sc-godiag" onClick={() => onGoDiagram(step.node!)}>在流程圖上看</button>
            )}
          </header>

          {docsRow && (
            <section className="kn-sc-sec" aria-label="要用的文件">
              <h5>📄 要用的文件</h5>
              {step.docs.length > 0 ? (
                <ul className="kn-sc-chips">
                  {step.docs.map((doc) => {
                    const text = unlinkText('doc', doc.templateId)
                    return (
                      <DocChip key={doc.templateId} doc={doc} onDownload={() => download(doc)} status={linkStatus(step.id, text)}
                        error={downloadErr[doc.templateId] ?? null} onUnlink={() => unlink(step.id, step.claim, text)} />
                    )
                  })}
                </ul>
              ) : <p className="kn-muted">還不知道</p>}
            </section>
          )}

          <section className="kn-sc-sec" aria-label="為什麼">
            <h5>💡 為什麼</h5>
            <div className="kn-sc-why">
              <h6>規定依據</h6>
              {step.why.rules.length > 0 ? (
                <ul className="kn-sc-list">
                  {step.why.rules.map((r) => {
                    const text = unlinkText('rule', r.claim)
                    const done = linkStatus(step.id, text) === 'ok'
                    return (
                      <li key={r.claim} className="kn-sc-link" data-unlinked={done}>
                        <span><strong className="kn-sc-article">{r.article}</strong> {r.text}</span>
                        <button type="button" className="kn-sc-src" disabled={done} onClick={() => onView(r.src)}>出處 ⟦{r.src}⟧</button>
                        <UnlinkButton busy={done || linkStatus(step.id, text) === 'pending'} onUnlink={() => unlink(step.id, step.claim, text)} />
                        <Status status={linkStatus(step.id, text)} />
                      </li>
                    )
                  })}
                </ul>
              ) : <p className="kn-muted">還不知道</p>}
            </div>
            <div className="kn-sc-why">
              <h6>你的心得</h6>
              {step.why.insights.length > 0 ? (
                <ul className="kn-sc-list">
                  {step.why.insights.map((ins) => {
                    const text = unlinkText('insight', ins.insightId)
                    const done = linkStatus(step.id, text) === 'ok'
                    return (
                      <li key={ins.insightId} className="kn-sc-link kn-sc-insight" data-unlinked={done}>
                        <a className="kn-sc-inslink" href={`#insight/${encodeURIComponent(ins.insightId)}`} data-unlinked={done}>
                          <span className="kn-sc-leaf" aria-hidden="true">🍃</span>
                          <span className="kn-sc-quote">「{ins.quote}」</span>
                          <span className="kn-sc-date">{ins.date}</span>
                        </a>
                        <UnlinkButton busy={done || linkStatus(step.id, text) === 'pending'} onUnlink={() => unlink(step.id, step.claim, text)} />
                        <Status status={linkStatus(step.id, text)} />
                      </li>
                    )
                  })}
                </ul>
              ) : <p className="kn-muted">還不知道</p>}
            </div>
            <div className="kn-sc-why">
              <h6>踩過的坑</h6>
              {step.why.pitfalls.length > 0 ? (
                <ul className="kn-sc-list">
                  {step.why.pitfalls.map((p) => {
                    const text = unlinkText('pitfall', p.claim)
                    const done = linkStatus(step.id, text) === 'ok'
                    return (
                      <li key={p.claim} className="kn-sc-link" data-unlinked={done}>
                        <span>{p.text}{p.case && <span className="kn-sc-case-inline">{p.case}</span>}</span>
                        <UnlinkButton busy={done || linkStatus(step.id, text) === 'pending'} onUnlink={() => unlink(step.id, step.claim, text)} />
                        <Status status={linkStatus(step.id, text)} />
                      </li>
                    )
                  })}
                </ul>
              ) : <p className="kn-muted">還不知道</p>}
            </div>
          </section>

          {step.cases.length > 0 && (
            <section className="kn-sc-sec" aria-label="用過的案件">
              <h5>🗂 用過的案件</h5>
              <ul className="kn-sc-chips">
                {step.cases.map((c) => {
                  const n = caseSourcePosition(t.sources, c.case)
                  const text = unlinkText('case', c.case)
                  const done = linkStatus(step.id, text) === 'ok'
                  return (
                    <li key={c.case} className="kn-sc-casewrap" data-unlinked={done}>
                      <button type="button" className="kn-sc-case" disabled={n === null || done} onClick={() => { if (n !== null) onView(n) }} title={n === null ? '這頁的來源沒有這個案件' : undefined}>
                        {c.case}
                      </button>
                      <UnlinkButton busy={done || linkStatus(step.id, text) === 'pending'} onUnlink={() => unlink(step.id, step.claim, text)} />
                      <Status status={linkStatus(step.id, text)} />
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </li>
      ))}
    </ol>
  )
}
