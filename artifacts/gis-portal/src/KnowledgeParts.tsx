import { useState, type ReactNode } from 'react'
import { FootRefs } from './KnowledgeTrace'
import { InlineText } from './MarkdownView'
import { AddClaim, ClaimRow, ClaimText, useClaims } from './KnowledgeClaimActions'
import { KnowledgeSteps } from './KnowledgeSteps'
import { bulletId, relatedByKind, stripMarks, type Bullet, type BulletSection, type ParsedBody, type Topic } from './knowledgeView'
import type { TopicStep } from './knowledgeSteps'

// 知識頁題目頁的新版面元件（概念頁翻牌誤解、方法頁步驟卡、關係區）。純函式在 knowledgeView.ts／knowledgeSteps.ts。

export function BulletText({ b, bid, cited, text }: { b: Bullet; bid: string; cited: ReadonlySet<string>; text?: string }) {
  return (
    <span className="kn-bt" id={`kn-b-${bid}`} data-cited={cited.has(bid)}>
      <InlineText text={text ?? b.text} />
      {b.single && <span className="kn-single">僅一例</span>}
      <FootRefs refs={b.refs} k0={b.k0} />
    </span>
  )
}

/** 一條句子（含更正選單）：沒有帳本或配不到 claim 時等同 BulletText */
export function ClaimBullet({ b, bid, cited, tid }: { b: Bullet; bid: string; cited: ReadonlySet<string>; tid?: string }) {
  return (
    <ClaimRow bid={bid} b={b}>
      {(v) => <ClaimText v={v}><BulletText b={v.override ? { ...b, refs: [], single: false } : b} bid={tid ?? bid} cited={cited} text={v.text} /></ClaimText>}
    </ClaimRow>
  )
}

/** addKey：這一節最後加「＋ 補一句」（有帳本且已解鎖才會出現） */
export function Section({ label, children, addKey }: { label: string; children: ReactNode; addKey?: BulletSection }) {
  return (
    <section className="kn-section" aria-label={label}>
      <h3>{label}</h3>
      {children}
      {addKey && <AddClaim section={addKey} />}
    </section>
  )
}

function PlainList({ items, section, cited }: { items: Bullet[]; section: BulletSection; cited: ReadonlySet<string> }) {
  return <ul className="kn-plain">{items.map((b, i) => <li key={i}><ClaimBullet b={b} bid={bulletId(section, i)} cited={cited} /></li>)}</ul>
}

/* ───────── 關係區 ───────── */

function RelGroup({ title, topics, onOpen }: { title: string; topics: Topic[]; onOpen: (id: string) => void }) {
  if (topics.length === 0) return null
  return (
    <div className="kn-rel-group">
      <h4>{title}</h4>
      <ul className="kn-related">
        {topics.map((x) => <li key={x.id}><button type="button" className="kn-link" onClick={() => onOpen(x.id)}>{x.name}</button></li>)}
      </ul>
    </div>
  )
}

function Relations({ t, topics, onOpen, conceptsTitle, methodsTitle, order }: {
  t: Topic; topics: readonly Topic[]; onOpen: (id: string) => void; conceptsTitle: string; methodsTitle: string; order: 'concepts-first' | 'methods-first'
}) {
  const r = relatedByKind(t, topics)
  if (r.concepts.length === 0 && r.methods.length === 0) return null
  const concepts = <RelGroup key="c" title={conceptsTitle} topics={r.concepts} onOpen={onOpen} />
  const methods = <RelGroup key="m" title={methodsTitle} topics={r.methods} onOpen={onOpen} />
  return (
    <section className="kn-section kn-rel" aria-label="關係">
      <h3>關係</h3>
      {order === 'methods-first' ? [methods, concepts] : [concepts, methods]}
    </section>
  )
}

/* ───────── 概念頁 ───────── */

function MythCards({ items, cited }: { items: Bullet[]; cited: ReadonlySet<string> }) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set())
  const claimsOn = !!useClaims()
  const flippable = items.filter((b) => b.myth && b.truth).length
  const flipped = [...open].filter((i) => items[i]?.truth).length
  const toggle = (i: number) => setOpen((prev) => {
    const next = new Set(prev)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    return next
  })
  return (
    <>
      {flippable > 0 && <p className="kn-muted kn-myth-count" aria-live="polite">已翻 {flipped}／{flippable}</p>}
      <ul className="kn-myths">
        {items.map((b, i) => {
          const bid = bulletId('myths', i)
          if (!b.myth || !b.truth) {
            return <li key={i} className="kn-myth kn-myth--plain" id={`kn-b-${bid}`} data-ca={claimsOn} data-cited={cited.has(bid)}><ClaimBullet b={b} bid={bid} tid={`${bid}-t`} cited={cited} /></li>
          }
          const isOpen = open.has(i)
          const myth = b.myth
          const truth = b.truth
          return (
            <li key={i} className="kn-myth" id={`kn-b-${bid}`} data-open={isOpen} data-ca={claimsOn} data-cited={cited.has(bid)}>
              <ClaimRow bid={bid} b={b}>
                {(v) => (v.override || v.wrong) ? (
                  <div className="kn-myth--plain"><ClaimText v={v}><BulletText b={v.override ? { ...b, refs: [], single: false } : b} bid={`${bid}-t`} cited={cited} text={v.text} /></ClaimText></div>
                ) : (
                  <>
                    <button type="button" className="kn-myth-front" aria-expanded={isOpen} aria-controls={`kn-truth-${i}`} onClick={() => toggle(i)}>
                      <span className="kn-myth-tag">以為</span>
                      <span className="kn-myth-text">{myth}</span>
                      <span className="kn-myth-hint">{isOpen ? '收回' : '點我看真相'}</span>
                    </button>
                    <div id={`kn-truth-${i}`} className="kn-myth-truth" hidden={!isOpen}>
                      <span className="kn-myth-tag kn-myth-tag--ok">其實</span>
                      <span>
                        <InlineText text={stripMarks(truth)} />
                        {b.single && <span className="kn-single">僅一例</span>}
                        <FootRefs refs={b.refs} k0={b.k0} />
                      </span>
                    </div>
                  </>
                )}
              </ClaimRow>
            </li>
          )
        })}
      </ul>
    </>
  )
}

