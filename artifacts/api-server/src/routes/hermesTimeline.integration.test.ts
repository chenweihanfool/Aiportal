// 時間軸 API 整合測試：掛上真實路由、對真實 Postgres 驗證 upsert／分頁／單筆／權限。
// 預設跳過。執行方式（只准對「拋棄式」資料庫）：
//   TEST_DATABASE_URL=postgres://.../aiportal_test pnpm exec vitest run src/routes/hermesTimeline.integration.test.ts
// 安全閘：資料庫名必須以 `_test` 結尾，否則整組測試拒絕執行（測試會清空並寫入相關資料表）。
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB = process.env["TEST_DATABASE_URL"];
const dbName = TEST_DB ? new URL(TEST_DB).pathname.replace(/^\//, "") : "";
const enabled = Boolean(TEST_DB) && dbName.endsWith("_test");
if (TEST_DB && !enabled) throw new Error(`拒絕執行：資料庫名「${dbName}」不是以 _test 結尾`);

const PWD = "integration-test-pwd";

describe.skipIf(!enabled)("hermes-timeline API（真實 Postgres）", () => {
  let server: Server;
  let base = "";
  let db: typeof import("@workspace/db");

  const post = (entries: unknown[], pwd: string | null = PWD) =>
    fetch(`${base}/api/admin/hermes-timeline`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(pwd ? { "x-admin-password": pwd } : {}) },
      body: JSON.stringify({ entries }),
    });
  const get = (path: string, pwd: string | null = PWD) =>
    fetch(`${base}/api${path}`, { headers: pwd ? { "x-admin-password": pwd } : {} });
  const ent = (level: string, periodKey: string, startDate: string, endDate: string, over: Record<string, unknown> = {}) => ({
    level, periodKey, startDate, endDate, title: periodKey, summary: `摘要 ${periodKey}`, bodyMd: `# 原文 ${periodKey}`,
    generation: 3, rangeInferred: false, periodNote: null, sourcePath: `x/${periodKey}.md`, contentHash: `hash-${periodKey}-v1`, ...over,
  });

  beforeAll(async () => {
    process.env["DATABASE_URL"] = TEST_DB;
    process.env["ADMIN_PASSWORD"] = PWD;
    db = await import("@workspace/db");
    const express = (await import("express")).default;
    const router = (await import("./hermesTimeline")).default;
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use("/api", router);
    await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise((r) => server?.close(r)); });
  beforeEach(async () => {
    await db.db.delete(db.hermesTimelineEntryTable);
    await db.db.delete(db.hermesGraphSnapshotTable);
    await db.db.delete(db.mindIndexHistoryTable);
    await db.db.delete(db.happinessIndexHistoryTable);
  });

  it("requires the admin password for POST and both GETs", async () => {
    expect((await post([ent("day", "2026-09-28", "2026-09-28", "2026-09-28")], null)).status).toBe(403);
    expect((await post([ent("day", "2026-09-28", "2026-09-28", "2026-09-28")], "wrong")).status).toBe(403);
    expect((await get("/hermes-timeline", null)).status).toBe(403);
    expect((await get("/hermes-timeline/day/2026-09-28", "wrong")).status).toBe(403);
  });

  it("upserts idempotently and updates in place (same key, new content)", async () => {
    expect((await post([ent("day", "2026-09-28", "2026-09-28", "2026-09-28")])).status).toBe(200);
    expect((await post([ent("day", "2026-09-28", "2026-09-28", "2026-09-28", { title: "改過", summary: "新摘要", contentHash: "hash-v2-xxxx" })])).status).toBe(200);
    const rows = await db.db.select().from(db.hermesTimelineEntryTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "改過", summary: "新摘要", contentHash: "hash-v2-xxxx", bodyMd: "# 原文 2026-09-28" });
  });

  it("rejects an invalid batch atomically (nothing is written)", async () => {
    const r = await post([ent("day", "2026-09-28", "2026-09-28", "2026-09-28"), ent("nope", "x", "2026-09-28", "2026-09-28")]);
    expect(r.status).toBe(400);
    expect(await db.db.select().from(db.hermesTimelineEntryTable)).toHaveLength(0);
  });

  it("list returns summaries only (no body), merges events/scores/placeholders, hides future events", async () => {
    await post([ent("day", "2026-09-28", "2026-09-28", "2026-09-28"), ent("day", "2026-09-27", "2026-09-27", "2026-09-27")]);
    await db.db.insert(db.hermesGraphSnapshotTable).values({
      id: "latest", events: [
        { id: "e1", date: "2026-09-28", title: "甲", caseNo: null, case: null, location: null, status: null, tags: [], participants: [], objects: [] },
        { id: "e2", date: "2026-09-26", title: "乙", caseNo: null, case: null, location: null, status: null, tags: [], participants: [], objects: [] },
        { id: "e3", date: "2099-01-01", title: "未來", caseNo: null, case: null, location: null, status: null, tags: [], participants: [], objects: [] },
      ],
    });
    const body = await (await get("/hermes-timeline?level=day")).json() as { items: Array<Record<string, unknown>>; nextCursor: string | null };
    expect(body.items.map((i) => i["periodKey"])).toEqual(["2026-09-28", "2026-09-27", "2026-09-26"]);
    expect(body.items.every((i) => !("bodyMd" in i))).toBe(true);
    expect(body.items[0]).toMatchObject({ hasReport: true, eventCount: 1, reportScore: null });
    expect(body.items[2]).toMatchObject({ hasReport: false, eventCount: 1 });
    expect(JSON.stringify(body)).not.toContain("未來");
  });

  it("day list and detail carry the daily report score parsed from the 📊 section", async () => {
    const scored = "🌙 每日精煉洞察 2026-09-28\n\n📊 今日評分：65\n- 推進 3：甲\n- 決策 2：乙\n- 卡點 3：丙\n- 覺察 2：丁\n- 能量 3：戊\n";
    await post([ent("day", "2026-09-28", "2026-09-28", "2026-09-28", { bodyMd: scored }), ent("day", "2026-09-27", "2026-09-27", "2026-09-27")]);
    await post([ent("week", "2026-第39週", "2026-09-21", "2026-09-27", { bodyMd: scored })]);
    const list = await (await get("/hermes-timeline?level=day")).json() as { items: Array<{ reportScore: { total: number; parts: Array<{ label: string; value: number }> } | null }> };
    expect(list.items[0]!.reportScore?.total).toBe(65);
    expect(list.items[0]!.reportScore?.parts.map((p) => p.value)).toEqual([3, 2, 3, 2, 3]);
    expect(list.items[1]!.reportScore).toBeNull();                               // 舊日報沒有 📊 段
    const d = await (await get("/hermes-timeline/day/2026-09-28")).json() as { reportScore: { total: number } };
    expect(d.reportScore.total).toBe(65);
    const wk = await (await get("/hermes-timeline?level=week")).json() as { items: Array<Record<string, unknown>> };
    expect(wk.items.every((i) => i["reportScore"] === null)).toBe(true);        // 只有日級有分數
  });

  it("paginates with cursor across the real table", async () => {
    await post(Array.from({ length: 5 }, (_, i) => ent("day", `2026-09-${20 + i}`, `2026-09-${20 + i}`, `2026-09-${20 + i}`)));
    const p1 = await (await get("/hermes-timeline?level=day&limit=2")).json() as { items: Array<{ periodKey: string }>; nextCursor: string };
    const p2 = await (await get(`/hermes-timeline?level=day&limit=2&cursor=${encodeURIComponent(p1.nextCursor)}`)).json() as { items: Array<{ periodKey: string }>; nextCursor: string };
    const p3 = await (await get(`/hermes-timeline?level=day&limit=2&cursor=${encodeURIComponent(p2.nextCursor)}`)).json() as { items: Array<{ periodKey: string }>; nextCursor: string | null };
    expect([...p1.items, ...p2.items, ...p3.items].map((i) => i.periodKey)).toEqual(["2026-09-24", "2026-09-23", "2026-09-22", "2026-09-21", "2026-09-20"]);
    expect(p3.nextCursor).toBeNull();
  });

  it("week list synthesizes placeholders for missing weeks", async () => {
    await post([ent("week", "2026-第26週", "2026-06-21", "2026-06-27"), ent("week", "2026-第28週", "2026-07-05", "2026-07-11")]);
    const body = await (await get("/hermes-timeline?level=week")).json() as { items: Array<{ periodKey: string; hasReport: boolean }> };
    expect(body.items.map((i) => [i.periodKey, i.hasReport])).toEqual([["2026-第28週", true], ["2026-第27週", false], ["2026-第26週", true]]);
  });

  it("detail returns body + children (URL-encoded Chinese key), placeholder day, and 404", async () => {
    await post([
      ent("week", "2026-第40週", "2026-09-22", "2026-09-28", { bodyMd: "# 週報全文" }),
      ent("day", "2026-09-23", "2026-09-23", "2026-09-23"), ent("day", "2026-09-30", "2026-09-30", "2026-09-30"),
    ]);
    const d = await (await get(`/hermes-timeline/week/${encodeURIComponent("2026-第40週")}`)).json() as { bodyMd: string; hasReport: boolean; children: Array<{ periodKey: string }> };
    expect(d).toMatchObject({ bodyMd: "# 週報全文", hasReport: true });
    expect(d.children.map((c) => c.periodKey)).toEqual(["2026-09-23"]);
    await db.db.insert(db.hermesGraphSnapshotTable).values({
      id: "latest", events: [{ id: "e1", date: "2026-09-10", title: "甲", caseNo: null, case: null, location: null, status: null, tags: [], participants: [], objects: [] }],
    });
    const ph = await (await get("/hermes-timeline/day/2026-09-10")).json() as { hasReport: boolean; reportScore: unknown; bodyMd: string; eventCount: number };
    expect(ph).toMatchObject({ hasReport: false, reportScore: null, bodyMd: "", eventCount: 1 });
    expect((await get("/hermes-timeline/day/2020-01-01")).status).toBe(404);
    expect((await get("/hermes-timeline/decade/x")).status).toBe(400);
    expect((await get("/hermes-timeline?level=decade")).status).toBe(400);
  });
});
