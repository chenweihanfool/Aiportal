import { describe, it, expect } from 'vitest'
import {
  buildIndex, shortestPath, personInsight, caseInsight, eventInsight, objectInsight,
  entityEvents, searchNodes, recentActivity, personId, eventId, caseId, objectId, splitId,
} from './graphInsights'
import type { HermesGraphData } from './hermesGraphApi'

// 測資：涵蓋 case 時間軸、共現關係、缺漏關係、橋接點、二度人脈、孤立事件、
// 物件跨案重用——每個分支都至少踩到一次。
type Graph = NonNullable<HermesGraphData['graph']>

function buildGraph(): Graph {
  return {
    people: [
      { name: 'Alice', eventCount: 2 },
      { name: 'Bob', eventCount: 1 },
      { name: 'Carol', eventCount: 1 },
      { name: 'Dave', eventCount: 1 },
      { name: 'Eve', eventCount: 1 },
      { name: 'Frank', eventCount: 3 },
      { name: 'Grace', eventCount: 1 },
      { name: 'Henry', eventCount: 1 },
      { name: 'Ivy', eventCount: 1 },
    ],
    events: [
      { id: 'e1', date: '2026-01-01', title: 'Kickoff', status: null, tags: [], case: 'CaseA' },
      { id: 'e2', date: '2026-01-10', title: 'Followup', status: null, tags: [], case: 'CaseA' },
      { id: 'e3', date: '2026-02-01', title: 'Standalone', status: null, tags: [], case: null },
      { id: 'e4', date: '2026-02-01', title: 'NoOneShowedUp', status: null, tags: [], case: null },
      { id: 'e5', date: '2026-03-01', title: 'CaseBEvent', status: null, tags: [], case: 'CaseB' },
      { id: 'e6', date: '2026-04-01', title: 'FG', status: null, tags: [], case: null },
      { id: 'e7', date: '2026-04-02', title: 'FH', status: null, tags: [], case: null },
      { id: 'e8', date: '2026-04-03', title: 'IF', status: null, tags: [], case: null },
    ],
    cases: [
      { name: 'CaseA', eventCount: 2, status: 'open' },
      { name: 'CaseB', eventCount: 1, status: 'open' },
    ],
    objects: [
      { name: 'Laptop', objectType: 'device', eventCount: 1 },
      { name: 'Car', objectType: 'vehicle', eventCount: 1 },
    ],
    edges: [
      { person: 'Alice', eventId: 'e1', role: 'lead' },
      { person: 'Bob', eventId: 'e1', role: 'support' },
      { person: 'Alice', eventId: 'e2', role: 'lead' },
      { person: 'Carol', eventId: 'e2', role: 'support' },
      { person: 'Dave', eventId: 'e3', role: 'lead' },
      { person: 'Eve', eventId: 'e5', role: 'lead' },
      { person: 'Frank', eventId: 'e6', role: 'lead' },
      { person: 'Grace', eventId: 'e6', role: 'support' },
      { person: 'Frank', eventId: 'e7', role: 'lead' },
      { person: 'Henry', eventId: 'e7', role: 'support' },
      { person: 'Ivy', eventId: 'e8', role: 'lead' },
      { person: 'Frank', eventId: 'e8', role: 'support' },
    ],
    caseEdges: [
      { eventId: 'e1', case: 'CaseA' },
      { eventId: 'e2', case: 'CaseA' },
      { eventId: 'e5', case: 'CaseB' },
    ],
    objectEdges: [
      { eventId: 'e2', object: 'Laptop' },
      { eventId: 'e5', object: 'Car' },
    ],
    personRelations: [
      { from: 'Alice', to: 'Bob', description: '同事' },
    ],
    hubNarratives: [
      { hub: 'CaseA', kind: 'case', date: '2026-01-01', type: 'weave', text: '案件啟動' },
      { hub: 'CaseA', kind: 'case', date: '2026-01-10', type: 'weave', text: '案件跟進' },
    ],
    hubAssessments: [
      { hub: 'Alice', kind: 'person', date: '2026-01-05', text: '早期評價' },
      { hub: 'Alice', kind: 'person', date: '2026-01-12', text: '最新評價' },
      { hub: 'CaseA', kind: 'case', date: '2026-01-10', text: '案件目前評價' },
    ],
  }
}

