import { describe, expect, it } from 'vitest'
import { agoLabel, kindOf, linkifyDates, parseEcho, parseReportSections, parseTaskLines, splitEntries, splitTitle } from './reportSections'

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
    expect(q.title).toContain('週報')       // 首行「📅 **週報 …**」是報告標題，不是段落
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

describe('日報格式', () => {
  it('第三代：emoji 在粗體外的標題（⚡ **狀態與決策**）也算段落', () => {
    const p = parseReportSections('# 🌙 每日精煉洞察 2026-09-28\n\n⚡ **狀態與決策**\n今天主要在整理管線。\n\n🔦 **盲點與懸浮**\n有一件事沒有歸屬。\n')
    expect(p.sections.map((s) => [s.icon, s.title, s.kind])).toEqual([['⚡', '狀態與決策', 'generic'], ['🔦', '盲點與懸浮', 'warn']])
  })
  it('條列模組：- 📝 當日總結（約 90 字）：內容', () => {
    const md = `🌙 每日精煉洞察 2026-10-20
- 📝 當日總結（約 90 字）：上午整理檢核表，下午收斂路徑設定。
- ⚡ 狀態與決策（約 50 字）：偏獨立機制。
- 🔦 盲點與懸浮（約 90 字）：補件通知連日被點名卻無痕滑過。
  第二行延續。
- 🎯 高槓桿行動（約 70 字）：明天先補一份備援清單。
- 🕰️ 歷史共鳴（約 90 字）：一年前同一天也在整理設定。`
    const p = parseReportSections(md)
    expect(p.sections.map((s) => [s.title, s.kind])).toEqual([
      ['當日總結', 'hero'], ['狀態與決策', 'generic'], ['盲點與懸浮', 'warn'], ['高槓桿行動', 'action'], ['歷史共鳴', 'echo'],
    ])
    expect(p.sections[2]!.body).toContain('第二行延續')
    expect(p.sections[0]!.body).toContain('上午整理檢核表')
    expect(p.intro).toContain('每日精煉洞察')
  })
  it('只有兩個條列不當作模組（避免把一般清單拆成卡片）', () => {
    expect(parseReportSections('- 📝 甲：一\n- ⚡ 乙：二\n').sections).toEqual([])
  })
  it('季報／年報標題分類', () => {
    expect(['季度主題', '成長軌跡', '價值觀變化', '核心矛盾', '下季策略方向'].map(kindOf)).toEqual(['hero', 'generic', 'generic', 'warn', 'next'])
    expect(['年度敘事', '關鍵轉折', '身份變化', '年度矛盾', '來年方向'].map(kindOf)).toEqual(['hero', 'generic', 'generic', 'warn', 'next'])
  })
})

describe('日報 🕰️ 歷史共鳴（時間線＋脈絡線）', () => {
  const DAILY = `🌙 每日精煉洞察 2026-10-24
- 📝 當日總結（約 90 字）：上午外業，下午整理。
- ⚡ 狀態與決策（約 50 字）：先收斂。
- 🔦 盲點與懸浮（約 90 字）：無。
- 🕰️ 歷史共鳴（約 40 字）：同一個案子又卡在同一關。
  - [[2026-09-01]]（53 天前）那天和王小明跑北港案 → 今天換成等縣府回文
  - [[2025-10-24]]（365 天前）去年也在月底趕報差 → 今天提早一週做完
  - 〔北港測量案〕□□■□□■□□□□□■（近 12 週出現 3 週）每隔三週冒出來一次
- 💭 靈魂一問（約 50 字）：為什麼？`

  it('子項不會被當成新模組，整段歸在 echo 卡片', () => {
    const { sections } = parseReportSections(DAILY)
    expect(sections.map((s) => s.kind)).toEqual(['hero', 'generic', 'warn', 'echo', 'generic'])
    const echo = sections[3]!
    expect(echo.body.split('\n')).toHaveLength(4)
  })

  it('拆出一句話、過去的日子與脈絡線', () => {
    const echo = parseReportSections(DAILY).sections[3]!
    const { lead, items } = parseEcho(echo.body)
    expect(lead).toBe('同一個案子又卡在同一關。')
    expect(items).toEqual([
      { kind: 'day', date: '2026-09-01', text: '那天和王小明跑北港案 → 今天換成等縣府回文' },
      { kind: 'day', date: '2025-10-24', text: '去年也在月底趕報差 → 今天提早一週做完' },
      { kind: 'thread', name: '北港測量案', cells: [...'□□■□□■□□□□□■'].map((c) => c === '■'), text: '（近 12 週出現 3 週）每隔三週冒出來一次' },
    ])
  })

  it('舊日報沒有子項：純文字日期包成連結，原本已是連結的不重包', () => {
    const { lead, items } = parseEcho('2025-10-24 那天也在趕報差；參見 [[2026-01-02]]。')
    expect(items).toEqual([])
    expect(lead).toBe('[[2025-10-24]] 那天也在趕報差；參見 [[2026-01-02]]。')
    expect(linkifyDates('無日期')).toBe('無日期')
  })

  it('距離標籤以報告日期計算', () => {
    expect(agoLabel('2025-10-24', '2026-10-24')).toBe('一年前')
    expect(agoLabel('2024-10-20', '2026-10-24')).toBe('2 年前')
    expect(agoLabel('2026-04-27', '2026-10-24')).toBe('6 個月前')
    expect(agoLabel('2026-09-01', '2026-10-24')).toBe('53 天前')
    expect(agoLabel('壞日期', '2026-10-24')).toBe('')
  })
})

describe('日報尾端的 📊 今日評分', () => {
  it('自成一段，不黏在最後一個模組裡', () => {
    const md = `- 📝 當日總結：甲。\n- ⚡ 狀態與決策：乙。\n- 😄 當日段子：丙。\n\n📊 今日評分：60\n- 推進 3：外業完成\n- 決策 2：一般`
    const { sections } = parseReportSections(md)
    expect(sections.map((s) => s.title)).toEqual(['當日總結', '狀態與決策', '當日段子', '今日評分'])
    expect(sections[2]!.body).toBe('丙。')
    expect(sections[3]!.body).toBe('60\n- 推進 3：外業完成\n- 決策 2：一般')
  })
})
