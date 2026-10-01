// 概念／方法節點（知識抽象層）：從 events 讀取時反推，跟人／案／物同一個
// 原則——events 是唯一真相來源，不另存、不遷移。
//
// kb-pipeline 的 hermes-graph-pusher 會在每個事件上帶 `concepts`／`methods`
// （`[{name, relation?}]`，名稱已是管線合併後的標準名）。舊事件或舊版 pusher
// 推上來的資料沒有這兩個欄位，一律當成空陣列，不報錯。
//
// 「晉升」門檻跟管線一致：同一個名稱出現在 ≥2 個事件才算正式的概念／方法
// （promoted）；只出現 1 次的是候選，UI 預設不顯示，避免單次語意判斷的雜訊
// 把圖面灌滿（對應專案目標 3：成本效益，先看已被重複驗證的）。

export const PROMOTE_THRESHOLD = 2;

export interface AbstractionNode {
  name: string;
  eventCount: number;
  promoted: boolean;
}

export interface ConceptEdge { eventId: string; concept: string; relation: string | null }
export interface MethodEdge { eventId: string; method: string; relation: string | null }

export interface DerivedAbstractions {
  concepts: AbstractionNode[];
  methods: AbstractionNode[];
  conceptEdges: ConceptEdge[];
  methodEdges: MethodEdge[];
}

interface Ref { name: string; relation: string | null }

/** 容忍各種髒資料：非陣列、字串簡寫、缺 name、空白名稱、事件內重複。 */
export function normalizeRefs(raw: unknown): Ref[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Ref[] = [];
  for (const item of raw) {
    let name = "";
    let relation: string | null = null;
    if (typeof item === "string") {
      name = item;
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      if (typeof o["name"] === "string") name = o["name"];
      if (typeof o["relation"] === "string" && o["relation"].trim()) relation = o["relation"].trim();
    }
    name = name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, relation });
  }
  return out;
}

function aggregate(counts: Map<string, number>): AbstractionNode[] {
  return Array.from(counts, ([name, eventCount]) => ({
    name,
    eventCount,
    promoted: eventCount >= PROMOTE_THRESHOLD,
  })).sort((a, b) => b.eventCount - a.eventCount || a.name.localeCompare(b.name));
}

export function deriveAbstractions(
  events: ReadonlyArray<{ id: string; concepts?: unknown; methods?: unknown }>,
): DerivedAbstractions {
  const conceptCounts = new Map<string, number>();
  const methodCounts = new Map<string, number>();
  const conceptEdges: ConceptEdge[] = [];
  const methodEdges: MethodEdge[] = [];

  for (const ev of events) {
    for (const c of normalizeRefs(ev.concepts)) {
      conceptCounts.set(c.name, (conceptCounts.get(c.name) ?? 0) + 1);
      conceptEdges.push({ eventId: ev.id, concept: c.name, relation: c.relation });
    }
    for (const m of normalizeRefs(ev.methods)) {
      methodCounts.set(m.name, (methodCounts.get(m.name) ?? 0) + 1);
      methodEdges.push({ eventId: ev.id, method: m.name, relation: m.relation });
    }
  }

  return {
    concepts: aggregate(conceptCounts),
    methods: aggregate(methodCounts),
    conceptEdges,
    methodEdges,
  };
}
