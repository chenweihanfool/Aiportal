import { describe, expect, it } from 'vitest'
import { kindOf, parseReportSections, parseTaskLines, splitEntries, splitTitle } from './reportSections'

const WEEK = `# 📅 週報 2026-09-22 ~ 2026-09-28（第40週）

### 📊 本週概覽
本週完成了路徑設定收斂。

### 🔄 模式辨識
連續三天都在處理遷移。

### 📋 任務進度
- 補件通知（逾期 2026-09-20）
- 公文送審 (到期 2026-09-30)
- 整理檢核表

### 👥 人事協同與業務畫像
- **[[王小明]]**（本週角色/頻率）：
  - 協同觀察：常在補件案件互動。
  - 業務指南：地段爭議先問他。
- **[[李大華]]**（偶爾）：
  - 協同觀察：代書。

### 💡 下週觀察重點
觀察遷移是否收尾。
`

describe('parseReportSections', () => {
  const p = parseReportSections(WEEK)
  it('標題與七個段落（含 emoji 圖示、分類）', () => {
    expect(p.title).toContain('週報')
    expect(p.sections.map((s) => [s.icon, s.title, s.kind])).toEqual([
      ['📊', '本週概覽', 'hero'], ['🔄', '模式辨識', 'generic'], ['📋', '任務進度', 'tasks'],
      ['👥', '人事協同與業務畫像', 'people'], ['💡', '下週觀察重點', 'next'],
    ])
    expect(p.sections[0]!.body).toBe('本週完成了路徑設定收斂。')
  })
  it('舊世代：粗體單行當標題、首段是前言', () => {
    const q = parseReportSections('📅 **週報 2026-06-21 ~ 2026-06-27**\n\n**📊 本週重點**\n這週重心在檢核表。\n')
    expect(q.intro).toContain('週報')       // 首行不是「整行粗體」，歸前言；內容不會遺失
    expect(q.sections).toHaveLength(1)
    expect(q.sections[0]).toMatchObject({ icon: '📊', title: '本週重點', kind: 'hero', body: '這週重心在檢核表。' })
  })
  it('沒有任何標題：不拆（呼叫端退回整份 Markdown）', () => {
    const q = parseReportSections('📅 週報 2026-07-05 ~ 2026-07-11\n\n這週的重點是把系統設定整理好。\n')
    expect(q.sections).toEqual([])
    expect(q.intro).toContain('這週的重點')
  })
  it('程式碼區塊裡的 # 不算標題', () => {
    const q = parseReportSections('### 📊 概覽\n看這段：\n```\n### 假標題\n```\n結束。')
    expect(q.sections).toHaveLength(1)
    expect(q.sections[0]!.body).toContain('### 假標題')
  })
  it('月報標題分類', () => {
    expect(['月度主題', '趨勢分析', '目標進度回顧', '長期模式浮現', '下月觀察方向', '本週重點', '下週觀察重點'].map(kindOf))
      .toEqual(['hero', 'generic', 'generic', 'generic', 'next', 'hero', 'next'])
  })
  it('splitTitle：沒有 emoji 就沒有圖示', () => {
    expect(splitTitle('**📊 本週概覽**')).toEqual({ icon: '📊', title: '本週概覽' })
    expect(splitTitle('本週概覽')).toEqual({ icon: null, title: '本週概覽' })
  })
})

describe('parseTaskLines', () => {
  it('逾期／到期日拆成徽章，其他照原樣；沒有清單回 null', () => {
    const t = parseTaskLines(parseReportSections(WEEK).sections[2]!.body)!
    expect(t).toEqual([
      { text: '補件通知', kind: 'overdue', date: '2026-09-20' },
      { text: '公文送審', kind: 'due', date: '2026-09-30' },
      { text: '整理檢核表', kind: 'plain', date: null },
    ])
    expect(parseTaskLines('這週沒有逾期任務。')).toBeNull()
  })
})

describe('splitEntries', () => {
  it('人物：頂層清單項目各成一張卡，縮排內容歸該卡', () => {
    const e = splitEntries(parseReportSections(WEEK).sections[3]!.body)!
    expect(e).toHaveLength(2)
    expect(e[0]!.head).toContain('王小明')
    expect(e[0]!.body).toContain('業務指南')
    expect(e[1]!.body).toContain('代書')
  })
  it('沒有這種結構回 null（例如「本週以獨立作業為主」一句話）', () => {
    expect(splitEntries('本週以獨立作業與常規流程為主，無新增顯著人物協同模式。')).toBeNull()
  })
})
