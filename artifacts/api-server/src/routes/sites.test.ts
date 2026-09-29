// 站台寫入端點的路由表與權限測試（不連資料庫：@workspace/db 以最小替身取代）。
// 起因：前端實際打 /api/admin/sites*（POST／PATCH／DELETE），舊版只註冊 /sites*、且沒有 PATCH →「新增／編輯／刪除網站」全 404。
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  portalSitesTable: {},
}));
process.env["ADMIN_PASSWORD"] = "sites-test-pwd";

type Layer = { route?: { path: string | string[]; methods: Record<string, boolean>; stack: { name: string }[] } };

describe("sites 路由表", () => {
  let router: { stack: Layer[] };
  beforeAll(async () => { router = (await import("./sites")).default as unknown as { stack: Layer[] }; });

  const has = (method: string, path: string) =>
    router.stack.some((l) => {
      const paths = l.route ? ([] as string[]).concat(l.route.path) : [];
      return paths.includes(path) && l.route!.methods[method];
    });
  const guarded = (method: string, path: string) =>
    router.stack.find((l) => l.route && ([] as string[]).concat(l.route.path).includes(path) && l.route.methods[method])
      ?.route?.stack[0]?.name === "requireAdmin";

  const cases: [string, string][] = [
    ["post", "/sites"], ["post", "/admin/sites"],
    ["put", "/sites/:id"], ["put", "/admin/sites/:id"],
    ["patch", "/sites/:id"], ["patch", "/admin/sites/:id"],
    ["delete", "/sites/:id"], ["delete", "/admin/sites/:id"],
  ];

  it.each(cases)("%s %s 已註冊且第一關是 requireAdmin", (method, path) => {
    expect(has(method, path)).toBe(true);
    expect(guarded(method, path)).toBe(true);
  });

  it("前端實際呼叫的三個端點（POST／PATCH／DELETE 的 admin 前綴）都存在", () => {
    expect(has("post", "/admin/sites")).toBe(true);
    expect(has("patch", "/admin/sites/:id")).toBe(true);
    expect(has("delete", "/admin/sites/:id")).toBe(true);
  });

  it("GET /sites 維持公開讀取（沒有 requireAdmin），且沒有 admin 前綴的 GET", () => {
    expect(has("get", "/sites")).toBe(true);
    expect(guarded("get", "/sites")).toBe(false);
    expect(has("get", "/admin/sites")).toBe(false);
  });
});

describe("sites 寫入端點的權限（HTTP，不碰資料庫）", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    const express = (await import("express")).default;
    const router = (await import("./sites")).default;
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise((r) => server?.close(r)); });

  const calls: [string, string][] = [
    ["POST", "/api/admin/sites"], ["POST", "/api/sites"],
    ["PATCH", "/api/admin/sites/1"], ["PUT", "/api/sites/1"], ["PUT", "/api/admin/sites/1"], ["PATCH", "/api/sites/1"],
    ["DELETE", "/api/admin/sites/1"], ["DELETE", "/api/sites/1"],
  ];
  it.each(calls)("%s %s 無密碼 → 401（不是 404）", async (method, path) => {
    const r = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: method === "DELETE" ? undefined : "{}" });
    expect(r.status).toBe(401);
  });

  it.each([["PATCH", "/api/admin/sites/1"], ["PUT", "/api/sites/1"], ["POST", "/api/admin/sites"]])(
    "%s %s 已授權但沒帶 body → 400（不是 500）；未授權仍先得 401", async (method, path) => {
      const authed = await fetch(`${base}${path}`, { method, headers: { "x-admin-password": "sites-test-pwd" } });   // 無 Content-Type、無 body
      expect(authed.status).toBe(400);
      const anon = await fetch(`${base}${path}`, { method });
      expect(anon.status).toBe(401);
    });

  it("body 是陣列或字串也回 400", async () => {
    for (const payload of ["[]", '"x"', "null"]) {
      const r = await fetch(`${base}/api/admin/sites/1`, { method: "PATCH", headers: { "x-admin-password": "sites-test-pwd", "content-type": "application/json" }, body: payload });
      expect(r.status).toBe(400);
    }
  });

  it("/auth/verify 沒帶 body → 400（不是 500）", async () => {
    expect((await fetch(`${base}/api/auth/verify`, { method: "POST" })).status).toBe(400);
  });

  it("密碼錯誤 → 401", async () => {
    const r = await fetch(`${base}/api/admin/sites/1`, { method: "PATCH", headers: { "x-admin-password": "wrong", "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(401);
  });
});
