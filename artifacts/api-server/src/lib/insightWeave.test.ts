// 心得編織層：本文驗證、after 規則、feed 契約與路由順序。驗證與權限檢查都在碰資料庫之前回應，
// 所以不需要真的資料庫（同 routes/knowledgeCorrections.test.ts 的做法）。
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseAfter, parseVerdictBody } from "./insightWeave";
import { FEED_REGISTRY } from "../feeds/registry";
import { validateFeedRequest } from "./feedValidate";

describe("parseVerdictBody", () => {
  it("body 必須是物件；只接受 itemId、verdict 兩個鍵，多一個就擋", () => {
    expect(parseVerdictBody(null)).toBe("body 必須是物件");
    expect(parseVerdictBody("x")).toBe("body 必須是物件");
    expect(parseVerdictBody([])).toBe("body 必須是物件");
    expect(parseVerdictBody({ itemId: "L-0a1b2c3d", verdict: "ok", extra: 1 })).toBe("不接受的欄位：extra");
  });

  it("itemId 必須是 L、B、T、K、S、J 加 8 位小寫十六進位", () => {
    for (const bad of [
      undefined,
      "l-0a1b2c3d",
      "L-0A1B2C3D",
      "L-0a1b2c3",
      "L-0a1b2c3de",
      "X-0a1b2c3d",
      "L0a1b2c3d",
      123,
    ]) {
      expect(typeof parseVerdictBody({ itemId: bad, verdict: "ok" }), String(bad)).toBe("string");
    }
    for (const [kind, id] of [["L", "L-0a1b2c3d"], ["B", "B-deadbeef"], ["T", "T-01234567"], ["K", "K-89abcdef"], ["S", "S-0a1b2c3d"], ["J", "J-fedcba98"]] as const) {
      expect(parseVerdictBody({ itemId: id, verdict: "ok" }), kind).toEqual({ itemId: id, verdict: "ok" });
    }
  });

  it("verdict 只接受 ok、no、undo", () => {
    for (const bad of [undefined, "yes", "OK", 1]) {
      expect(typeof parseVerdictBody({ itemId: "L-0a1b2c3d", verdict: bad }), String(bad)).toBe("string");
    }
    for (const verdict of ["ok", "no", "undo"] as const) {
      expect(parseVerdictBody({ itemId: "T-01234567", verdict })).toEqual({ itemId: "T-01234567", verdict });
    }
    expect(parseVerdictBody({ itemId: "L-0a1b2c3d", verdict: "maybe" })).toBe("verdict 必須是 ok、no 或 undo");
    expect(parseVerdictBody({ itemId: "l-0a1b2c3d", verdict: "ok" })).toBe("itemId 必須符合 L-、B-、T-、K-、S- 或 J- 加 8 位小寫十六進位的格式");
  });

  it("after 沿用更正 API 的規則（缺省 0、只收非負整數）", () => {
    expect(parseAfter(undefined)).toBe(0);
    expect(parseAfter("42")).toBe(42);
    for (const bad of ["", "-1", "1.5", "abc", ["1"], null, 1, "2147483648"]) {
      expect(typeof parseAfter(bad), String(bad)).toBe("string");
    }
  });
});

