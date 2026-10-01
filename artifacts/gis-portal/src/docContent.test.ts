import { describe, expect, it } from 'vitest'
import { describeSource, softenWikilinks, stripSourceSection } from './docContent'

describe('softenWikilinks', () => {
  it('turns embeds, diary links, aliases and plain links into readable text', () => {
    expect(softenWikilinks('見 ![[附件/圖 1.jpg]] 與 [[日記/2026-09-04.md]]，[[X/事件名.md|別名]]、[[另一個事件]]。'))
      .toBe('見 📎 圖 1.jpg 與 日記 2026-09-04，別名、另一個事件。')
  })

  it('leaves ordinary markdown and links untouched', () => {
    const md = '## 摘要\n[官網](https://example.com) 與 `code`'
    expect(softenWikilinks(md)).toBe(md)
  })

  it('handles an embed with an alias and trailing slashes', () => {
    expect(softenWikilinks('![[附件/報告.pdf|年度報告]]')).toBe('📎 報告.pdf')
  })
})

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
