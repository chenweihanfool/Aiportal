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
// 2026-09-19 — L5 轉型「圖譜編織層」：People/Objects/Cases 樞紐檔的
// 「## 圖譜敘事」（weave，增補式編織）+「## 🧠 ...」（alert，時效警報）
// 合併成同一個陣列，用 type 分辨，見 hermesGraphSnapshot.ts 的欄位說明。
export interface HermesGraphHubNarrative {
  hub: string
  kind: 'person' | 'case' | 'object'
  date: string
  type: 'weave' | 'alert'
  text: string
}
// 2026-09-21 — L5 TASK D「樞紐觀察評價」：跟 hubNarratives 平行但語意相
// 反——敘事是累積時間軸，這是每輪整段覆寫的單一快照（第一人稱、≤300 字），
// 每個樞紐正常只有 0 或 1 筆，見 hermesGraphSnapshot.ts 的欄位說明。
export interface HermesGraphHubAssessment {
  hub: string
  kind: 'person' | 'case' | 'object'
  date: string
  text: string
}

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
    hubNarratives: HermesGraphHubNarrative[]
    hubAssessments: HermesGraphHubAssessment[]
  }
}

export async function apiFetchHermesGraph(adminPassword: string): Promise<HermesGraphData> {
  const r = await fetch(`${API_BASE}api/hermes-graph`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch hermes graph')
  return r.json() as Promise<HermesGraphData>
}