describe("insight-weave feed 契約", () => {
  const insA = "INS-2026-11-19-0a1b2c3d";
  const insB = "INS-2026-11-18-0a1b2c3e";
  const insC = "INS-2026-11-17-0a1b2c3f";
  const lighthouse = {
    id: "L-0a1b2c3d",
    cluster: "K01",
    text: "反覆出現的做法",
    evidence: [insA, insB],
    confidence: "high",
    status: "proposed",
    since: "2026-11-01",
  };
  const payload = {
    generatedAt: "2026-11-20",
    basis: { insights: 12, lastInsightDate: "2026-11-19" },
    lighthouses: [
      lighthouse,
      { id: "L-1a2b3c4d", cluster: "K02", text: "第二座燈塔", evidence: [insB, insC], confidence: "mid", status: "confirmed", since: "2026-10-01" },
    ],
    insufficient: [{ cluster: "K03", evidence: [insC], note: "資料還不夠" }],
    bridges: [{
      id: "B-0a1b2c3d",
      title: "橋一",
      text: "兩端連起來",
      ends: [{ cluster: "K01", evidence: [insA] }, { cluster: "K02", evidence: [insB] }],
      confidence: "low",
      status: "proposed",
      note: "",
      since: "2026-11-02",
    }],
    tensions: [{
      id: "T-0a1b2c3d",
      text: "兩種說法互相拉扯",
      members: [insA, insC],
      clusters: ["K01"],
      confidence: "mid",
      status: "proposed",
      since: "2026-11-03",
    }],
    kbLinks: [{
      id: "K-0a1b2c3d",
      kind: "apply",
      topic: "主題",
      insights: [insA],
      text: "可以套用的地方",
      confidence: "high",
      status: "confirmed",
      since: "2026-11-04",
    }],
  };
  const body = (p: unknown) => ({ schemaVersion: 1, generatedAt: "2026-11-20", payload: p });

  it("登記表有 insight-weave v1", () => {
    expect(FEED_REGISTRY["insight-weave"]?.version).toBe(1);
    expect(FEED_REGISTRY["insight-weave"]?.description).toBe("心得 AI 編織層：燈塔／橋／張力／知識庫交織（kb-pipeline 每週）");
  });

  it("合法樣本通過（燈塔 2、橋 1、張力 1、kbLinks 1、insufficient 1）", () => {
    expect(validateFeedRequest("insight-weave", body(payload)).ok).toBe(true);
    expect(validateFeedRequest("insight-weave", body({ ...payload, basis: { insights: 0, lastInsightDate: null } })).ok).toBe(true);
  });

  it("違規樣本被擋：燈塔 evidence 只有 1 則、confidence 為「高」、多一個鍵", () => {
    expect(validateFeedRequest("insight-weave", body({ ...payload, lighthouses: [{ ...lighthouse, evidence: [insA] }] })).ok).toBe(false);
    expect(validateFeedRequest("insight-weave", body({ ...payload, lighthouses: [{ ...lighthouse, confidence: "高" }] })).ok).toBe(false);
    expect(validateFeedRequest("insight-weave", body({ ...payload, extra: 1 })).ok).toBe(false);
    expect(validateFeedRequest("insight-weave", body({ ...payload, tensions: [{ ...payload.tensions[0], extra: 1 }] })).ok).toBe(false);
    expect(validateFeedRequest("insight-weave", body({ ...payload, lighthouses: [{ ...lighthouse, id: "L-0A1B2C3D" }] })).ok).toBe(false);
  });

  it("新欄位 kbSteps／stepBridges 選填：舊 payload 照過、合法樣本通過、壞值被擋", () => {
    const kbStep = {
      id: "S-1a2b3c4d", insight: insA, topic: "T20261105-01", claim: "c005",
      relation: "support", text: "這則心得印證了這一步", confidence: "mid", status: "proposed", since: "2026-11-22",
    };
    const stepBridge = {
      id: "J-1a2b3c4d", title: "同一步", text: "兩題在做同一件事",
      ends: [{ topic: "T20261105-01", claim: "c005" }, { topic: "T20261107-02", claim: "c012" }],
      confidence: "mid", status: "proposed", since: "2026-11-22",
    };
    // 舊 payload（沒有新欄位）仍合法
    expect(validateFeedRequest("insight-weave", body(payload)).ok).toBe(true);
    // 合法新欄位
    expect(validateFeedRequest("insight-weave", body({ ...payload, kbSteps: [kbStep], stepBridges: [stepBridge] })).ok).toBe(true);
    // relation 不合法
    expect(validateFeedRequest("insight-weave", body({ ...payload, kbSteps: [{ ...kbStep, relation: "agree" }] })).ok).toBe(false);
    // stepBridges 只有 1 端
    expect(validateFeedRequest("insight-weave", body({ ...payload, stepBridges: [{ ...stepBridge, ends: [stepBridge.ends[0]] }] })).ok).toBe(false);
    // id 前綴錯
    expect(validateFeedRequest("insight-weave", body({ ...payload, kbSteps: [{ ...kbStep, id: "X-1a2b3c4d" }] })).ok).toBe(false);
    expect(validateFeedRequest("insight-weave", body({ ...payload, stepBridges: [{ ...stepBridge, id: "S-1a2b3c4d" }] })).ok).toBe(false);
    // 多餘鍵
    expect(validateFeedRequest("insight-weave", body({ ...payload, kbSteps: [{ ...kbStep, extra: 1 }] })).ok).toBe(false);
  });
});

