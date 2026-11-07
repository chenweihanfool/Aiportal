import { useState, type ReactNode } from 'react'
import { FootRefs } from './KnowledgeTrace'
import { InlineText } from './MarkdownView'
import { bulletId, checkKey, loadChecks, relatedByKind, saveChecks, type Bullet, type BulletSection, type CheckStore, type ParsedBody, type Topic } from './knowledgeView'

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

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="kn-section" aria-label={label}>
      <h3>{label}</h3>
      {children}
    </section>
  )
}

function PlainList({ items, section, cited }: { items: Bullet[]; section: BulletSection; cited: ReadonlySet<string> }) {
  return <ul className="kn-plain">{items.map((b, i) => <li key={i}><BulletText b={b} bid={bulletId(section, i)} cited={cited} /></li>)}</ul>
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
            return <li key={i} className="kn-myth kn-myth--plain" id={`kn-b-${bid}`} data-cited={cited.has(bid)}><BulletText b={b} bid={`${bid}-t`} cited={cited} /></li>
          }
          const isOpen = open.has(i)
          return (
            <li key={i} className="kn-myth" id={`kn-b-${bid}`} data-open={isOpen} data-cited={cited.has(bid)}>
              <button type="button" className="kn-myth-front" aria-expanded={isOpen} aria-controls={`kn-truth-${i}`} onClick={() => toggle(i)}>
                <span className="kn-myth-tag">以為</span>
                <span className="kn-myth-text">{b.myth}</span>
                <span className="kn-myth-hint">{isOpen ? '收回' : '點我看真相'}</span>
              </button>
              <div id={`kn-truth-${i}`} className="kn-myth-truth" hidden={!isOpen}>
                <span className="kn-myth-tag kn-myth-tag--ok">其實</span>
                <span>
                  <InlineText text={b.truth} />
                  {b.single && <span className="kn-single">僅一例</span>}
                  <FootRefs refs={b.refs} k0={b.k0} />
                </span>
              </div>
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
      {parsed.why.length > 0 && <Section label="為什麼存在"><PlainList items={parsed.why} section="why" cited={cited} /></Section>}
      {parsed.myths.length > 0 && <Section label="常見誤解"><MythCards items={parsed.myths} cited={cited} /></Section>}
      {parsed.examples.length > 0 && <Section label="實例"><PlainList items={parsed.examples} section="examples" cited={cited} /></Section>}
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
      <input type="checkbox" className="kn-ck-box" checked={checked} onChange={onToggle} aria-label={`完成：${b.text}`} />
      {no !== undefined && <span className="kn-stepno" aria-hidden="true">{no}</span>}
      <div className="kn-ck-body"><BulletText b={b} bid={bid} cited={cited} /></div>
    </li>
  )
}

export function MethodBody({ t, parsed, topics, cited, onOpen, live }: {
  t: Topic; parsed: ParsedBody; topics: readonly Topic[]; cited: ReadonlySet<string>; onOpen: (id: string) => void; live: boolean
}) {
  const key = checkKey(t.id, t.revision)
  const [checks, setChecks] = useState<ReadonlySet<string>>(() => loadChecks(browserStore(), key))
  const ids = [...parsed.prep.map((_, i) => bulletId('prep', i)), ...parsed.steps.map((_, i) => bulletId('steps', i))]
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
        <Section label="開工前準備">
          <ul className="kn-checklist">
            {parsed.prep.map((b, i) => {
              const id = bulletId('prep', i)
              return <CheckItem key={i} b={b} bid={id} checked={checks.has(id)} cited={cited} onToggle={() => toggle(id)} />
            })}
          </ul>
        </Section>
      )}
      {parsed.steps.length > 0 && (
        <Section label="步驟">
          <ol className="kn-checklist">
            {parsed.steps.map((b, i) => {
              const id = bulletId('steps', i)
              return <CheckItem key={i} b={b} bid={id} no={i + 1} checked={checks.has(id)} cited={cited} onToggle={() => toggle(id)} />
            })}
          </ol>
        </Section>
      )}
      {!live && (
        <>
          {parsed.decisions.length > 0 && (
            <Section label="判斷點">
              <ul className="kn-forks">
                {parsed.decisions.map((b, i) => (
                  <li key={i} className="kn-fork">
                    {b.when && b.then ? (
                      <>
                        <div className="kn-fork-if"><span className="kn-fork-tag">如果</span><BulletText b={{ ...b, refs: [] }} bid={`${bulletId('decisions', i)}-if`} cited={cited} text={b.when} /></div>
                        <div className="kn-fork-then" id={`kn-b-${bulletId('decisions', i)}`} data-cited={cited.has(bulletId('decisions', i))}>
                          <span className="kn-fork-tag kn-fork-tag--then">就</span>
                          <span><InlineText text={b.then} />{b.single && <span className="kn-single">僅一例</span>}<FootRefs refs={b.refs} k0={b.k0} /></span>
                        </div>
                      </>
                    ) : <BulletText b={b} bid={bulletId('decisions', i)} cited={cited} />}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {parsed.pitfalls.length > 0 && (
            <Section label="踩過的坑">
              <ul className="kn-cautions kn-pitfalls">
                {parsed.pitfalls.map((b, i) => (
                  <li key={i}>
                    <span aria-hidden="true">⚠</span>
                    <div>
                      {b.trap && b.avoid ? (
                        <span className="kn-bt" id={`kn-b-${bulletId('pitfalls', i)}`} data-cited={cited.has(bulletId('pitfalls', i))}>
                          <strong className="kn-trap">{b.trap}</strong>
                          <span className="kn-avoid"><InlineText text={b.avoid} />{b.single && <span className="kn-single">僅一例</span>}<FootRefs refs={b.refs} k0={b.k0} /></span>
                        </span>
                      ) : <BulletText b={b} bid={bulletId('pitfalls', i)} cited={cited} />}
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
