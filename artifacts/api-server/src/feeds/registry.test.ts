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

  it("companion：新欄位（usualGapDays／overdue／names／types）選填，舊推送仍合法，超量被擋", () => {
    const body = (payload: unknown) => ({ schemaVersion: 1, generatedAt: "2026-11-07", payload });
    const old = { computedAt: "2026-11-07T10:00:00+08:00", date: "2026-11-07", onThisDay: [],
      quietPeople: [{ name: "王小明", lastDate: "2026-06-01", daysQuiet: 159, events: 5 }], socialDays: [{ date: "2026-11-06", people: 2 }] };
    expect(validateFeedRequest("companion", body(old)).ok).toBe(true);
    const next = { ...old,
      quietPeople: [{ ...old.quietPeople[0], usualGapDays: 30, overdue: 5.3 }, { name: "李小華", lastDate: "2026-05-01", daysQuiet: 190, events: 2, usualGapDays: null }],
      socialDays: [{ date: "2026-11-06", people: 2, names: ["甲", "乙"], types: { face_to_face: 1, call: 0, text: 1 } }] };
    expect(validateFeedRequest("companion", body(next)).ok).toBe(true);
    const day = (extra: object) => body({ ...old, socialDays: [{ date: "2026-11-06", people: 2, ...extra }] });
    expect(validateFeedRequest("companion", day({ names: Array.from({ length: 21 }, (_, i) => `n${i}`) })).ok).toBe(false);
    expect(validateFeedRequest("companion", day({ types: { face_to_face: 1, call: 0 } })).ok).toBe(false);
    expect(validateFeedRequest("companion", day({ types: { face_to_face: 1, call: 0, text: 1, other: 1 } })).ok).toBe(false);
    expect(validateFeedRequest("companion", body({ ...old, quietPeople: [{ ...old.quietPeople[0], usualGapDays: 0 }] })).ok).toBe(false);
    // 只有社交紀錄、沒有事件連到人物頁的人 events＝0 要能過（kb-pipeline companion v2）；負數仍擋
    expect(validateFeedRequest("companion", body({ ...old, quietPeople: [{ ...old.quietPeople[0], events: 0, lastEvent: null }] })).ok).toBe(true);
    expect(validateFeedRequest("companion", body({ ...old, quietPeople: [{ ...old.quietPeople[0], events: -1 }] })).ok).toBe(false);
  });

  it("topic-nudges：新選填欄位（why／at／matchedBy／caseName／resumes）通過，舊格式仍合法，壞值或超量被擋", () => {
    const body = (payload: unknown) => ({ schemaVersion: 1, generatedAt: "2026-11-13", payload });
    const match = {
      forDate: "2026-11-13", topicId: "T1", name: "鑑界", path: ["法務"], published: true, point: "重點",
      triggers: [{ kind: "task", title: "送件", due: "2026-11-13" }], score: 80,
    };
    const old = { computedAt: "2026-11-13T10:00:00+08:00", date: "2026-11-13", matches: [match], recall: [] };
    expect(validateFeedRequest("topic-nudges", body(old)).ok).toBe(true);

    const resume = {
      forDate: "2026-11-13", at: "09:30", caseName: "王案", quietDays: 3, why: "停了三天",
      events: [{ date: "2026-11-10", title: "議價" }],
    };
    const next = {
      ...old,
      matches: [{ ...match, why: "今天要送件", at: "09:30", matchedBy: "case", caseName: "王案" }],
      resumes: [resume, { ...resume, at: null }],
    };
    expect(validateFeedRequest("topic-nudges", body(next)).ok).toBe(true);
    expect(validateFeedRequest("topic-nudges", body({ ...old, matches: Array(16).fill(match) })).ok).toBe(true);
    expect(validateFeedRequest("topic-nudges", body({ ...old, matches: [{ ...match, matchedBy: "terms", at: null, caseName: null }] })).ok).toBe(true);

    const m = (extra: object) => body({ ...old, matches: [{ ...match, ...extra }] });
    expect(validateFeedRequest("topic-nudges", m({ at: "24:00" })).ok).toBe(false);
    expect(validateFeedRequest("topic-nudges", m({ why: "x".repeat(161) })).ok).toBe(false);
    expect(validateFeedRequest("topic-nudges", m({ why: "" })).ok).toBe(false);
    expect(validateFeedRequest("topic-nudges", m({ matchedBy: "other" })).ok).toBe(false);
    expect(validateFeedRequest("topic-nudges", m({ caseName: "" })).ok).toBe(false);
    expect(validateFeedRequest("topic-nudges", body({ ...old, matches: Array(17).fill(match) })).ok).toBe(false);
    expect(validateFeedRequest("topic-nudges", body({ ...next, resumes: Array(7).fill(resume) })).ok).toBe(false);
    expect(validateFeedRequest("topic-nudges", body({ ...next, resumes: [{ ...resume, quietDays: -1 }] })).ok).toBe(false);
    expect(validateFeedRequest("topic-nudges", body({ ...next, resumes: [{ ...resume, events: Array(4).fill({ date: "2026-11-10", title: "x" }) }] })).ok).toBe(false);
    const missing = { forDate: resume.forDate, at: resume.at, caseName: resume.caseName, why: resume.why, events: resume.events };
    expect(validateFeedRequest("topic-nudges", body({ ...next, resumes: [missing] })).ok).toBe(false);
  });
});
