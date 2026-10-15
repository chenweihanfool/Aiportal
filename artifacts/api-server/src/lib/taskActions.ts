// 任務面向的「可行動數字」（P2-6）：kb-pipeline 的 compute_daily.py 每天算好，寫在
// busyness_index_history 的 tasks_* 四欄（欄位由 Python 端的 ensure_schema 新增，TS 的 drizzle 表不宣告它，
// 所以這裡用原生 SQL 讀，欄位還沒建或值是 NULL 都當作「沒有」，不讓整個任務面向壞掉）。
export interface TaskActions {
  overdue: number; // 未完成、到期日早於今天
  dueToday: number;
  dueNext7: number; // 明天～7 天後到期
  doneWeek: number; // 近 7 天（含今天）完成
}

export const TASK_ACTIONS_SQL =
  "SELECT tasks_overdue, tasks_due_today, tasks_due_next7, tasks_done_week FROM busyness_index_history WHERE date = $1";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** 四欄都是非負整數才算有資料；任何一欄缺就整組回 null（不拼出半套數字） */
export function parseTaskActionsRow(row: Record<string, unknown> | undefined): TaskActions | null {
  if (!row) return null;
  const overdue = num(row["tasks_overdue"]);
  const dueToday = num(row["tasks_due_today"]);
  const dueNext7 = num(row["tasks_due_next7"]);
  const doneWeek = num(row["tasks_done_week"]);
  if (overdue === null || dueToday === null || dueNext7 === null || doneWeek === null) return null;
  return { overdue, dueToday, dueNext7, doneWeek };
}