export function ConceptBody({ t, parsed, topics, cited, onOpen }: {
  t: Topic; parsed: ParsedBody; topics: readonly Topic[]; cited: ReadonlySet<string>; onOpen: (id: string) => void
}) {
  return (
    <>
      {parsed.why.length > 0 && <Section label="為什麼存在" addKey="why"><PlainList items={parsed.why} section="why" cited={cited} /></Section>}
      {parsed.myths.length > 0 && <Section label="常見誤解" addKey="myths"><MythCards items={parsed.myths} cited={cited} /></Section>}
      {parsed.examples.length > 0 && <Section label="實例" addKey="examples"><PlainList items={parsed.examples} section="examples" cited={cited} /></Section>}
      <Relations t={t} topics={topics} onOpen={onOpen} methodsTitle="用到這個概念的方法" conceptsTitle="相關概念" order="methods-first" />
    </>
  )
}

/* ───────── 方法頁 ───────── */

export function MethodBody({ t, parsed, topics, cited, onOpen, pw, onView, highlightStep, onGoDiagram }: {
  t: Topic; parsed: ParsedBody; topics: readonly Topic[]; cited: ReadonlySet<string>; onOpen: (id: string) => void
  pw: string
  /** 原文面板：n＝sources 的 1 起算位置 */
  onView: (n: number) => void
  /** 從圖解點節點跳過來時，要高亮的步驟卡 id */
  highlightStep: string | null
  /** 步驟卡「在流程圖上看」：捲到圖解並高亮該節點 */
  onGoDiagram: (nodeId: string) => void
}) {
  const steps: TopicStep[] = t.steps ?? []
  return (
    <>
      {parsed.prep.length > 0 && (
        <Section label="開工前準備" addKey="prep">
          <ul className="kn-plain">
            {parsed.prep.map((b, i) => <li key={i}><ClaimBullet b={b} bid={bulletId('prep', i)} cited={cited} /></li>)}
          </ul>
        </Section>
      )}
      {steps.length > 0 ? (
        <Section label="步驟" addKey="steps">
          <KnowledgeSteps t={t} steps={steps} pw={pw} onView={onView} highlightStep={highlightStep} onGoDiagram={onGoDiagram} />
        </Section>
      ) : parsed.steps.length > 0 && (
        <Section label="步驟" addKey="steps">
          <ol className="kn-steps">
            {parsed.steps.map((b, i) => (
              <li key={i}>
                <span className="kn-stepno" aria-hidden="true">{i + 1}</span>
                <div><ClaimBullet b={b} bid={bulletId('steps', i)} cited={cited} /></div>
              </li>
            ))}
          </ol>
        </Section>
      )}
      {parsed.decisions.length > 0 && (
        <Section label="判斷點" addKey="decisions">
          <ul className="kn-forks">
            {parsed.decisions.map((b, i) => (
              <li key={i} className="kn-fork">
                <ClaimRow bid={bulletId('decisions', i)} b={b}>
                  {(v) => (b.when && b.then && !v.override && !v.wrong) ? (
                    <>
                      <div className="kn-fork-if"><span className="kn-fork-tag">如果</span><BulletText b={{ ...b, refs: [] }} bid={`${bulletId('decisions', i)}-if`} cited={cited} text={b.when} /></div>
                      <div className="kn-fork-then" id={`kn-b-${bulletId('decisions', i)}`} data-cited={cited.has(bulletId('decisions', i))}>
                        <span className="kn-fork-tag kn-fork-tag--then">就</span>
                        <span><InlineText text={stripMarks(b.then)} />{b.single && <span className="kn-single">僅一例</span>}<FootRefs refs={b.refs} k0={b.k0} /></span>
                      </div>
                    </>
                  ) : <ClaimText v={v}><BulletText b={v.override ? { ...b, refs: [], single: false } : b} bid={bulletId('decisions', i)} cited={cited} text={v.text} /></ClaimText>}
                </ClaimRow>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {parsed.pitfalls.length > 0 && (
        <Section label="踩過的坑" addKey="pitfalls">
          <ul className="kn-cautions kn-pitfalls">
            {parsed.pitfalls.map((b, i) => (
              <li key={i}>
                <span aria-hidden="true">⚠</span>
                <div className="kn-pit-body">
                  <ClaimRow bid={bulletId('pitfalls', i)} b={b}>
                    {(v) => (b.trap && b.avoid && !v.override && !v.wrong) ? (
                      <span className="kn-bt" id={`kn-b-${bulletId('pitfalls', i)}`} data-cited={cited.has(bulletId('pitfalls', i))}>
                        <strong className="kn-trap">{b.trap}</strong>
                        <span className="kn-avoid"><InlineText text={stripMarks(b.avoid)} />{b.single && <span className="kn-single">僅一例</span>}<FootRefs refs={b.refs} k0={b.k0} /></span>
                      </span>
                    ) : <ClaimText v={v}><BulletText b={v.override ? { ...b, refs: [], single: false } : b} bid={bulletId('pitfalls', i)} cited={cited} text={v.text} /></ClaimText>}
                  </ClaimRow>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Relations t={t} topics={topics} onOpen={onOpen} conceptsTitle="這個方法用到的概念" methodsTitle="相關方法" order="concepts-first" />
    </>
  )
}
