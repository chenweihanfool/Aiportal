// 案件頁的「任務系統」標記（kb-pipeline case-task-state.py 依 Vikunja 專案封存狀態寫入，清單 6b）。
// 入口網只顯示：只放行這兩個值，其他一律當沒有標記（pusher 是外部輸入，不原樣吐給前端）。
export type CaseTaskState = "進行中" | "已結案"

export function sanitizeCaseTaskState(v: unknown): CaseTaskState | null {
  return v === "進行中" || v === "已結案" ? v : null
}

/**
 * 首頁／戰情室「N 進行中」的案件計數：案件頁 status 是 active（沒寫也算 active），而且任務系統標記不是「已結案」。
 * 使用者 2026-10-17：「排除已結案」——標記為已結案（對得上的 Vikunja 專案全部封存）的案件不再算進行中。
 */
export function isActiveCase(status: string | null | undefined, taskState: unknown): boolean {
  return (status ?? "active") === "active" && sanitizeCaseTaskState(taskState) !== "已結案"
}

