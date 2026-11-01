import { describe, expect, it } from 'vitest'
import { buildIndex } from './graphInsights'
import type { HermesGraphData } from './hermesGraphApi'
import { SELF_NAME, agoText, dossier, overview, prepForTask, prepIsEmpty, search } from './relationsView'

type Graph = NonNullable<HermesGraphData['graph']>

const graph: Graph = {
  people: [{ name: SELF_NAME, eventCount: 3 }, { name: '王小明', eventCount: 2 }, { name: '林大華', eventCount: 1 }],
  events: [
    { id: 'e1', date: '2026-10-01', title: '致民段界址鑑界會勘', status: null, tags: [], case: '致民段分割案' },
    { id: 'e2', date: '2026-10-20', title: '致民段成果檢核', status: null, tags: [], case: '致民段分割案' },
    { id: 'e3', date: '2026-10-25', title: '舊案歸檔', status: null, tags: [], case: '舊案' },
    { id: 'e4', date: '', title: '日期不明的事', status: null, tags: [], case: '狀態結案' },
  ],
  cases: [
    { name: '致民段分割案', eventCount: 2, status: 'active', taskState: '進行中' },
    { name: '舊案', eventCount: 1, status: 'active', taskState: '已結案' },
    { name: '狀態結案', eventCount: 1, status: '已結案' },
  ],
  objects: [],
  edges: [
    { person: SELF_NAME, eventId: 'e1', role: '承辦' }, { person: '王小明', eventId: 'e1', role: '同事' },
    { person: SELF_NAME, eventId: 'e2', role: '承辦' }, { person: '王小明', eventId: 'e2', role: '同事' },
    { person: SELF_NAME, eventId: 'e3', role: '承辦' }, { person: '林大華', eventId: 'e3', role: '同事' },
  ],
  caseEdges: [{ eventId: 'e1', case: '致民段分割案' }, { eventId: 'e2', case: '致民段分割案' }, { eventId: 'e3', case: '舊案' }, { eventId: 'e4', case: '狀態結案' }],
  objectEdges: [],
  methods: [{ name: '界址鑑界會勘流程', eventCount: 2, promoted: true }, { name: '鑑界會勘候選', eventCount: 1, promoted: false }],
  methodEdges: [
    { eventId: 'e1', method: '界址鑑界會勘流程', relation: null }, { eventId: 'e2', method: '界址鑑界會勘流程', relation: null },
    { eventId: 'e1', method: '鑑界會勘候選', relation: null },
  ],
  personRelations: [],
  hubNarratives: [],
  hubAssessments: [{ hub: '王小明', kind: 'person', date: '2026-10-21', text: '重要合作對象' }],
}
const index = buildIndex(graph)
const task = (title: string, extra: Partial<{ project: string; why: string; next: string }> = {}) =>
  ({ title, project: extra.project ?? null, due: null, why: extra.why ?? null, next: extra.next ?? null })

describe('dossier', () => {
  it('人物卷宗：最新事件在前、不列本人、相關案件與已晉升方法', () => {
    const d = dossier(index, 'person', '王小明', '2026-10-30')
    expect(d.events.map((e) => e.id)).toEqual(['e2', 'e1'])
    expect(d.lastDate).toBe('2026-10-20')
    expect(d.daysSince).toBe(10)
    expect(d.people).toEqual([])
    expect(d.cases).toEqual([{ name: '致民段分割案', count: 2 }])
    expect(d.methods).toEqual(['界址鑑界會勘流程'])
    expect(d.assessment).toBe('重要合作對象')
  })
  it('案件卷宗：列相關的人與狀態', () => {
    const d = dossier(index, 'case', '致民段分割案', '2026-10-30')
    expect(d.people).toEqual([{ name: '王小明', count: 2 }])
    expect(d.stateLabel).not.toBeNull()
  })
  it('不存在的名稱回空卷宗', () => {
    const d = dossier(index, 'person', '沒這個人', '2026-10-30')
    expect(d.total).toBe(0)
    expect(d.daysSince).toBeNull()
  })
})

describe('overview／search', () => {
  it('最近的人排前面、不列本人；已結案的案件不列', () => {
    const o = overview(index)
    expect(o.people.map((p) => p.name)).toEqual(['林大華', '王小明'])
    expect(o.cases.map((c) => c.name)).toEqual(['致民段分割案'])
  })
  it('搜尋人和案都找得到，案件含已結案；空字串不回結果', () => {
    expect(search(index, '舊案').map((r) => r.kind)).toEqual(['case'])
    expect(search(index, '王').map((r) => r.name)).toEqual(['王小明'])
    expect(search(index, SELF_NAME)).toEqual([])
    expect(search(index, '  ')).toEqual([])
  })
})

describe('prepForTask', () => {
  it('對到提到的人、用詞相近的案件、已晉升方法與最近事件', () => {
    const p = prepForTask(index, task('致民段分割案送件', { next: '先問王小明' }))
    expect(p.people).toEqual(['王小明'])
    expect(p.cases).toEqual(['致民段分割案'])
    expect(p.events.map((e) => e.id)).toEqual(['e2', 'e1'])
    expect(prepIsEmpty(p)).toBe(false)
    expect(prepForTask(index, task('界址鑑界會勘排程')).methods).toEqual(['界址鑑界會勘流程'])
  })
  it('對不到就是空，不用本人名字硬湊', () => {
    const p = prepForTask(index, task('買便當', { why: SELF_NAME }))
    expect(prepIsEmpty(p)).toBe(true)
  })
})

describe('agoText', () => {
  it('今天、昨天、n 天前、不明', () => {
    expect([agoText(0), agoText(1), agoText(5), agoText(null)]).toEqual(['今天', '昨天', '5 天前', ''])
  })
})
