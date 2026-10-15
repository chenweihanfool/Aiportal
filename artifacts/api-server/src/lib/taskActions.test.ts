import { describe, expect, it } from "vitest";
import { parseTaskActionsRow } from "./taskActions";

describe("parseTaskActionsRow", () => {
  it("四欄齊全才回數字", () => {
    expect(parseTaskActionsRow({ tasks_overdue: 2, tasks_due_today: 1, tasks_due_next7: 4, tasks_done_week: 9 })).toEqual({ overdue: 2, dueToday: 1, dueNext7: 4, doneWeek: 9 });
  });
  it("0 是有效值", () => {
    expect(parseTaskActionsRow({ tasks_overdue: 0, tasks_due_today: 0, tasks_due_next7: 0, tasks_done_week: 0 })).not.toBeNull();
  });
  it("舊資料列（NULL）、缺欄、負數、沒有資料列都回 null", () => {
    expect(parseTaskActionsRow({ tasks_overdue: null, tasks_due_today: null, tasks_due_next7: null, tasks_done_week: null })).toBeNull();
    expect(parseTaskActionsRow({ tasks_overdue: 1, tasks_due_today: 1, tasks_due_next7: 1 })).toBeNull();
    expect(parseTaskActionsRow({ tasks_overdue: -1, tasks_due_today: 1, tasks_due_next7: 1, tasks_done_week: 1 })).toBeNull();
    expect(parseTaskActionsRow(undefined)).toBeNull();
  });
});
