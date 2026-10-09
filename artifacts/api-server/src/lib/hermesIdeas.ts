import type { HermesIdea, HermesIdeasWeek } from "@workspace/db"

// 💡 想法庫：驗證 HERMES 推上來的快照，並在讀取時套上「補短板」加成排出前三名。
// 公式在 kb-pipeline 的 kbcore/ideas.py（priority），baseScore 已含 價值×可行×新鮮度×被想起×進行中；
// 這裡只乘「類別對到幸福指數最弱維度 ×1.3」——最弱維度只有入口網知道。
// 使用者 2026-10-09：系統／工作改善類也一起排，只用徽章標出類別。

export const WEAK_BOOST = 1.3
export const OPEN_STATUSES = ["new", "evaluating", "doing"] as const
const STATUSES = ["new", "evaluating", "doing", "done", "shelved", "dropped"] as const

export interface RankedIdea extends HermesIdea {
  score: number | null
  scoreWhy: string[]
  weakBoost: boolean
}

const str = (v: unknown, max = 500): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null)
const int15 = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null)
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
const strArr = (v: unknown, max = 50): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max).map((x) => x.slice(0, 300)) : []

export function sanitizeIdeasPayload(body: unknown): { ideas: HermesIdea[]; weeks: HermesIdeasWeek[]; generatedAt: string | null } | string {
  if (!body || typeof body !== "object") return "body 不是物件"
  const b = body as Record<string, unknown>
  if (!Array.isArray(b["ideas"])) return "ideas 不是陣列"
  const ideas: HermesIdea[] = []
  for (const raw of (b["ideas"] as unknown[]).slice(0, 2000)) {
    if (!raw || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    const id = str(r["id"], 20)
    const title = str(r["title"], 120)
    const bornAt = str(r["bornAt"], 40)
    const status = r["status"]
    if (!id || !/^IDEA-\d{4,}$/.test(id) || !title || !bornAt || !STATUSES.includes(status as never)) continue
    const history = Array.isArray(r["history"])
      ? (r["history"] as unknown[]).flatMap((h) => {
          const o = (h ?? {}) as Record<string, unknown>
          const s = str(o["status"], 20)
          const at = str(o["at"], 40)
          return s && at ? [{ status: s, at }] : []
        }).slice(0, 100)
      : []
    ideas.push({
      id, title, bornAt, status: status as HermesIdea["status"],
      category: str(r["category"], 30), dimension: str(r["dimension"], 30), source: str(r["source"], 30),
      why: str(r["why"], 500), value: int15(r["value"]), effort: int15(r["effort"]),
      lastMentioned: str(r["lastMentioned"], 40) ?? bornAt,
      mentions: typeof r["mentions"] === "number" && r["mentions"] >= 1 ? Math.floor(r["mentions"]) : 1,
      backfill: r["backfill"] === true, days: strArr(r["days"], 200), history,
      baseScore: num(r["baseScore"]), baseWhy: strArr(r["baseWhy"], 10),
    })
  }
  const weeks: HermesIdeasWeek[] = Array.isArray(b["weeks"])
    ? (b["weeks"] as unknown[]).flatMap((w) => {
        const o = (w ?? {}) as Record<string, unknown>
        const ws = str(o["weekStart"], 10)
        return ws && /^\d{4}-\d{2}-\d{2}$/.test(ws)
          ? [{ weekStart: ws, born: Math.max(0, Math.floor(num(o["born"]) ?? 0)), done: Math.max(0, Math.floor(num(o["done"]) ?? 0)) }]
          : []
      }).slice(-52)
    : []
  return { ideas, weeks, generatedAt: str(b["generatedAt"], 10) }
}

export function rankIdeas(ideas: HermesIdea[], weakest: string | null): { ideas: RankedIdea[]; top: string[] } {
  const ranked: RankedIdea[] = ideas.map((it) => {
    const open = (OPEN_STATUSES as readonly string[]).includes(it.status)
    if (!open || it.baseScore === null) return { ...it, score: null, scoreWhy: [], weakBoost: false }
    const weakBoost = !!weakest && it.dimension === weakest
    const score = Math.round(it.baseScore * (weakBoost ? WEAK_BOOST : 1) * 100) / 100
    const scoreWhy = weakBoost ? [...it.baseWhy, `補短板：「${weakest}」是幸福指數最弱項 ×${WEAK_BOOST}`] : [...it.baseWhy]
    return { ...it, score, scoreWhy, weakBoost }
  })
  const top = ranked
    .filter((r) => r.score !== null)
    .sort((a, b) => b.score! - a.score! || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map((r) => r.id)
  return { ideas: ranked, top }
}
