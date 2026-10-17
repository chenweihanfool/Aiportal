// 案件頁的「任務系統」標記（kb-pipeline case-task-state.py 依 Vikunja 專案封存狀態寫入，清單 6b）。
// 入口網只顯示：只放行這兩個值，其他一律當沒有標記（pusher 是外部輸入，不原樣吐給前端）。
export type CaseTaskState = "進行中" | "已結案"

export function sanitizeCaseTaskState(v: unknown): CaseTaskState | null {
  return v === "進行中" || v === "已結案" ? v : null
}
