import type { PusherHealth } from "@workspace/db"

// 入口網推送健康（kb-pipeline 的 kbcore/portal_push.health()，由 status pusher 帶上）：驗證、截斷後原樣存。
// 不是陣列就回 null（舊 pusher 不送這欄），讀端不顯示這區。
const LEVELS = new Set(["ok", "warn", "crit"])
const s = (v: unknown, max: number): string | null => (typeof v === "string" && v ? v.slice(0, max) : null)
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

export function parsePushers(raw: unknown): PusherHealth[] | null {
  if (!Array.isArray(raw)) return null
  return raw.slice(0, 50).flatMap((x) => {
    const o = (x ?? {}) as Record<string, unknown>
    const feed = s(o["feed"], 40)
    if (!feed) return []
    const level = LEVELS.has(o["level"] as string) ? (o["level"] as PusherHealth["level"]) : "warn"
    return [{
      feed, level, path: s(o["path"], 80), lastOk: s(o["lastOk"], 40), lastFail: s(o["lastFail"], 40),
      lastError: s(o["lastError"], 200), ageMin: n(o["ageMin"]), expectedEveryMin: n(o["expectedEveryMin"]),
      bytes: n(o["bytes"]), okCount: n(o["okCount"]) ?? 0, failCount: n(o["failCount"]) ?? 0,
    }]
  })
}
