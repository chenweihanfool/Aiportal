import { useState, type ReactNode } from 'react'
import { FootRefs } from './KnowledgeTrace'
import { InlineText } from './MarkdownView'
import { AddClaim, ClaimRow, ClaimText, useClaims } from './KnowledgeClaimActions'
import { isWrongNow } from './knowledgeCorrections'
import { bulletId, checkIdFor, checkKeyFor, loadChecks, relatedByKind, saveChecks, stripMarks, type Bullet, type BulletSection, type CheckStore, type ParsedBody, type Topic } from './knowledgeView'

// 知識頁題目頁的新版面元件（概念頁翻牌誤解、方法頁勾選清單／現場模式、關係區）。純函式在 knowledgeView.ts。

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

function browserStore(): CheckStore | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function CheckItem({ b, bid, no, checked, cited, onToggle }: {
  b: Bullet; bid: string; no?: number; checked: boolean; cited: ReadonlySet<string>; onToggle: () => void
}) {
  return (
    <li className="kn-ck" data-checked={checked}>
      <ClaimRow bid={bid} b={b}>
        {(v) => (
          <div className="kn-ck-line">
            {!v.wrong && <input type="checkbox" className="kn-ck-box" checked={checked} onChange={onToggle} aria-label={`完成：${v.text}`} />}
            {no !== undefined && <span className="kn-stepno" aria-hidden="true">{no}</span>}
            <div className="kn-ck-body"><ClaimText v={v}><BulletText b={v.override ? { ...b, refs: [], single: false } : b} bid={bid} cited={cited} text={v.text} /></ClaimText></div>
          </div>
        )}
      </ClaimRow>
    </li>
  )
}

export function MethodBody({ t, parsed, topics, cited, onOpen, live }: {
  t: Topic; parsed: ParsedBody; topics: readonly Topic[]; cited: ReadonlySet<string>; onOpen: (id: string) => void; live: boolean
}) {
  const ctl = useClaims()
  const key = checkKeyFor(t)
  const [checks, setChecks] = useState<ReadonlySet<string>>(() => loadChecks(browserStore(), key))
  // 有帳本時勾選用條目 id（c001…）記，改版後同一條還在；有誤（正式或暫定）的不列入進度
  const checkId = (bid: string) => checkIdFor(bid, t.claims ? ctl?.byBid.get(bid) : null)
  const isWrong = (bid: string) => {
    const c = ctl?.byBid.get(bid)
    return !!c && isWrongNow(c, ctl?.overlay.byClaim.get(c.id))
  }
  const bids = [...parsed.prep.map((_, i) => bulletId('prep', i)), ...parsed.steps.map((_, i) => bulletId('steps', i))].filter((bid) => !isWrong(bid))
  const ids = bids.map(checkId)
  const total = ids.length
  const done = ids.filter((id) => checks.has(id)).length
  const update = (next: Set<string>) => {
    setChecks(next)
    saveChecks(browserStore(), key, next)
  }
  const toggle = (id: string) => {
    const next = new Set(checks)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    update(next)
  }
  return (
    <>
      {total > 0 && (
        <div className="kn-progress">
          <div className="kn-progress-row">
            <div className="kn-bar" role="progressbar" aria-label="完成進度" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
              <div className="kn-bar-fill" style={{ width: `${(done / total) * 100}%` }} />
            </div>
            <span className="kn-progress-n">{done}／{total}</span>
          </div>
          {done === total && (
            <p className="kn-done" role="status">
              🎉 全部完成，辛苦了
              <button type="button" className="kn-btn" onClick={() => update(new Set())}>重來</button>
            </p>
          )}
        </div>
      )}
      {parsed.prep.length > 0 && (
        <Section label="開工前準備" addKey="prep">
          <ul className="kn-checklist">
            {parsed.prep.map((b, i) => {
              const bid = bulletId('prep', i)
              const id = checkId(bid)
              return <CheckItem key={i} b={b} bid={bid} checked={checks.has(id)} cited={cited} onToggle={() => toggle(id)} />
            })}
          </ul>
        </Section>
      )}
      {parsed.steps.length > 0 && (
        <Section label="步驟" addKey="steps">
          <ol className="kn-checklist">
            {parsed.steps.map((b, i) => {
              const bid = bulletId('steps', i)
              const id = checkId(bid)
              return <CheckItem key={i} b={b} bid={bid} no={i + 1} checked={checks.has(id)} cited={cited} onToggle={() => toggle(id)} />
            })}
          </ol>
        </Section>
      )}
      {!live && (
        <>
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
      )}
    </>
  )
}
