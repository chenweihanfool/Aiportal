import { db, hermesIdeasSnapshotTable } from "@workspace/db"
import { eq } from "drizzle-orm"
import { computeIdeasMind, type IdeasMind } from "./ideasMind"

// 讀最新的想法庫快照現算心智分數（想法版）；還沒推過任何想法時回 null（不寫假分數）。
// 跟 ideasMind.ts 分開放，讓純函式的單元測試不必連資料庫。
export async function loadIdeasMind(today: string): Promise<IdeasMind | null> {
  const [row] = await db
    .select({ ideas: hermesIdeasSnapshotTable.ideas })
    .from(hermesIdeasSnapshotTable)
    .where(eq(hermesIdeasSnapshotTable.id, "latest"))
    .limit(1)
  return row && row.ideas.length > 0 ? computeIdeasMind(row.ideas, today) : null
}