describe('id helpers', () => {
  it('round-trips kind and name through prefix + splitId', () => {
    expect(splitId(personId('Alice'))).toEqual({ kind: 'person', name: 'Alice' })
    expect(splitId(eventId('e1'))).toEqual({ kind: 'event', name: 'e1' })
    expect(splitId(caseId('CaseA'))).toEqual({ kind: 'case', name: 'CaseA' })
    expect(splitId(objectId('Laptop'))).toEqual({ kind: 'object', name: 'Laptop' })
  })
})

describe('buildIndex', () => {
  const index = buildIndex(buildGraph())

  it('links people to events they participated in', () => {
    // Alice also links directly to Bob via the recorded personRelations edge.
    expect(index.neighbors.get(personId('Alice')))
      .toEqual(new Set([eventId('e1'), eventId('e2'), personId('Bob')]))
  })

  it('links events to their case', () => {
    expect(index.neighbors.get(caseId('CaseA'))?.has(eventId('e1'))).toBe(true)
    expect(index.neighbors.get(caseId('CaseA'))?.has(eventId('e2'))).toBe(true)
  })

  it('sorts caseEvents and objectEvents by date ascending', () => {
    expect(index.caseEvents.get('CaseA')).toEqual(['e1', 'e2'])
  })

  it('records recorded person relations by pair key regardless of order', () => {
    expect(index.relationDescription.get('Alice|Bob')).toBe('同事')
  })

  it('derives co-occurrence for every pair sharing an event', () => {
    expect(index.coEvents.get('Alice|Bob')).toEqual(['e1'])
    expect(index.coEvents.get('Alice|Carol')).toEqual(['e2'])
    expect(index.coEvents.has('Alice|Dave')).toBe(false)
  })

  it('sorts hub narratives newest first', () => {
    const arr = index.narrativesByHub.get(caseId('CaseA'))
    expect(arr?.map(n => n.date)).toEqual(['2026-01-10', '2026-01-01'])
  })

  it('builds a wikilink label lookup for people, cases, objects and reconstructed event titles', () => {
    expect(index.nodeIdByLabel.get('Alice')).toBe(personId('Alice'))
    expect(index.nodeIdByLabel.get('CaseA')).toBe(caseId('CaseA'))
    expect(index.nodeIdByLabel.get('Kickoff')).toBe(eventId('e1'))
    expect(index.nodeIdByLabel.get('2026-01-01_Kickoff')).toBe(eventId('e1'))
  })

  it('keeps only the newest-dated assessment per hub', () => {
    expect(index.currentAssessmentByHub.get(personId('Alice')))
      .toEqual({ date: '2026-01-12', text: '最新評價' })
  })

  it('keys assessments by kind-specific id, not shared across node types', () => {
    expect(index.currentAssessmentByHub.get(caseId('CaseA')))
      .toEqual({ date: '2026-01-10', text: '案件目前評價' })
  })

  it('has no entry for a hub with no assessment', () => {
    expect(index.currentAssessmentByHub.has(personId('Bob'))).toBe(false)
  })
})

describe('shortestPath', () => {
  const index = buildIndex(buildGraph())

  it('returns a single-element path for identical endpoints', () => {
    expect(shortestPath(index, personId('Alice'), personId('Alice'))).toEqual([personId('Alice')])
  })

  it('takes the direct edge when a recorded relation links two people', () => {
    // Alice-Bob has both a shared event and a recorded personRelations edge;
    // the direct edge wins since BFS hits it in one hop.
    expect(shortestPath(index, personId('Alice'), personId('Bob')))
      .toEqual([personId('Alice'), personId('Bob')])
  })

  it('finds the shortest path across a shared event when no direct relation exists', () => {
    expect(shortestPath(index, personId('Alice'), personId('Carol')))
      .toEqual([personId('Alice'), eventId('e2'), personId('Carol')])
  })

  it('returns null when nodes are unreachable', () => {
    expect(shortestPath(index, personId('Alice'), personId('Dave'))).toBeNull()
  })

  it('returns null for a node absent from the graph', () => {
    expect(shortestPath(index, personId('Alice'), personId('Nobody'))).toBeNull()
  })
})

