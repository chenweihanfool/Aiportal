// 搜尋路由的權限與參數驗證（都在碰資料庫之前就回應，所以不需要真的資料庫）。
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PWD = "search-route-test-pwd";

describe("search 路由：未授權與參數驗證", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    process.env["DATABASE_URL"] ??= "postgres://u:p@127.0.0.1:1/none_test";
    process.env["ADMIN_PASSWORD"] = PWD;
    const express = (await import("express")).default;
    const router = (await import("./search")).default;
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  });
  afterAll(() => { server?.close(); });

  const authed = { "x-admin-password": PWD };

  it("五個端點沒有密碼一律 403", async () => {
    for (const [m, p] of [["GET", "/search?q=a"], ["GET", "/search/preview?kind=case&id=a"], ["POST", "/search/log"], ["GET", "/search/stats"], ["GET", "/search/recent"]] as const) {
      const r = await fetch(base + p, { method: m });
      expect(r.status, p).toBe(403);
      expect(((await r.json()) as { message: string }).message).toBe("需要解鎖私領域才能查看");
    }
  });
  it("S1 參數不合法回 400", async () => {
    for (const qs of ["", "q=", "q=" + "a".repeat(51), "q=a&kind=zzz", "q=a&limit=0", "q=a&limit=21"]) {
      expect((await fetch(`${base}/search?${qs}`, { headers: authed })).status, qs).toBe(400);
    }
  });
  it("S2／S3／S4／S5 參數不合法回 400", async () => {
    expect((await fetch(`${base}/search/preview?kind=zzz&id=a`, { headers: authed })).status).toBe(400);
    expect((await fetch(`${base}/search/preview?kind=case`, { headers: authed })).status).toBe(400);
    const post = (body: unknown) => fetch(`${base}/search/log`, { method: "POST", headers: { ...authed, "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post({ q: "", kind: null, total: 0, clickedKind: null, clickedId: null })).status).toBe(400);
    expect((await post({ q: "a", kind: null, total: -1, clickedKind: null, clickedId: null })).status).toBe(400);
    expect((await fetch(`${base}/search/stats?days=91`, { headers: authed })).status).toBe(400);
    for (const qs of ["limit=0", "limit=21", "limit=abc", "limit=1.5", "limit="]) {
      expect((await fetch(`${base}/search/recent?${qs}`, { headers: authed })).status, qs).toBe(400);
    }
  });
});
