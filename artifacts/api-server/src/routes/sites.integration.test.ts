// 站台寫入端點整合測試：真實 Postgres＋真實路由，驗證 POST／PATCH／PUT／DELETE 在 `/sites*` 與 `/admin/sites*` 兩種前綴的實際行為。
// 預設跳過。執行方式（只准對「拋棄式」資料庫，且必須已套用全部遷移）：
//   TEST_DATABASE_URL=postgres://.../aiportal_test pnpm exec vitest run src/routes/sites.integration.test.ts
// 安全閘：資料庫名必須以 `_test` 結尾（測試會清空 portal_sites）。
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB = process.env["TEST_DATABASE_URL"];
const dbName = TEST_DB ? new URL(TEST_DB).pathname.replace(/^\//, "") : "";
const enabled = Boolean(TEST_DB) && dbName.endsWith("_test");
if (TEST_DB && !enabled) throw new Error(`拒絕執行：資料庫名「${dbName}」不是以 _test 結尾`);

const PWD = "integration-test-pwd";
const body = (over: Record<string, unknown> = {}) => ({
  name: "測試站", subtitle: "Test", links: [{ label: "進入", url: "https://example.test/" }],
  worldXZ: [1.5, -2], isPrivate: false, subsystemId: null, ...over,
});

describe.skipIf(!enabled)("sites 寫入端點（真實 Postgres）", () => {
  let server: Server;
  let base = "";
  let db: typeof import("@workspace/db");

  const call = (method: string, path: string, payload?: unknown, pwd: string | null = PWD) =>
    fetch(`${base}/api${path}`, {
      method,
      headers: { "content-type": "application/json", ...(pwd ? { "x-admin-password": pwd } : {}) },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  const list = async () => ((await (await fetch(`${base}/api/sites`)).json()) as { sites: { id: string; name: string; subtitle: string; isPrivate: boolean; worldXZ: number[] }[] }).sites;

  beforeAll(async () => {
    process.env["DATABASE_URL"] = TEST_DB;
    process.env["ADMIN_PASSWORD"] = PWD;
    db = await import("@workspace/db");
    const express = (await import("express")).default;
    const router = (await import("./sites")).default;
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise((r) => server?.close(r)); });
  // 清空後 GET /sites 會自動補預設站台；先塞一筆以避免觸發補種，讓每個測試從「只有 1 筆」開始。
  beforeEach(async () => {
    await db.db.delete(db.portalSitesTable);
    await db.db.insert(db.portalSitesTable).values({ name: "基準", subtitle: "", links: [], worldX: 0, worldZ: 0, isPrivate: false, subsystemId: null, sortOrder: 0 });
  });

  it.each(["/admin/sites", "/sites"])("POST %s 新增後 GET 讀得到（201）", async (path) => {
    const r = await call("POST", path, body({ name: "新站" }));
    expect(r.status).toBe(201);
    expect((await list()).map((s) => s.name)).toContain("新站");
  });

  it("前端實際用的 PATCH /admin/sites/:id 只改帶的欄位，其餘不動", async () => {
    const created = (await (await call("POST", "/admin/sites", body({ name: "原名", subtitle: "原副標", isPrivate: true }))).json()) as { site: { id: string } };
    const r = await call("PATCH", `/admin/sites/${created.site.id}`, { name: "新名" });
    expect(r.status).toBe(200);
    const after = (await list()).find((s) => s.id === created.site.id)!;
    expect(after.name).toBe("新名");
    expect(after.subtitle).toBe("原副標");
    expect(after.isPrivate).toBe(true);
    expect(after.worldXZ).toEqual([1.5, -2]);
  });

  it.each([["PUT", "/sites"], ["PUT", "/admin/sites"], ["PATCH", "/sites"]])("%s %s/:id 相容路徑也可更新", async (method, prefix) => {
    const created = (await (await call("POST", "/admin/sites", body())).json()) as { site: { id: string } };
    expect((await call(method, `${prefix}/${created.site.id}`, { subtitle: "改" })).status).toBe(200);
    const after = (await list()).find((s) => s.id === created.site.id)!;
    expect(after.subtitle).toBe("改");
    expect(after.name).toBe("測試站");                       // 部分更新：沒帶的欄位不能被清掉
  });

  it.each(["/admin/sites", "/sites"])("DELETE %s/:id 刪除後 GET 不再出現", async (prefix) => {
    const created = (await (await call("POST", "/admin/sites", body({ name: "待刪" }))).json()) as { site: { id: string } };
    expect((await call("DELETE", `${prefix}/${created.site.id}`)).status).toBe(200);
    expect((await list()).some((s) => s.id === created.site.id)).toBe(false);
  });

  it("不存在的 id → PATCH 404；非數字 id → 400", async () => {
    expect((await call("PATCH", "/admin/sites/999999", { name: "x" })).status).toBe(404);
    expect((await call("PATCH", "/admin/sites/abc", { name: "x" })).status).toBe(400);
  });

  it("無密碼寫入被擋，資料不變", async () => {
    const before = (await list()).length;
    expect((await call("POST", "/admin/sites", body(), null)).status).toBe(401);
    expect((await list()).length).toBe(before);
  });
});