describe('personInsight', () => {
  const index = buildIndex(buildGraph())

  it('lists collaborators ranked by shared-event count', () => {
    const insight = personInsight(index, 'Alice')
    expect(insight.collaborators).toEqual([
      { name: 'Bob', sharedEvents: 1, hasRecordedRelation: true },
      { name: 'Carol', sharedEvents: 1, hasRecordedRelation: false },
    ])
  })

  it('flags co-occurring pairs missing an L3-recorded relation', () => {
    const insight = personInsight(index, 'Alice')
    expect(insight.missingRelations).toEqual([{ name: 'Carol', sharedEvents: 1 }])
  })

  it('finds second-degree contacts reached only through a mutual collaborator', () => {
    const insight = personInsight(index, 'Ivy')
    expect(insight.secondDegree.map(s => s.name).sort()).toEqual(['Grace', 'Henry'])
    expect(insight.secondDegree.find(s => s.name === 'Grace')?.via).toEqual(['Frank'])
  })

  it('detects a bridge node whose removal splits collaborators into disconnected groups', () => {
    const frank = personInsight(index, 'Frank')
    expect(frank.bridgeGroups).toHaveLength(3)
    expect(frank.bridgeGroups.flat().sort()).toEqual(['Grace', 'Henry', 'Ivy'])
  })

  it('reports no bridge groups for a person with at most one collaborator', () => {
    expect(personInsight(index, 'Bob').bridgeGroups).toEqual([])
    expect(personInsight(index, 'Dave').bridgeGroups).toEqual([])
  })

  it('aggregates case participation and first/last event dates', () => {
    const insight = personInsight(index, 'Alice')
    expect(insight.cases).toEqual([{ name: 'CaseA', events: 2 }])
    expect(insight.firstDate).toBe('2026-01-01')
    expect(insight.lastDate).toBe('2026-01-10')
  })

  it('returns nulls and empty collections for a person with no events', () => {
    const insight = personInsight(index, 'Nobody')
    expect(insight).toEqual({
      collaborators: [], missingRelations: [], secondDegree: [], cases: [],
      bridgeGroups: [], firstDate: null, lastDate: null,
    })
  })
})

describe('caseInsight', () => {
  const index = buildIndex(buildGraph())

  it('computes span, longest gap, core team and one-off people', () => {
    const insight = caseInsight(index, 'CaseA', new Date('2026-01-20'))
    expect(insight.firstDate).toBe('2026-01-01')
    expect(insight.lastDate).toBe('2026-01-10')
    expect(insight.spanDays).toBe(9)
    expect(insight.longestGap).toEqual({ days: 9, from: '2026-01-01', to: '2026-01-10' })
    expect(insight.staleDays).toBe(10)
    expect(insight.coreTeam).toEqual([{ name: 'Alice', events: 2 }])
    expect(insight.oneOffPeople.sort()).toEqual(['Bob', 'Carol'])
    expect(insight.objects).toEqual(['Laptop'])
    expect(insight.eventsWithoutPeople).toBe(0)
    expect(insight.totalEvents).toBe(2)
  })

  it('handles a single-event case with zero span', () => {
    const insight = caseInsight(index, 'CaseB', new Date('2026-03-01'))
    expect(insight.spanDays).toBe(0)
    expect(insight.longestGap).toBeNull()
    expect(insight.staleDays).toBe(0)
  })

  it('returns nulls for a case with no events', () => {
    const insight = caseInsight(index, 'CaseNonexistent')
    expect(insight.firstDate).toBeNull()
    expect(insight.spanDays).toBeNull()
    expect(insight.staleDays).toBeNull()
    expect(insight.totalEvents).toBe(0)
  })
})

describe('eventInsight', () => {
  const index = buildIndex(buildGraph())

  it('links to the previous and next event within the same case', () => {
    const insight = eventInsight(index, 'e2')
    expect(insight.prevInCase).toEqual({ id: 'e1', date: '2026-01-01', title: 'Kickoff' })
    expect(insight.nextInCase).toBeNull()
    expect(insight.positionInCase).toEqual({ index: 2, total: 2 })
    expect(insight.gapFromPrev).toBe(9)
    expect(insight.isolated).toBe(false)
  })

  it('finds other events on the same date', () => {
    const insight = eventInsight(index, 'e3')
    expect(insight.sameDay).toEqual([{ id: 'e4', title: 'NoOneShowedUp' }])
  })

  it('marks an event with no participants, case or objects as isolated', () => {
    expect(eventInsight(index, 'e4').isolated).toBe(true)
  })

  it('leaves case-relative fields null for an event without a case', () => {
    const insight = eventInsight(index, 'e3')
    expect(insight.prevInCase).toBeNull()
    expect(insight.nextInCase).toBeNull()
    expect(insight.positionInCase).toBeNull()
    expect(insight.gapFromPrev).toBeNull()
  })
})