describe("insight weave 路由：權限、本文驗證與順序", () => {
  let server: Server;
  let base = "";
  const PWD = "insight-weave-route-test-pwd";

  beforeAll(async () => {
    process.env["DATABASE_URL"] ??= "postgres://u:p@127.0.0.1:1/none_test";
    process.env["ADMIN_PASSWORD"] = PWD;
    const express = (await import("express")).default;
    const weaveRouter = (await import("../routes/insightWeave")).default;
    const insightsRouter = (await import("../routes/insights")).default;
    const app = express();
    app.use(express.json());
    // 與 routes/index.ts 相同順序：先掛編織層，再掛 /insights 與 /insights/:id。
    app.use("/api", weaveRouter);
    app.use("/api", insightsRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  });
  afterAll(() => { server?.close(); });

  const authed = { "x-admin-password": PWD, "content-type": "application/json" };
  const post = (body: unknown, headers: Record<string, string> = authed) =>
    fetch(`${base}/insights/weave/verdicts`, { method: "POST", headers, body: JSON.stringify(body) });

  it("GET／POST 沒帶管理密碼都回 401", async () => {
    for (const r of [await fetch(`${base}/insights/weave/verdicts`), await fetch(`${base}/insights/weave/verdicts`, { method: "POST" })]) {
      expect(r.status).toBe(401);
      expect(((await r.json()) as { message: string }).message).toBe("需要管理員權限");
    }
  });

  it("GET 的 after 不合法回 400（碰資料庫前就擋）", async () => {
    const r = await fetch(`${base}/insights/weave/verdicts?after=abc`, { headers: authed });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { message: string }).message).toBe("after 必須是非負整數");
  });

  it("POST 本文不合法回 400（繁中訊息）", async () => {
    const cases: Array<[unknown, string]> = [
      [{ itemId: "L-0a1b2c3d", verdict: "ok", extra: 1 }, "不接受的欄位：extra"],
      [{ itemId: "l-0a1b2c3d", verdict: "ok" }, "itemId 必須符合 L-、B-、T-、K-、S- 或 J- 加 8 位小寫十六進位的格式"],
      [{ itemId: "L-0A1B2C3D", verdict: "ok" }, "itemId 必須符合 L-、B-、T-、K-、S- 或 J- 加 8 位小寫十六進位的格式"],
      [{ itemId: "X-0a1b2c3d", verdict: "ok" }, "itemId 必須符合 L-、B-、T-、K-、S- 或 J- 加 8 位小寫十六進位的格式"],
      [{ itemId: "L-0a1b2c3d", verdict: "yes" }, "verdict 必須是 ok、no 或 undo"],
      [[], "body 必須是物件"],
    ];
    for (const [body, message] of cases) {
      const r = await post(body);
      expect(r.status, message).toBe(400);
      expect(((await r.json()) as { message: string }).message).toBe(message);
    }
  });

  it("路由順序：/insights/weave/verdicts 打到新路由，/insights/INS-… 照舊走心得路由", async () => {
    // 新路由先回應（未授權 401，而不是心得路由的 403）。
    const weave = await fetch(`${base}/insights/weave/verdicts`);
    expect(weave.status).toBe(401);
    expect(((await weave.json()) as { message: string }).message).toBe("需要管理員權限");
    // /insights/:id 沒被吃掉：沒有管理密碼時由心得路由回 403。
    const insight = await fetch(`${base}/insights/INS-2026-11-19-0a1b2c3d`);
    expect(insight.status).toBe(403);
    expect(((await insight.json()) as { message: string }).message).toBe("需要解鎖私領域才能查看");
  });
});
