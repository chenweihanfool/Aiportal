// 內容層 API 整合測試：掛上真實路由、對真實 Postgres 驗證 upsert／單筆／概念脈絡組裝／權限。
// 預設跳過。執行方式（只准對「拋棄式」資料庫）：
//   TEST_DATABASE_URL=postgres://.../aiportal_test pnpm exec vitest run src/routes/hermesDoc.integration.test.ts
// 安全閘：資料庫名必須以 `_test` 結尾，否則整組測試拒絕執行（測試會清空並寫入相關資料表）。
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB = process.env["TEST_DATABASE_URL"];
const dbName = TEST_DB ? new URL(TEST_DB).pathname.replace(/^\//, "") : "";
const enabled = Boolean(TEST_DB) && dbName.endsWith("_test");
if (TEST_DB && !enabled) throw new Error(`拒絕執行：資料庫名「${dbName}」不是以 _test 結尾`);

const PWD = "integration-test-pwd";

describe.skipIf(!enabled)("hermes-doc API（真實 Postgres）", () => {
  let server: Server;
  let base = "";
  let db: typeof import("@workspace/db");

  const post = (docs: unknown[], pwd: string | null = PWD) =>
    fetch(`${base}/api/admin/hermes-doc`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(pwd ? { "x-admin-password": pwd } : {}) },
      body: JSON.stringify({ docs }),
    });
  const get = (path: string, pwd: string | null = PWD) =>
    fetch(`${base}/api${path}`, { headers: pwd ? { "x-admin-password": pwd } : {} });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = async (r: Response) => (await r.json()) as Record<string, any>
  const ev = (key: string, over: Record<string, unknown> = {}) => ({
    kind: "event", key, title: `事件 ${key}`, bodyMd: `## 摘要\n${key} 的內文`, truncated: false,
    meta: { date: "2026-09-01", sources: [{ type: "diary", path: "日記/2026-09-01.md" }] },
    sourcePath: `Events/${key}.md`, contentHash: `hash-${key}-v1`, ...over,
  });

  beforeAll(async () => {
    process.env["DATABASE_URL"] = TEST_DB;
    process.env["ADMIN_PASSWORD"] = PWD;
    db = await import("@workspace/db");
    const express = (await import("express")).default;
    const router = (await import("./hermesDoc")).default;
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use("/api", router);
    await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise((r) => server?.close(r)); });
  beforeEach(async () => {
    await db.db.delete(db.hermesDocTable);
    await db.db.delete(db.hermesGraphSnapshotTable);
  });

  it("requires the admin password for POST and GET", async () => {
    expect((await post([ev("EV-A")], null)).status).toBe(403);
    expect((await post([ev("EV-A")], "wrong")).status).toBe(403);
    expect((await get("/hermes-doc/event/EV-A", null)).status).toBe(403);
    expect((await get("/hermes-doc/event/EV-A", "wrong")).status).toBe(403);
  });

  it("upserts idempotently and updates in place (same key, new content)", async () => {
    expect((await post([ev("EV-A")])).status).toBe(200);
    expect((await post([ev("EV-A", { title: "改過", bodyMd: "新內文", contentHash: "hash-v2-xxxx" })])).status).toBe(200);
    const rows = await db.db.select().from(db.hermesDocTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "改過", bodyMd: "新內文", contentHash: "hash-v2-xxxx" });
  });

  it("rejects an invalid batch atomically (nothing is written)", async () => {
    const r = await post([ev("EV-A"), ev("EV-B", { kind: "person" })]);
    expect(r.status).toBe(400);
    expect(await db.db.select().from(db.hermesDocTable)).toHaveLength(0);
  });

  it("returns an event with body and sources; unknown docs are 404 'not synced'; bad kind is 400", async () => {
    await post([ev("EV-A")]);
    const r = await get("/hermes-doc/event/EV-A");
    expect(r.status).toBe(200);
    expect(await json(r)).toMatchObject({
      kind: "event", key: "EV-A", title: "事件 EV-A", bodyMd: "## 摘要\nEV-A 的內文", truncated: false, date: "2026-09-01",
      sources: [{ type: "diary", path: "日記/2026-09-01.md" }],
    });
    expect((await get("/hermes-doc/event/NOPE")).status).toBe(404);
    expect((await get("/hermes-doc/person/X")).status).toBe(400);
  });

  it("handles keys with spaces, slashes and non-ASCII (URL-encoded)", async () => {
    await post([ev("EV A/1 事件")]);
    const r = await get(`/hermes-doc/event/${encodeURIComponent("EV A/1 事件")}`);
    expect(r.status).toBe(200);
    expect((await json(r)).key).toBe("EV A/1 事件");
  });

  it("builds a concept's context from refs + graph events + event bodies, newest first", async () => {
    await db.db.insert(db.hermesGraphSnapshotTable).values({
      id: "latest", personRelations: [], cases: [], hubNarratives: [], hubAssessments: [],
      events: [
        { id: "EV-A", date: "2026-09-01", title: "甲事件", caseNo: null, case: null, location: null, status: null, tags: [], participants: [], objects: [] },
        { id: "EV-B", date: "2026-09-05", title: "乙事件", caseNo: null, case: null, location: null, status: null, tags: [], participants: [], objects: [] },
      ],
    });
    await post([
      ev("EV-A"), ev("EV-B", { bodyMd: "## 摘要\n乙的 **重點**" }),
      {
        kind: "concept", key: "單一事實來源", title: "單一事實來源", bodyMd: "人工補寫的定義", truncated: false,
        meta: {
          promoted: true, aliases: ["唯一資料來源"],
          refs: [
            { eventId: "EV-A", date: "2026-09-01", relation: "體現" },
            { eventId: "EV-B", date: "2026-09-05", as: "唯一資料來源", evidence: "逐字引文" },
            { eventId: "EV-GONE", date: "2026-08-01" },
          ],
        },
        sourcePath: "Concepts/單一事實來源.md", contentHash: "hash-concept-1",
      },
    ]);
    const r = await get(`/hermes-doc/concept/${encodeURIComponent("單一事實來源")}`);
    expect(r.status).toBe(200);
    const body = await json(r);
    expect(body).toMatchObject({ kind: "concept", bodyMd: "人工補寫的定義", promoted: true, aliases: ["唯一資料來源"] });
    expect(body.contexts.map((c: { eventId: string }) => c.eventId)).toEqual(["EV-B", "EV-A", "EV-GONE"]);
    expect(body.contexts[0]).toMatchObject({ title: "乙事件", as: "唯一資料來源", evidence: "逐字引文", excerpt: "乙的 重點" });
    expect(body.contexts[1]).toMatchObject({ title: "甲事件", relation: "體現" });
    expect(body.contexts[2]).toMatchObject({ title: "EV-GONE", excerpt: "" }); // 事件不在圖上也不在文件表：只留 id
    expect(body.meta).toBeUndefined(); // 不外洩原始 meta／sourcePath
    expect(body.sourcePath).toBeUndefined();
  });

  it("works for a candidate concept with no hub body and no refs bodies", async () => {
    await post([{
      kind: "method", key: "候選方法", title: "候選方法", bodyMd: "", truncated: false,
      meta: { promoted: false, refs: [{ eventId: "EV-X", date: "2026-09-09" }] }, sourcePath: null, contentHash: "hash-method-1",
    }]);
    const body = await json(await get("/hermes-doc/method/候選方法"));
    expect(body).toMatchObject({ kind: "method", bodyMd: "", promoted: false });
    expect(body.contexts).toHaveLength(1);
  });

  it("stores and returns source and topic docs (key with slashes); meta and sourcePath are returned", async () => {
    const src = {
      kind: "source", key: "AI/工作/x", title: "開標紀錄", bodyMd: "本次開標於 3/5 進行", truncated: false,
      meta: { type: "note", case: null, date: "2026-03-05", originName: null, rawPath: null, textFrom: "note", evidence: null, topics: [] },
      sourcePath: "AI/工作/x.md", contentHash: "hash-source-1",
    };
    const topic = {
      kind: "topic", key: "topic-a", title: "招標流程", bodyMd: "", truncated: false,
      meta: { quotes: [{ k: 0, ref: 1, text: "本次開標於 3/5 進行", fromOriginal: true, weak: false }] },
      sourcePath: null, contentHash: "hash-topic-1",
    };
    expect((await post([src, topic])).status).toBe(200);
    expect((await post([{ ...src, bodyMd: "改過的全文" , contentHash: "hash-source-2"}])).status).toBe(200);

    const s = await get(`/hermes-doc/source/${encodeURIComponent("AI/工作/x")}`);
    expect(s.status).toBe(200);
    expect(await json(s)).toMatchObject({ kind: "source", key: "AI/工作/x", bodyMd: "改過的全文", sourcePath: "AI/工作/x.md", meta: { date: "2026-03-05" } });

    const t = await get("/hermes-doc/topic/topic-a");
    expect(await json(t)).toMatchObject({ kind: "topic", title: "招標流程", meta: { quotes: [{ k: 0, ref: 1 }] } });
    expect((await get("/hermes-doc/source/NOPE")).status).toBe(404);
  });

  it("search: only source docs, case-insensitive, escapes % _ \\, 400 on bad q, 403 without password", async () => {
    await post([
      { kind: "source", key: "S1", title: "招標公告", bodyMd: "本案 Budget 100%_完成", truncated: false, meta: { date: "2026-01-01" }, sourcePath: null, contentHash: "hash-s1-xxxx" },
      { kind: "source", key: "S2", title: "其他", bodyMd: "budget 不含百分比", truncated: false, meta: { date: "2026-09-01" }, sourcePath: null, contentHash: "hash-s2-xxxx" },
      { kind: "source", key: "S3", title: "沒關係", bodyMd: "完全無關", truncated: false, meta: {}, sourcePath: null, contentHash: "hash-s3-xxxx" },
      { kind: "event", key: "EV-X", title: "budget 事件", bodyMd: "budget", truncated: false, meta: {}, sourcePath: null, contentHash: "hash-ev-xxxx" },
    ]);
    const r = await get(`/hermes-doc-search?q=${encodeURIComponent("BUDGET")}`);
    expect(r.status).toBe(200);
    const res = (await json(r)).results as Array<{ key: string; snippet: string; hitAt: number | null }>;
    expect(res.map((x) => x.key)).toEqual(["S2", "S1"]); // 新到舊；event 不在結果裡
    expect(res[0]).toMatchObject({ key: "S2", hitAt: 0 });

    // % 與 _ 必須被跳脫：搜 "%_" 只能命中 S1，不能當萬用字元命中全部
    const esc = await json(await get(`/hermes-doc-search?q=${encodeURIComponent("%_")}`));
    expect(esc.results.map((x: { key: string }) => x.key)).toEqual(["S1"]);

    expect((await get("/hermes-doc-search?q=%20%20")).status).toBe(400);
    expect((await get(`/hermes-doc-search?q=${"x".repeat(51)}`)).status).toBe(400);
    expect((await get("/hermes-doc-search?q=a&limit=0")).status).toBe(400);
    expect((await get("/hermes-doc-search?q=a", null)).status).toBe(403);
  });
});
