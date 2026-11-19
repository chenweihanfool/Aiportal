// 知識頁更正路由：權限與本文驗證都在碰資料庫之前就回應，所以不需要真的資料庫。
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PWD = "knowledge-corrections-route-test-pwd";

describe("knowledge corrections 路由：未授權與本文驗證", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    process.env["DATABASE_URL"] ??= "postgres://u:p@127.0.0.1:1/none_test";
    process.env["ADMIN_PASSWORD"] = PWD;
    const express = (await import("express")).default;
    const router = (await import("./knowledgeCorrections")).default;
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  });
  afterAll(() => { server?.close(); });

  const authed = { "x-admin-password": PWD, "content-type": "application/json" };
  const post = (body: unknown, headers: Record<string, string> = authed) =>
    fetch(`${base}/knowledge/corrections`, { method: "POST", headers, body: JSON.stringify(body) });

  it("沒有管理密碼回 401", async () => {
    const r = await fetch(`${base}/knowledge/corrections`, { method: "POST" });
    expect(r.status).toBe(401);
    expect(((await r.json()) as { message: string }).message).toBe("需要管理員權限");
  });

  it("unlink 本文不合法回 400（繁中訊息）", async () => {
    const good = { topicId: "T20261119-01", claimId: "c010", kind: "unlink", text: "doc:tpl_ab12cd34ef" };
    const cases: Array<[unknown, string]> = [
      [{ ...good, text: undefined }, "unlink 需要 text"],
      [{ ...good, text: "c010" }, "unlink 的 text 必須是 doc:、insight:、rule:、pitfall: 或 case: 開頭，且不含換行"],
      [{ ...good, section: "步驟" }, "unlink 不可帶 section"],
      [{ ...good, claimId: "c1" }, "claimId 必須符合 c123 的格式"],
      [{ ...good, kind: "retract" }, "kind 必須是 wrong、fix、add、undo 或 unlink"],
      [{ ...good, extra: 1 }, "不接受的欄位：extra"],
    ];
    for (const [body, message] of cases) {
      const r = await post(body);
      expect(r.status, message).toBe(400);
      expect(((await r.json()) as { message: string }).message).toBe(message);
    }
  });
});
