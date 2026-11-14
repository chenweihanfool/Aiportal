// 釘選路由的權限與參數驗證（都在碰資料庫之前就回應，所以不需要真的資料庫）。
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDaysTpe, todayTpe } from "../lib/pushFeedback";

const PWD = "push-pins-route-test-pwd";

describe("push pins 路由：未授權與參數驗證", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    process.env["DATABASE_URL"] ??= "postgres://u:p@127.0.0.1:1/none_test";
    process.env["ADMIN_PASSWORD"] = PWD;
    const express = (await import("express")).default;
    const router = (await import("./pushPins")).default;
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  });
  afterAll(() => { server?.close(); });

  const authed = { "x-admin-password": PWD };

  it("三支端點沒有密碼一律 403", async () => {
    for (const [m, p] of [
      ["POST", "/push/pins"],
      ["GET", "/push/pins"],
      ["POST", "/push/pins/1/done"],
    ] as const) {
      const r = await fetch(base + p, { method: m });
      expect(r.status, p).toBe(403);
      expect(((await r.json()) as { message: string }).message).toBe("需要解鎖私領域才能查看");
    }
  });

  it("POST /push/pins body 不合法回 400", async () => {
    const today = todayTpe(new Date());
    const good = {
      targetKind: "case",
      targetId: "case:王案",
      title: "王案判決書",
      href: "#/reading/case/王案",
      dueDate: addDaysTpe(today, 7),
    };
    const post = (body: unknown) =>
      fetch(`${base}/push/pins`, {
        method: "POST",
        headers: { ...authed, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    for (const bad of [
      { ...good, extra: 1 },
      { ...good, targetKind: "zzz" },
      { ...good, targetId: "   " },
      { ...good, title: "" },
      { ...good, href: "/reading/case/王案" },
      { ...good, dueDate: addDaysTpe(today, -1) },
      { ...good, dueDate: addDaysTpe(today, 367) },
      { ...good, dueDate: "2026-02-30" },
    ]) {
      expect((await post(bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("GET /push/pins due 不合法回 400", async () => {
    for (const qs of ["due=tomorrow", "due=all", "due="]) {
      expect((await fetch(`${base}/push/pins?${qs}`, { headers: authed })).status, qs).toBe(400);
    }
  });

  it("POST /push/pins/:id/done id 非正整數回 400", async () => {
    for (const id of ["abc", "0", "1.5", "-1", "2147483648", "99999999999"]) {
      expect((await fetch(`${base}/push/pins/${id}/done`, { method: "POST", headers: authed })).status, id).toBe(400);
    }
  });
});
