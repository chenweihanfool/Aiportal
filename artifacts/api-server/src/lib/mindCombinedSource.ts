import { db, hermesTimelineEntryTable } from "@workspace/db"
import { and, eq, inArray } from "drizzle-orm"
import { loadIdeasMind } from "./ideasMindSource"
import { combineMind, pickLatestReport, type CombinedMind } from "./mindCombined"
import { parseReportScore, type ReportScore } from "./reportScore"

// 幸福指數心智維度的來源（2026-10-10 起）：想法分數＋最新一份日報分數（今天或昨天）。
// 跟 mindCombined.ts 分開放，讓純函式的單元測試不必連資料庫。
export async function loadCombinedMind(today: string): Promise<CombinedMind> {
  const yesterday = shiftDate(today, -1)
  const [ideas, rows] = await Promise.all([
    loadIdeasMind(today).then((m) => m?.score ?? null).catch(() => null),
    db
      .select({ date: hermesTimelineEntryTable.periodKey, bodyMd: hermesTimelineEntryTable.bodyMd })
      .from(hermesTimelineEntryTable)
      .where(and(eq(hermesTimelineEntryTable.level, "day"), inArray(hermesTimelineEntryTable.periodKey, [today, yesterday])))
      .catch(() => [] as Array<{ date: string; bodyMd: string }>),
  ])
  const reports = new Map<string, ReportScore>()
  for (const r of rows) {
    const s = parseReportScore(r.bodyMd)
    if (s) reports.set(r.date, s)
  }
  const report = pickLatestReport(reports, today, yesterday)
  return { score: combineMind(ideas, report?.total ?? null), ideas, report }
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
