// /api/happiness/history 整合測試（每面向 components 欄位）：掛上真實 dashboard 路由、對真實 Postgres 驗證。
// 預設跳過。執行方式（只准對「拋棄式」資料庫）：
//   TEST_DATABASE_URL=postgres://.../aiportal_test pnpm exec vitest run src/routes/happinessHistory.integration.test.ts
// 與 hermesIdeas.integration.test.ts 共用 happiness_index_history 表：整套一起跑時要加 --no-file-parallelism，否則兩邊會互相清表。
// 安全閘：資料庫名必須以 `_test` 結尾，否則整組測試拒絕執行（測試會清空 happiness_index_history）。
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB = process.env["TEST_DATABASE_URL"];
const dbName = TEST_DB ? new URL(TEST_DB).pathname.replace(/^\//, "") : "";
const enabled = Boolean(TEST_DB) && dbName.endsWith("_test");
if (TEST_DB && !enabled) throw new Error(`拒絕執行：資料庫名「${dbName}」不是以 _test 結尾`);

const PWD = "integration-test-pwd";
const DIMS = ["lifeFreedom", "fitness", "calm", "mind", "social", "travel"] as const;
type Dim = (typeof DIMS)[number];

// 從 2026-10-31（MIND_V3_SINCE）起連續 N 天，六個面向都是同一把尺
const dateAt = (i: number) => new Date(Date.UTC(2026, 9, 31 + i)).toISOString().slice(0, 10);
// 決定性的原始分數；社交每 7 天缺一天（null）
const rawAt = (i: number): Record<Dim, number | null> => ({
  lifeFreedom: (i * 37) % 101,
  fitness: (i * 53 + 11) % 101,
  calm: (i * 29 + 5) % 101,
  mind: (i * 17 + 3) % 101,
  social: i % 7 === 3 ? null : (i * 41 + 7) % 101,
  travel: (i * 13 + 1) % 101,
});

describe.skipIf(!enabled)("happiness history API（真實 Postgres）", () => {
  let server: Server;
  let base = "";
  let db: typeof import("@workspace/db");
  const N = 130;

  const get = (qs = "", pw: string | null = PWD) =>
    fetch(`${base}/api/happiness/history${qs}`, { headers: pw ? { "x-admin-password": pw } : {} });

  const seed = async (n: number) => {
    await db.db.delete(db.happinessIndexHistoryTable);
    const rows = Array.from({ length: n }, (_, i) => {
      const r = rawAt(i);
      return {
        date: dateAt(i),
        finalScore: 50 + (i % 20),
        displayedScore: 51 + (i % 20),
        baseScore: 55.5,
        weakestScore: 30,
        weakestComponent: "生活從容",
        availableComponents: ["lifeFreedom"],
        configVersion: "test",
        lifeFreedomRaw: r.lifeFreedom,
        fitnessHabitRaw: r.fitness,
        calmRaw: r.calm,
        mindRaw: r.mind,
        socialRaw: r.social,
        travelRaw: r.travel,
      };
    });
    await db.db.insert(db.happinessIndexHistoryTable).values(rows);
  };

  // 面向分數就是公式分
  const expected = (i: number, dim: Dim): number | null => {
    const v = rawAt(i)[dim];
    return v === null ? null : Math.floor(Math.min(100, Math.max(0, v)) + 0.5);
  };

  beforeAll(async () => {
    process.env["DATABASE_URL"] = TEST_DB;
    process.env["ADMIN_PASSWORD"] = PWD;
    db = await import("@workspace/db");
    const express = (await import("express")).default;
    const router = (await import("./dashboard")).default;
    const app = express();
    app.use("/api", router);
    await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    await db.db.delete(db.happinessIndexHistoryTable);
    await new Promise((r) => server?.close(r));
  });
  beforeEach(async () => { await seed(N); });

  it("403 without the admin password (unchanged)", async () => {
    expect((await get("", null)).status).toBe(403);
    expect((await get("", "wrong")).status).toBe(403);
  });

  it("keeps the original fields and adds components (oldest first, default 30 days)", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const { history } = await res.json() as { history: Array<Record<string, unknown>> };
    expect(history).toHaveLength(30);
    expect(history.map((h) => h["date"])).toEqual(Array.from({ length: 30 }, (_, k) => dateAt(N - 30 + k)));
    for (const h of history) {
      expect(Object.keys(h).sort()).toEqual(["components", "date", "displayedScore", "finalScore", "weakestComponent"]);
      expect(Object.keys(h["components"] as object).sort()).toEqual([...DIMS].sort());
    }
    const last = history[29]!;
    const i = N - 1;
    expect(last).toMatchObject({ date: dateAt(i), finalScore: 50 + (i % 20), displayedScore: 51 + (i % 20), weakestComponent: "生活從容" });
  });

  it("components equal the formula score of that day, null stays null", async () => {
    const { history } = await (await get("?days=40")).json() as { history: Array<{ date: string; components: Record<string, number | null> }> };
    expect(history).toHaveLength(40);
    let nulls = 0;
    history.forEach((h, k) => {
      const i = N - 40 + k;
      for (const d of DIMS) {
        expect(h.components[d], `${h.date} ${d}`).toBe(expected(i, d));
        if (h.components[d] === null) nulls++;
      }
    });
    expect(nulls).toBeGreaterThan(0); // 社交每 7 天缺一天
  });

  it("days=365 returns every seeded row (warm-up rows still compute their own percentile)", async () => {
    const { history } = await (await get("?days=365")).json() as { history: Array<{ date: string; components: Record<string, number | null> }> };
    expect(history).toHaveLength(N);
    expect(history[0]!.date).toBe(dateAt(0));
    // 第 0 天沒有任何前史 → 退回原始分數（clamp 後四捨五入）
    expect(history[0]!.components["lifeFreedom"]).toBe(rawAt(0).lifeFreedom);
    history.forEach((h, i) => { for (const d of DIMS) expect(h.components[d]).toBe(expected(i, d)); });
  });

  it("days=1, days>365 clamp, invalid days fall back to 30 (unchanged behaviour)", async () => {
    expect(((await (await get("?days=1")).json()) as { history: unknown[] }).history).toHaveLength(1);
    for (const bad of ["abc", "0", "-5", ""]) {
      const r = await get(`?days=${bad}`);
      expect(r.status, bad).toBe(200);
      expect(((await r.json()) as { history: unknown[] }).history, bad).toHaveLength(30);
    }
    await db.db.insert(db.happinessIndexHistoryTable).values({
      date: "2030-01-01", finalScore: 1, displayedScore: 1, baseScore: 1, weakestScore: 1,
      weakestComponent: "x", availableComponents: [], configVersion: "test",
    });
    const big = await (await get("?days=9999")).json() as { history: unknown[] };
    expect(big.history).toHaveLength(N + 1); // 上限 365，資料只有 N+1 列
  });

  it("a row with all-null raws gives all-null components; an empty table gives an empty history", async () => {
    await db.db.insert(db.happinessIndexHistoryTable).values({
      date: "2030-01-01", finalScore: 1, displayedScore: 1, baseScore: 1, weakestScore: 1,
      weakestComponent: "x", availableComponents: [], configVersion: "test",
    });
    const { history } = await (await get("?days=1")).json() as { history: Array<{ date: string; components: Record<string, number | null> }> };
    expect(history[0]!.date).toBe("2030-01-01");
    expect(Object.values(history[0]!.components)).toEqual([null, null, null, null, null, null]);

    await db.db.delete(db.happinessIndexHistoryTable);
    expect(await (await get()).json()).toEqual({ history: [] });
  });

  it("changing a later day's raw never changes an earlier day's components", async () => {
    const before = (await (await get("?days=365")).json() as { history: Array<{ components: unknown }> }).history;
    await db.db.update(db.happinessIndexHistoryTable)
      .set({ lifeFreedomRaw: 0, fitnessHabitRaw: 100, calmRaw: 100, mindRaw: 0, socialRaw: 100, travelRaw: 0 })
      .where((await import("drizzle-orm")).eq(db.happinessIndexHistoryTable.date, dateAt(100)));
    const after = (await (await get("?days=365")).json() as { history: Array<{ components: unknown }> }).history;
    for (let i = 0; i < 100; i++) expect(after[i]!.components).toEqual(before[i]!.components);
    expect(after[100]!.components).not.toEqual(before[100]!.components);
  });
});