describe('objectInsight', () => {
  const index = buildIndex(buildGraph())

  it('lists handlers and cases an object touched', () => {
    const insight = objectInsight(index, 'Laptop')
    expect(insight.handlers.sort((a, b) => a.name.localeCompare(b.name)))
      .toEqual([{ name: 'Alice', events: 1 }, { name: 'Carol', events: 1 }])
    expect(insight.cases).toEqual(['CaseA'])
    expect(insight.reusedAcrossCases).toBe(false)
  })

  it('returns empty insight for an object never referenced', () => {
    const insight = objectInsight(index, 'Nothing')
    expect(insight.handlers).toEqual([])
    expect(insight.firstDate).toBeNull()
    expect(insight.reusedAcrossCases).toBe(false)
  })
})

describe('entityEvents', () => {
  const index = buildIndex(buildGraph())

  it('returns a person’s events', () => {
    expect(entityEvents(index, 'person', 'Alice').map(e => e.id)).toEqual(['e1', 'e2'])
  })

  it('returns a case’s events in date order', () => {
    expect(entityEvents(index, 'case', 'CaseA').map(e => e.id)).toEqual(['e1', 'e2'])
  })

  it('returns an object’s events', () => {
    expect(entityEvents(index, 'object', 'Laptop').map(e => e.id)).toEqual(['e2'])
  })
})

describe('searchNodes', () => {
  const graph = buildGraph()

  it('returns nothing for an empty query', () => {
    expect(searchNodes(graph, '  ', 'person')).toEqual([])
  })

  it('matches case-insensitively across all node types', () => {
    const hits = searchNodes(graph, 'alice', 'person')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ id: personId('Alice'), kind: 'person' })
  })

  it('ranks an earlier substring match before a later one', () => {
    const hits = searchNodes(graph, 'ca', 'case')
    const laptopIndex = hits.findIndex(h => h.id === caseId('CaseA'))
    const nonMatchIndex = hits.findIndex(h => h.id === caseId('CaseB'))
    expect(laptopIndex).toBeLessThan(nonMatchIndex)
  })

  it('respects the result limit', () => {
    const hits = searchNodes(graph, 'e', 'event', 2)
    expect(hits).toHaveLength(2)
  })
})

describe('recentActivity', () => {
  const graph = buildGraph()
  const index = buildIndex(graph)

  it('only includes nodes whose first event is on/after sinceDate, newest first', () => {
    const activity = recentActivity(index, graph, '2026-03-01')
    expect(activity.newPeople.map(p => p.label)).toEqual(['Ivy', 'Henry', 'Frank', 'Grace', 'Eve'])
    expect(activity.newCases.map(c => c.label)).toEqual(['CaseB'])
    expect(activity.newObjects.map(o => o.label)).toEqual(['Car'])
    expect(activity.newEvents.map(e => e.id)).toEqual([eventId('e8'), eventId('e7'), eventId('e6'), eventId('e5')])
  })

  it('excludes narratives and assessments dated before sinceDate', () => {
    const activity = recentActivity(index, graph, '2026-03-01')
    expect(activity.newNarratives).toEqual([])
    expect(activity.refreshedAssessments).toEqual([])
  })

  it('includes narratives and assessments dated on/after sinceDate, newest first', () => {
    const activity = recentActivity(index, graph, '2026-01-01')
    expect(activity.newNarratives.map(n => n.date)).toEqual(['2026-01-10', '2026-01-01'])
    expect(activity.refreshedAssessments.map(a => a.date)).toEqual(['2026-01-12', '2026-01-10', '2026-01-05'])
  })

  it('returns every category empty when sinceDate is after all activity', () => {
    const activity = recentActivity(index, graph, '2026-05-01')
    expect(activity).toEqual({
      newPeople: [], newEvents: [], newCases: [], newObjects: [], newNarratives: [], refreshedAssessments: [],
    })
  })

  it('treats sinceDate as inclusive', () => {
    const activity = recentActivity(index, graph, '2026-03-01')
    expect(activity.newEvents.some(e => e.id === eventId('e5'))).toBe(true)
  })
})
