// Shared /api/hermes-graph types + fetcher — used by both the compact
// summary panel embedded in the HERMES 戰情室 section (App.tsx) and the
// full-page 3D relationship universe (RelationshipUniverse.tsx). Pulled out
// of App.tsx into its own module specifically so those two files can import
// it without creating a circular App.tsx <-> RelationshipUniverse.tsx
// dependency (App.tsx renders RelationshipUniverse for the #graph route).
const API_BASE = import.meta.env.BASE_URL ?? '/'

export interface HermesGraphPersonNode { name: string; eventCount: number }
export interface HermesGraphEventNode { id: string; date: string; title: string; status: string | null; tags: string[]; case: string | null }
export interface HermesGraphCaseNode { name: string; eventCount: number; status: string | null }
export interface HermesGraphObjectNode { name: string; objectType: string | null; eventCount: number }
export interface HermesGraphEdge { person: string; eventId: string; role: string }
export interface HermesGraphCaseEdge { eventId: string; case: string }
export interface HermesGraphObjectEdge { eventId: string; object: string }
export interface HermesGraphPersonRelation { from: string; to: string; description: string }

export interface HermesGraphMetrics {
  peopleCount: number
  eventsCount: number
  casesCount: number
  objectsCount: number
  avgParticipantsPerEvent: number
  orphanEventRatioPct: number
  trueOrphanEventRatioPct: number
  newEventsThisWeek: number
  newPeopleThisWeek: number
  mostActivePerson: { name: string; eventCount: number } | null
  activeCasesCount: number
  personRelationsCount: number
}

export interface HermesGraphData {
  available: boolean
  computedAt: string | null
  metrics?: HermesGraphMetrics
  graph?: {
    people: HermesGraphPersonNode[]
    events: HermesGraphEventNode[]
    cases: HermesGraphCaseNode[]
    objects: HermesGraphObjectNode[]
    edges: HermesGraphEdge[]
    caseEdges: HermesGraphCaseEdge[]
    objectEdges: HermesGraphObjectEdge[]
    personRelations: HermesGraphPersonRelation[]
  }
}

export async function apiFetchHermesGraph(adminPassword: string): Promise<HermesGraphData> {
  const r = await fetch(`${API_BASE}api/hermes-graph`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch hermes graph')
  return r.json() as Promise<HermesGraphData>
}
