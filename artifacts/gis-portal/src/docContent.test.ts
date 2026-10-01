import { describe, expect, it } from 'vitest'
import { attachmentKind, describeSource, stripSourceSection } from './docContent'

describe('describeSource', () => {
  it('shows only the date for diaries and the file name for attachments', () => {
    expect(describeSource({ type: 'diary', path: '日記/2026-09-04.md' })).toEqual({ label: '日記', text: '2026-09-04' })
    expect(describeSource({ type: 'attachment', path: '附件/子目錄/報告.pdf' })).toEqual({ label: '附件', text: '報告.pdf' })
    expect(describeSource({ type: 'other', path: '人類/通霄專案/xxx/' })).toEqual({ label: '其他', text: '人類/通霄專案/xxx' })
  })
})

describe('stripSourceSection', () => {
  it('removes a trailing 來源 section but keeps the rest', () => {
    expect(stripSourceSection('## 摘要\n內文\n\n## 來源\n- [[日記/x.md]]\n- 另一條')).toBe('## 摘要\n內文')
  })

  it('removes a middle 來源 section up to the next heading', () => {
    expect(stripSourceSection('## 摘要\n甲\n\n## 來源\n- x\n\n## 細節\n乙')).toBe('## 摘要\n甲\n\n## 細節\n乙')
  })

  it('leaves bodies without a source section alone, and does not touch 來源 in other heading levels or text', () => {
    expect(stripSourceSection('## 摘要\n資料來源很重要')).toBe('## 摘要\n資料來源很重要')
    expect(stripSourceSection('### 來源\n- x')).toBe('### 來源\n- x')
    expect(stripSourceSection('## 來源說明\n- x')).toBe('## 來源說明\n- x')
  })

  it('handles a body that is only a source section', () => {
    expect(stripSourceSection('## 來源\n- x')).toBe('')
  })
})

describe('attachmentKind', () => {
  it.each([
    ['附件/a.PNG', 'image'], ['附件/a.jpeg', 'image'], ['附件/a.webp', 'image'],
    ['附件/公文.pdf', 'pdf'], ['附件/x.txt', 'text'], ['附件/x.md', 'text'],
    ['附件/x.docx', 'other'], ['附件/x.html', 'other'], ['附件/noext', 'other'],
  ])('%s → %s', (p, k) => { expect(attachmentKind(p)).toBe(k) })
})
