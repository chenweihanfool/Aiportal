// 回饋路由的權限與參數驗證（都在碰資料庫之前就回應，所以不需要真的資料庫）。
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PWD = "push-feedback-route-test-pwd";

describe("pushFeedback 路由：未授權與參數驗證", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    process.env["DATABASE_URL"] ??= "postgres://u:p@127.0.0.1:1/none_test";
    process.env["ADMIN_PASSWORD"] = PWD;
    const express = (await import("express")).default;
    const router = (await import("./pushFeedback")).default;
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  });
  afterAll(() => { server?.close(); });

  const authed = { "x-admin-password": PWD };
  const post = (body: unknown) =>
    fetch(`${base}/push/feedback`, { method: "POST", headers: { ...authed, "content-type": "application/json" }, body: JSON.stringify(body) });

  it("三個端點沒有密碼一律 403", async () => {
    for (const [m, p] of [["POST", "/push/feedback"], ["GET", "/push/feedback"], ["GET", "/push/stats"]] as const) {
      const r = await fetch(base + p, { method: m });
      expect(r.status, p).toBe(403);
      expect(((await r.json()) as { message: string }).message).toBe("需要解鎖私領域才能查看");
    }
  });

  it("POST body 不合法回 400", async () => {
    const good = { cardKey: "topic:T1:case:王案", cardKind: "topic", action: "shown", forDate: "2026-11-13" };
    for (const bad of [
      {}, null,
      { ...good, cardKey: "" },
      { ...good, cardKey: "a".repeat(201) },
      { ...good, cardKind: "zzz" },
      { ...good, action: "zzz" },
      { ...good, forDate: "2026-02-30" },
      { ...good, forDate: "13/11/2026" },
      { ...good, extra: 1 },
    ]) {
      expect((await post(bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("days 不合法回 400", async () => {
    for (const qs of ["days=0", "days=91", "days=abc", "days=1.5"]) {
      expect((await fetch(`${base}/push/feedback?${qs}`, { headers: authed })).status, qs).toBe(400);
      expect((await fetch(`${base}/push/stats?${qs}`, { headers: authed })).status, qs).toBe(400);
    }
  });
});
