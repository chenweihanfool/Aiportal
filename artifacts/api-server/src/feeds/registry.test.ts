import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FEED_NAME, FEED_REGISTRY } from "./registry";
import { validateFeedRequest } from "../lib/feedValidate";

// 推送端用的 JSON 檔：<repo>/schemas/feeds/<name>.v<version>.schema.json，必須與登記表一致。
// 改了登記表：UPDATE_SCHEMAS=1 pnpm --filter @workspace/api-server test 重新輸出。
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../schemas/feeds");

describe("feed registry", () => {
  it("名稱合法、版本是正整數、schema 是物件", () => {
    for (const [name, def] of Object.entries(FEED_REGISTRY)) {
      expect(FEED_NAME.test(name), name).toBe(true);
      expect(Number.isInteger(def.version) && def.version >= 1, name).toBe(true);
      expect(typeof def.schema).toBe("object");
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it("schemas/feeds/ 的 JSON 檔與登記表一致（不漂移）", () => {
    if (process.env["UPDATE_SCHEMAS"] === "1") mkdirSync(dir, { recursive: true });
    for (const [name, def] of Object.entries(FEED_REGISTRY)) {
      const file = path.join(dir, `${name}.v${def.version}.schema.json`);
      const want = JSON.stringify(def.schema, null, 2) + "\n";
      if (process.env["UPDATE_SCHEMAS"] === "1") writeFileSync(file, want);
      expect(existsSync(file), `缺 ${file}（跑 UPDATE_SCHEMAS=1 重新輸出）`).toBe(true);
      expect(readFileSync(file, "utf8"), file).toBe(want);
    }
  });

  it("kb-arch-stats：推送端實際產出的形狀通過、缺欄位或多餘欄位被擋", () => {
    const body = (payload: unknown) => ({ schemaVersion: 1, generatedAt: "2026-10-22", payload });
    const ok = { computedAt: "2026-10-22T10:00:00+08:00", nodes: {
      L1: { metrics: [{ label: "候選事件（累計）", value: 5, hint: "x" }, { label: "待處理", value: "1 / 2", tone: "warn" }] },
      L4: { error: "RuntimeError: 找不到收件夾" },
    } };
    expect(validateFeedRequest("kb-arch-stats", body(ok)).ok).toBe(true);
    expect(validateFeedRequest("kb-arch-stats", body({ nodes: {} })).ok).toBe(false);
    expect(validateFeedRequest("kb-arch-stats", body({ ...ok, extra: 1 })).ok).toBe(false);
    expect(validateFeedRequest("kb-arch-stats", body({ computedAt: ok.computedAt, nodes: { L1: { metrics: [{ label: "x" }] } } })).ok).toBe(false);
  });

  it("vikunja-gantt：推送端實際產出的形狀通過、日期格式或多餘欄位被擋", () => {
    const body = (payload: unknown) => ({ schemaVersion: 1, generatedAt: "2026-10-24", payload });
    const task = { id: 8, title: "T8", projectId: 2, start: null, end: null, due: "2026-11-02", done: false, doneAt: null, priority: 5, percentDone: 46 };
    const ok = { computedAt: "2026-10-24T10:00:00+08:00", baseUrl: "https://v.example", doneDays: 30,
      projects: [{ id: 2, title: "生活", color: null }, { id: 1, title: "工作", color: "#e2584f" }], tasks: [task], undatedOpen: 1, truncated: 0 };
    expect(validateFeedRequest("vikunja-gantt", body(ok)).ok).toBe(true);
    expect(validateFeedRequest("vikunja-gantt", body({ ...ok, tasks: [{ ...task, due: "2026-11-02T10:00:00Z" }] })).ok).toBe(false);
    expect(validateFeedRequest("vikunja-gantt", body({ ...ok, tasks: [{ ...task, extra: 1 }] })).ok).toBe(false);
    expect(validateFeedRequest("vikunja-gantt", body({ ...ok, baseUrl: "javascript:alert(1)" })).ok).toBe(false);
  });

  it("tasks-done：推送端實際產出的形狀通過、0 筆或壞日期被擋", () => {
    const body = (payload: unknown) => ({ schemaVersion: 1, generatedAt: "2026-10-25", payload });
    const ok = { computedAt: "2026-10-25T10:00:00+08:00", since: "2026-10-24", days: [{ date: "2026-10-24", count: 1 }, { date: "2026-10-25", count: 2 }] };
    expect(validateFeedRequest("tasks-done", body(ok)).ok).toBe(true);
    expect(validateFeedRequest("tasks-done", body({ ...ok, since: null, days: [] })).ok).toBe(true);
    expect(validateFeedRequest("tasks-done", body({ ...ok, days: [{ date: "2026-10-24", count: 0 }] })).ok).toBe(false);
    expect(validateFeedRequest("tasks-done", body({ ...ok, days: [{ date: "10/24", count: 1 }] })).ok).toBe(false);
    // titles 選填（2026-10-30 起）：帶了也通過、超過每天 30 筆被擋
    expect(validateFeedRequest("tasks-done", body({ ...ok, days: [{ date: "2026-10-24", count: 2, titles: ["甲", "乙"] }] })).ok).toBe(true);
    expect(validateFeedRequest("tasks-done", body({ ...ok, days: [{ date: "2026-10-24", count: 31, titles: Array(31).fill("x") }] })).ok).toBe(false);
  });
});
