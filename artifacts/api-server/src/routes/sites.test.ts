// /sites 的路由表與讀取行為（不連資料庫：@workspace/db 以最小替身取代）。
// 2026-10-22 起工具連結（公領域／私領域）拿掉，寫入端點全部移除；只剩「面向對應的子系統連結」的唯讀清單，且要解鎖才給。
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const row = (id: number, name: string, subsystemId: string | null) => ({
  id, name, subtitle: "", links: [{ label: "進入系統", url: `https://example.test/${id}` }], worldX: 1, worldZ: 2, isPrivate: true, sortOrder: id, subsystemId,
});
// 替身資料庫：where 子句我們不解析，直接依「有沒有呼叫 where」回傳已過濾／未過濾的列，用來確認路由確實有帶 where。
const ALL = [row(1, "人生進度管理系統", "pf-cwh"), row(2, "圖根點管理系統", null)];
const calls: string[] = [];
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => { calls.push("where"); return { orderBy: async () => ALL.filter((r) => r.subsystemId !== null) }; },
        orderBy: async () => ALL,
      }),
    }),
  },
  portalSitesTable: { subsystemId: {}, sortOrder: {}, id: {} },
}));
vi.mock("drizzle-orm", () => ({ isNotNull: () => "notnull", asc: () => "asc", eq: () => "eq" }));
process.env["ADMIN_PASSWORD"] = "sites-test-pwd";

type Layer = { route?: { path: string | string[]; methods: Record<string, boolean> } };

describe("sites 路由表", () => {
  let router: { stack: Layer[] };
  beforeAll(async () => { router = (await import("./sites")).default as unknown as { stack: Layer[] }; });
  const has = (method: string, path: string) =>
    router.stack.some((l) => l.route && ([] as string[]).concat(l.route.path).includes(path) && l.route.methods[method]);

  it("只剩 GET /sites 與 POST /auth/verify", () => {
    expect(has("get", "/sites")).toBe(true);
    expect(has("post", "/auth/verify")).toBe(true);
  });
  it.each(["post", "put", "patch", "delete"])("%s 站台寫入端點已移除（兩種前綴都沒有）", (method) => {
    for (const path of ["/sites", "/admin/sites", "/sites/:id", "/admin/sites/:id"]) expect(has(method, path)).toBe(false);
  });
});

describe("GET /sites", () => {
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

  it("未解鎖：回空清單（200），不洩漏任何網址，也不查資料庫", async () => {
    calls.length = 0;
    const r = await fetch(`${base}/api/sites`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ sites: [] });
    expect(calls).toEqual([]);
  });
  it("密碼錯誤：同樣回空清單", async () => {
    const r = await fetch(`${base}/api/sites`, { headers: { "x-admin-password": "wrong" } });
    expect(await r.json()).toEqual({ sites: [] });
  });
  it("已解鎖：只回有 subsystemId 的列（沒綁子系統的舊工具連結不再出現）", async () => {
    calls.length = 0;
    const r = await fetch(`${base}/api/sites`, { headers: { "x-admin-password": "sites-test-pwd" } });
    const body = (await r.json()) as { sites: { name: string; subsystemId: string | null; worldXZ: number[] }[] };
    expect(body.sites.map((s) => s.name)).toEqual(["人生進度管理系統"]);
    expect(body.sites[0]).toMatchObject({ subsystemId: "pf-cwh", worldXZ: [1, 2] });
    expect(calls).toEqual(["where"]);
  });
  it("POST /sites 已不存在（404）", async () => {
    const r = await fetch(`${base}/api/sites`, { method: "POST", headers: { "content-type": "application/json", "x-admin-password": "sites-test-pwd" }, body: "{}" });
    expect(r.status).toBe(404);
  });
});
