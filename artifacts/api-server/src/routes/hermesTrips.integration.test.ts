// 遊記 API 整合測試（POST 覆寫 → GET 讀回、403、400、skipped 計數）：掛上真實路由、對真實 Postgres 驗證。
// 預設跳過。執行方式（只准對「拋棄式」資料庫）：
//   TEST_DATABASE_URL=postgres://.../aiportal_test pnpm exec vitest run src/routes/hermesTrips.integration.test.ts
// 安全閘：資料庫名必須以 `_test` 結尾，否則整組測試拒絕執行（測試會清空並寫入相關資料表）。
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB = process.env["TEST_DATABASE_URL"];
const dbName = TEST_DB ? new URL(TEST_DB).pathname.replace(/^\//, "") : "";
const enabled = Boolean(TEST_DB) && dbName.endsWith("_test");
if (TEST_DB && !enabled) throw new Error(`拒絕執行：資料庫名「${dbName}」不是以 _test 結尾`);

const PWD = "integration-test-pwd";

describe.skipIf(!enabled)("hermes-trips API（真實 Postgres）", () => {
  let server: Server;
  let base = "";
  let db: typeof import("@workspace/db");
  const post = (body: unknown, pw: string | null = PWD) =>
    fetch(`${base}/api/admin/hermes-trips`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(pw ? { "x-admin-password": pw } : {}) },
      body: JSON.stringify(body),
    });
  const get = (pw: string | null = PWD) => fetch(`${base}/api/hermes-trips`, { headers: pw ? { "x-admin-password": pw } : {} });
  const trip = (id: string, over: Record<string, unknown> = {}) => ({
    id, name: `遊 ${id}`, start: "2026-10-10", end: "2026-10-12", days: [], placeIds: [], ...over,
  });

  beforeAll(async () => {
    process.env["DATABASE_URL"] = TEST_DB;
    process.env["ADMIN_PASSWORD"] = PWD;
    db = await import("@workspace/db");
    const express = (await import("express")).default;
    const router = (await import("./hermesTrips")).default;
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use("/api", router);
    await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise((r) => server?.close(r)); });
  beforeEach(async () => {
    await db.db.delete(db.hermesTripsSnapshotTable);
  });

  it("GET without a row returns available:false", async () => {
    const body = await (await get()).json() as Record<string, unknown>;
    expect(body).toEqual({ available: false, trips: [], generatedAt: null, receivedAt: null });
  });

  it("POST overwrites the snapshot and GET reads it back; invalid trips are counted as skipped", async () => {
    const first = await post({ generatedAt: "2026-10-15", trips: [trip("T-2"), trip("T-1", { end: "2026-10-01" })] });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ success: true, trips: 1, skipped: 1 });

    const second = await post({
      generatedAt: "2026-10-16",
      trips: [trip("T-3", {
        name: "新趟",
        cover: "/media/trips/t3.webp",
        days: [{ date: "2026-10-11", title: "第二天", placeIds: ["FOOD-0001"], entries: [{ time: "09:30", text: "早餐\n在河邊", photos: [{ url: "/media/3.webp" }], photosPending: 2 }] }],
      })],
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ success: true, trips: 1, skipped: 0 });

    const body = await (await get()).json() as { available: boolean; trips: Array<Record<string, unknown>>; generatedAt: string; receivedAt: string };
    expect(body.available).toBe(true);
    expect(body.generatedAt).toBe("2026-10-16");
    expect(new Date(body.receivedAt).toString()).not.toBe("Invalid Date");
    expect(body.trips.map((t) => t["id"])).toEqual(["T-3"]);
    expect(body.trips[0]).toMatchObject({
      name: "新趟", cover: "/media/trips/t3.webp", start: "2026-10-10", end: "2026-10-12",
      days: [{ date: "2026-10-11", title: "第二天", placeIds: ["FOOD-0001"], entries: [{ time: "09:30", text: "早餐\n在河邊", photos: [{ url: "/media/3.webp", thumb: null }], photosPending: 2 }] }],
    });
  });

  it("403 without the admin password (POST and GET)", async () => {
    expect((await post({ trips: [] }, null)).status).toBe(403);
    expect((await post({ trips: [] }, "wrong")).status).toBe(403);
    expect((await get(null)).status).toBe(403);
  });

  it("400 for a malformed body or too many trips", async () => {
    const r = await post({ trips: "x" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ message: "trips 不是陣列" });
    const many = Array.from({ length: 51 }, (_, i) => trip(`T-${i}`));
    const r2 = await post({ trips: many });
    expect(r2.status).toBe(400);
    expect(await r2.json()).toEqual({ message: "trips 超過 50 筆" });
  });
});
